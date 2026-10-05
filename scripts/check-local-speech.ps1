<#
.SYNOPSIS
  Generates a fixed synthetic voice sample with an installed Windows SAPI voice.

.DESCRIPTION
  This is a local TTS connection probe only. It does not open a microphone or
  contact a remote service. It writes the generated WAV and a sanitized JSON
  receipt under .local/probes (ignored by Git).

.USAGE
  From the repository root:
    pwsh -NoProfile -File ./scripts/check-local-speech.ps1

  If PowerShell 7 cannot access Windows SAPI COM, run:
    powershell.exe -NoProfile -File ./scripts/check-local-speech.ps1
#>

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$probeDirectory = Join-Path $repoRoot '.local/probes'
$wavePath = Join-Path $probeDirectory 'nancy-local-voice.wav'
$resultPath = Join-Path $probeDirectory 'local-speech-result.json'
$artifactRef = '.local/probes/nancy-local-voice.wav'
$resultRef = '.local/probes/local-speech-result.json'
$phrase = 'Hello, I am Nancy, your AI companion. This is a local voice connection test.'
$synth = $null
$outputStream = $null
$audioFormat = $null
$selectedVoice = $null
$voiceName = $null
$voiceCulture = $null
$voiceGender = $null
$voiceEnabled = $false
$generationLatencyMs = $null
$durationSeconds = $null
$wavValid = $false
$sampleRate = $null
$channels = $null
$bitsPerSample = $null
$dataBytes = 0
$hasNonZeroPcm = $false
$safeErrors = @()
$audioGenerated = $false

