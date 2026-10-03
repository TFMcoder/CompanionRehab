# Render the human reading view from the canonical roadmap; -Check is read-only.
[CmdletBinding()]
param(
    [string]$RoadmapPath = (Join-Path $PSScriptRoot '../docs/roadmap/roadmap.json'),
    [string]$OutputPath = (Join-Path $PSScriptRoot '../docs/HUMAN_ACTIONS.md'),
    [switch]$Check
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$roadmap = Get-Content -LiteralPath $RoadmapPath -Raw | ConvertFrom-Json -AsHashtable -Depth 100
$lines = [System.Collections.Generic.List[string]]::new()
$roles = [ordered]@{
    participant_or_tester = 'The person using the feature or a consenting early tester.'
    account_owner = 'The person able to complete account login, MFA, ownership and consent steps.'
    product_owner = 'The person choosing product scope, operating arrangements and budget decisions.'
    household_manager = 'The person maintaining real meals, groceries and household tasks.'
    protocol_owner = 'The person authorized to supply or approve the applicable routine or care instructions.'
    scoring_owner = 'The person authorized to choose progress and achievement rules.'
    family_recipient = 'A designated consenting recipient of the planned family test.'
    operator = 'A person authorized to operate the program and review its records.'
}
$scopeLabels = @{
    slice_completion = 'Completing this feature slice'
    paid_commitment = 'The proposed paid commitment only'
    daily_reliance = 'Unattended daily reliance only'
    clinical_use = 'Using the relevant clinical instructions only'
    release_gate = 'The named release gate only'
}

$lines.Add('# Human actions by implementation stage')
$lines.Add('')
$lines.Add("Updated: $($roadmap.updated_at). Generated from the canonical roadmap; all statuses below come from that file.")
$lines.Add('')
$lines.Add('Source: [roadmap.json](roadmap/roadmap.json), in each slice''s human_actions array. Edit the JSON, then run the renderer; do not maintain a separate checklist here. See [ROADMAP.md](ROADMAP.md) for feature scope and live tests.')
$lines.Add('')
$lines.Add('## How to use this list')
$lines.Add('')
foreach ($key in @('agent_responsibility', 'carry_forward', 'timing', 'conditional_actions', 'completion', 'evidence', 'roles', 'deferred')) {
    $lines.Add("- $($roadmap.human_action_policy[$key])")
}
$lines.Add('')
$lines.Add('Routine coding, technical service configuration, database work, synthetic tests and evidence collection belong to the agent. The human supplies real-world decisions, restricted account interactions and participation that the agent cannot substitute for.')
$lines.Add('')
$lines.Add('## Role labels')
$lines.Add('')
$lines.Add('| Role | Meaning |')
$lines.Add('|---|---|')
foreach ($key in $roles.Keys) { $lines.Add("| $key | $($roles[$key]) |") }
$lines.Add('')
$lines.Add('## Stage index')
$lines.Add('')
$lines.Add('| Stage | Feature | Human action IDs |')
$lines.Add('|---|---|---|')
foreach ($feature in $roadmap.slices) {
    $ids = ($feature.human_actions | ForEach-Object { $_.id }) -join ', '
    $lines.Add("| $($feature.id) | $($feature.title) | $ids |")
}
$lines.Add('')
foreach ($feature in $roadmap.slices) {
    $lines.Add("## $($feature.id): $($feature.title)")
    $lines.Add('')
    foreach ($action in $feature.human_actions) {
        $marker = if ($action.status -in @('done', 'not_applicable')) { 'x' } else { ' ' }
        $lines.Add("- [$marker] **$($action.id): $($action.title)**")
        $lines.Add('')
        $lines.Add("  Owner: **$($action.owner_role)**. Status: **$($action.status)**. Requirement: **$($action.requirement)**.")
        $lines.Add('')
        $lines.Add("  **When:** $($action.when).")
        $scope = $scopeLabels[$action.blocking_scope]
        if ($null -ne $action.release_gate_id) { $scope += " ($($action.release_gate_id))" }
        $lines.Add("  **Blocks:** $scope.")
        if ($null -ne $action.condition) { $lines.Add("  **Applies if:** $($action.condition)") }
        $lines.Add('')
        $lines.Add('  **Human action:**')
        $lines.Add('')
        foreach ($step in $action.human_must_do) { $lines.Add("  - $step") }
        $lines.Add('')
        $lines.Add('  **Agent prepares or handles:** ' + ($action.agent_can_do -join ' '))
        $lines.Add('')
        $lines.Add("  **Completion evidence:** $($action.expected_evidence)")
        $refs = @($action.related_input_ids) + @($action.related_test_ids)
        if ($refs.Count -gt 0) {
            $lines.Add('')
            $lines.Add('  **Linked inputs/tests:** ' + ($refs -join ', ') + '.')
        }
        if ($action.status -eq 'done') {
            $lines.Add('')
            $lines.Add("  **Recorded completion:** $($action.completed_at); $($action.completion_ref).")
        }
        if ($action.status -eq 'not_applicable') {
            $lines.Add('')
            $lines.Add("  **Not applicable because:** $($action.not_applicable_reason)")
        }
        $lines.Add('')
    }
}
$lines.Add('## Updating and checking')
$lines.Add('')
$lines.Add('Use pending, in_progress, done or not_applicable in the canonical JSON. Done requires an actual completion reference and timestamp. Only conditional actions can be not_applicable, with a specific reason. Do not put real names, credentials, clinical details or invented evidence in either file.')
$lines.Add('')
$lines.Add('From the repository root:')
$lines.Add('')
$lines.Add('~~~powershell')
$lines.Add('pwsh -NoProfile -File ./scripts/render-human-actions.ps1')
$lines.Add('pwsh -NoProfile -File ./scripts/validate-roadmap.ps1')
$lines.Add('pwsh -NoProfile -File ./scripts/render-human-actions.ps1 -Check')
$lines.Add('~~~')
$lines.Add('')
$content = $lines -join [char]10

if ($Check) {
    if (-not (Test-Path -LiteralPath $OutputPath -PathType Leaf)) { throw 'Human-action reading view is missing; run the renderer.' }
    $existing = (Get-Content -LiteralPath $OutputPath -Raw).Replace([string][char]13, '')
    if ($existing -cne $content) { throw 'Human-action reading view is stale; run the renderer.' }
    Write-Output 'Human-action reading view matches the canonical roadmap.'
}
else {
    [System.IO.File]::WriteAllText([System.IO.Path]::GetFullPath($OutputPath), $content, [System.Text.UTF8Encoding]::new($false))
    Write-Output "Rendered $OutputPath"
}
