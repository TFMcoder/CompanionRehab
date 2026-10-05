param(
    [Parameter(Mandatory = $false)]
    [string]$Target = 'D:\CompanionRehabSpeechRuntime\site-packages'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = Join-Path $root '.local/speech/runtime/venv/Scripts/python.exe'
$requirements = Join-Path $PSScriptRoot 'local-speech-gpu.requirements.txt'

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
    throw 'The pinned local speech virtual environment is missing. Run the existing local speech runtime setup first.'
}
$targetPath = [System.IO.Path]::GetFullPath($Target)
New-Item -ItemType Directory -Path $targetPath -Force | Out-Null
$tempPath = Join-Path (Split-Path -Parent $targetPath) 'pip-temp'
New-Item -ItemType Directory -Path $tempPath -Force | Out-Null

# Use official NVIDIA wheels from PyPI, installed only into this dedicated target.
# Keep pip's large temporary wheel downloads on the same drive as the target.
# No system PATH or machine-wide CUDA settings are changed.
$oldTemp = $env:TEMP
$oldTmp = $env:TMP
try {
    $env:TEMP = $tempPath
    $env:TMP = $tempPath
    & $python -m pip install --disable-pip-version-check --no-cache-dir --only-binary=:all: `
        --index-url 'https://pypi.org/simple' --target $targetPath --upgrade -r $requirements
    if ($LASTEXITCODE -ne 0) { throw 'NVIDIA runtime wheel installation failed.' }
} finally {
    $env:TEMP = $oldTemp
    $env:TMP = $oldTmp
}

$nvidiaRoot = Join-Path $targetPath 'nvidia'
$dllDirectories = @(
    (Join-Path $nvidiaRoot 'cuda_runtime/bin'),
    (Join-Path $nvidiaRoot 'cuda_nvrtc/bin'),
    (Join-Path $nvidiaRoot 'cublas/bin'),
    (Join-Path $nvidiaRoot 'cudnn/bin')
)
foreach ($directory in $dllDirectories) {
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) {
        throw "Expected isolated CUDA runtime directory is missing: $directory"
    }
}
$expectedFiles = @(
    (Join-Path $dllDirectories[0] 'cudart64_12.dll'),
    (Join-Path $dllDirectories[1] 'nvrtc64_120_0.dll'),
    (Join-Path $dllDirectories[2] 'cublas64_12.dll'),
    (Join-Path $dllDirectories[3] 'cudnn64_9.dll')
)
foreach ($file in $expectedFiles) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Expected NVIDIA runtime DLL is missing: $file"
    }
}

[pscustomobject]@{
    status = 'installed'
    target = $targetPath
    environment_variable = 'NANCY_ASR_CUDA_ROOT'
    environment_value = $targetPath
    device_variable = 'NANCY_ASR_DEVICE'
    device_value = 'cuda'
    dll_directories = $dllDirectories
    runtime_versions = @{
        cuda_runtime = '12.9.79'
        cuda_nvrtc = '12.9.86'
        cublas = '12.9.2.10'
        cudnn = '9.22.0.52'
    }
} | ConvertTo-Json -Depth 4