try {
  if (-not (Test-Path -LiteralPath $probeDirectory)) {
    New-Item -ItemType Directory -Path $probeDirectory -Force | Out-Null
  }

  # SAPI COM works in both Windows PowerShell 5.1 and PowerShell 7. Filter
  # directly for female US English tokens instead of relying on shell-specific
  # System.Speech assembly loading.
  $synth = New-Object -ComObject SAPI.SpVoice
  $voices = $synth.GetVoices('Gender=Female;Language=409', '')
  if ($voices.Count -lt 1) {
    throw [InvalidOperationException]::new('No enabled installed en-US female SAPI voice is available.')
  }

  $selectedVoice = $voices.Item(0)
  $voiceName = $selectedVoice.GetDescription()
  $voiceCulture = 'en-US'
  $voiceGender = $selectedVoice.GetAttribute('Gender')
  $voiceEnabled = $true
  $synth.Voice = $selectedVoice

  if (Test-Path -LiteralPath $wavePath) {
    Remove-Item -LiteralPath $wavePath -Force
  }

  $timer = [System.Diagnostics.Stopwatch]::StartNew()
  $outputStream = New-Object -ComObject SAPI.SpFileStream
  $audioFormat = New-Object -ComObject SAPI.SpAudioFormat
  $audioFormat.Type = 22 # 22 kHz, 16-bit, mono PCM WAV.
  $outputStream.Format = $audioFormat
  $outputStream.Open($wavePath, 3, $false) # SSFMCreateForWrite
  $synth.AudioOutputStream = $outputStream
  [void]$synth.Speak($phrase)
  $outputStream.Close()
  $timer.Stop()
  $generationLatencyMs = [math]::Round($timer.Elapsed.TotalMilliseconds, 1)

  if (-not (Test-Path -LiteralPath $wavePath)) {
    throw [InvalidDataException]::new('Speech synthesis returned without creating a WAV file.')
  }

  $stream = [System.IO.File]::Open($wavePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)
  try {
    $reader = New-Object System.IO.BinaryReader($stream)
    try {
      $riff = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
      [void]$reader.ReadUInt32()
      $wave = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
      if ($riff -ne 'RIFF' -or $wave -ne 'WAVE') {
        throw [InvalidDataException]::new('Generated file is not a RIFF/WAVE file.')
      }

      $formatCode = $null
      while ($stream.Position + 8 -le $stream.Length) {
        $chunkId = [System.Text.Encoding]::ASCII.GetString($reader.ReadBytes(4))
        $chunkSize = [long]$reader.ReadUInt32()
        $chunkEnd = $stream.Position + $chunkSize
        if ($chunkEnd -gt $stream.Length) {
          throw [InvalidDataException]::new('WAV chunk extends beyond the file.')
        }

        if ($chunkId -eq 'fmt ') {
          $formatCode = $reader.ReadUInt16()
          $channels = $reader.ReadUInt16()
          $sampleRate = $reader.ReadUInt32()
          [void]$reader.ReadUInt32()
          [void]$reader.ReadUInt16()
          $bitsPerSample = $reader.ReadUInt16()
        } elseif ($chunkId -eq 'data') {
          $dataBytes = $chunkSize
          $remaining = $chunkSize
          while ($remaining -gt 0) {
            $readSize = [int][math]::Min(8192, $remaining)
            $pcm = $reader.ReadBytes($readSize)
            if ($pcm.Length -ne $readSize) {
              throw [InvalidDataException]::new('WAV validation failed: truncated PCM data.')
            }
            foreach ($sampleByte in $pcm) {
              if ($sampleByte -ne 0) {
                $hasNonZeroPcm = $true
                break
              }
            }
            $remaining -= $readSize
          }
          $stream.Position = $chunkEnd
          continue
        }

        $stream.Position = $chunkEnd + ($chunkSize % 2)
      }
    } finally {
      $reader.Dispose()
    }
  } finally {
    $stream.Dispose()
  }

  if ($formatCode -ne 1 -or $dataBytes -le 0 -or $sampleRate -le 0 -or $channels -le 0 -or $bitsPerSample -le 0) {
    throw [InvalidDataException]::new('WAV validation failed: expected non-empty PCM audio.')
  }

  $byteRate = [long]$sampleRate * [long]$channels * [long]$bitsPerSample / 8
  if ($byteRate -le 0) {
    throw [InvalidDataException]::new('WAV validation failed: invalid PCM byte rate.')
  }
  $durationSeconds = [math]::Round($dataBytes / $byteRate, 3)
  $wavValid = $durationSeconds -gt 0 -and $hasNonZeroPcm
  $audioGenerated = $wavValid

  $verifiedVoices = $synth.GetVoices('Gender=Female;Language=409', '')
  $voiceEnabled = $false
  for ($i = 0; $i -lt $verifiedVoices.Count; $i++) {
    if ($verifiedVoices.Item($i).GetDescription() -eq $voiceName) {
      $voiceEnabled = $true
      break
    }
  }
  if (-not $voiceEnabled) {
    throw [InvalidOperationException]::new('Selected SAPI voice is no longer enabled.')
  }
} catch {
  $rootError = $_.Exception.GetBaseException()
  $exceptionType = $rootError.GetType().Name
  $message = [string]$rootError.Message
  if ($repoRoot) {
    $message = $message -replace [regex]::Escape($repoRoot), '<workspace>'
  }
  $message = $message -replace '(?i)\b[A-Z]:\\[^\r\n"<>|?*]*', '<local-path>'
  $message = $message -replace '[\r\n]+', ' '
  if (-not $message) { $message = 'No additional safe detail is available.' }
  $safeErrors += "Local speech probe failed ($exceptionType): $message"
} finally {
  if ($null -ne $outputStream) {
    try { $outputStream.Close() } catch { }
  }
  foreach ($comObject in @($outputStream, $audioFormat, $selectedVoice, $synth)) {
    if ($null -ne $comObject -and [Runtime.InteropServices.Marshal]::IsComObject($comObject)) {
      try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($comObject) } catch { }
    }
  }
}

if (-not $audioGenerated -and (Test-Path -LiteralPath $wavePath)) {
  try { Remove-Item -LiteralPath $wavePath -Force } catch { }
}

$status = if ($audioGenerated -and $wavValid -and $voiceEnabled) { 'generated' } else { 'failed' }
$result = [ordered]@{
  probe_id = 'local-sapi-tts-connection'
  status = $status
  created_at_utc = [DateTime]::UtcNow.ToString('o')
  backend = 'Windows System.Speech / SAPI'
  phrase = $phrase
  voice = [ordered]@{
    name = $voiceName
    culture = $voiceCulture
    gender = $voiceGender
    enabled_after_generation = $voiceEnabled
  }
  audio_generated = $audioGenerated
  wav_valid = $wavValid
  audio = [ordered]@{
    artifact_private_ref = $artifactRef
    duration_seconds = $durationSeconds
    generation_latency_ms = $generationLatencyMs
    sample_rate_hz = $sampleRate
    channels = $channels
    bits_per_sample = $bitsPerSample
    pcm_data_bytes = $dataBytes
    has_nonzero_pcm = $hasNonZeroPcm
  }
  audible_verified = $false
  device_conversation_verified = $false
  microphone_opened = $false
  remote_service_used = $false
  result_private_ref = $resultRef
  safe_errors = @($safeErrors)
}

$json = $result | ConvertTo-Json -Depth 5
Set-Content -LiteralPath $resultPath -Value $json -Encoding UTF8
Write-Output $json

if ($status -ne 'generated') { exit 1 }
