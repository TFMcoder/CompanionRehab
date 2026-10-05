# Requires PowerShell 7.4 or later with Test-Json (JSON Schema support).
[CmdletBinding()]
param(
    [string]$RoadmapPath = (Join-Path $PSScriptRoot '../docs/roadmap/roadmap.json'),
    [string]$SchemaPath = (Join-Path $PSScriptRoot '../docs/roadmap/roadmap.schema.json')
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Assert-Roadmap([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

try {
    $roadmapText = Get-Content -LiteralPath $RoadmapPath -Raw
    $schemaValid = Test-Json -Json $roadmapText -SchemaFile $SchemaPath -ErrorAction Stop
    Assert-Roadmap $schemaValid 'Roadmap does not conform to its JSON Schema.'
    $roadmap = ConvertFrom-Json -InputObject $roadmapText -AsHashtable -Depth 100

    $sliceById = @{}
    $inputIds = @{}
    $gateById = @{}
    $reuseById = @{}
    $allIds = @{}
    $previousPriority = 0
    $automatedCount = 0
    $liveCount = 0
    $humanActionCount = 0

    foreach ($collectionName in @('operator_inputs', 'shared_requirements', 'service_defaults', 'release_gates', 'deferred')) {
        foreach ($entry in $roadmap[$collectionName]) {
            Assert-Roadmap (-not $allIds.ContainsKey($entry.id)) "Duplicate ID: $($entry.id)"
            $allIds[$entry.id] = $true
            if ($collectionName -eq 'release_gates') { $gateById[$entry.id] = $entry }
            if ($collectionName -eq 'operator_inputs') {
                $inputIds[$entry.id] = $entry
                if ($entry.status -eq 'resolved') {
                    Assert-Roadmap (-not [string]::IsNullOrWhiteSpace($entry.resolution_ref)) "Resolved input $($entry.id) needs a private or sanitized resolution reference."
                }
                elseif ($entry.status -eq 'defaulted') {
                    Assert-Roadmap (-not [string]::IsNullOrWhiteSpace($entry.default)) "Defaulted input $($entry.id) needs a stated default."
                }
            }
        }
    }

    foreach ($component in $roadmap.reuse_plan.components) {
        Assert-Roadmap (-not $allIds.ContainsKey($component.id)) "Duplicate ID: $($component.id)"
        $allIds[$component.id] = $true
        $reuseById[$component.id] = $component
    }

    foreach ($feature in $roadmap.slices) {
        Assert-Roadmap (-not $allIds.ContainsKey($feature.id)) "Duplicate ID: $($feature.id)"
        Assert-Roadmap ($feature.priority -gt $previousPriority) 'Slices must be listed in strictly increasing priority order.'
        $previousPriority = $feature.priority
        $allIds[$feature.id] = $true
        $sliceById[$feature.id] = $feature
    }

    $focus = $roadmap.delivery_focus
    Assert-Roadmap ($inputIds.ContainsKey($focus.timezone_input_id)) 'Delivery focus references an unknown timezone input.'
    Assert-Roadmap ($gateById.ContainsKey($focus.completion_gate_id)) 'Delivery focus references an unknown completion gate.'
    for ($index = 0; $index -lt $focus.slice_ids.Count; $index++) {
        $focusId = $focus.slice_ids[$index]
        Assert-Roadmap ($sliceById.ContainsKey($focusId)) "Unknown focus slice: $focusId"
        Assert-Roadmap ($roadmap.slices[$index].id -eq $focusId) 'Delivery focus must match the first four slices in priority order.'
    }
    $focusGate = $gateById[$focus.completion_gate_id]
    Assert-Roadmap (($focusGate.required_slices -join ',') -eq ($focus.slice_ids -join ',')) 'Delivery-focus gate must require the exact first-four sequence.'

    foreach ($entry in @($roadmap.shared_requirements) + @($roadmap.service_defaults)) {
        Assert-Roadmap ($sliceById.ContainsKey($entry.introduced_in)) "Unknown introduction slice for $($entry.id)"
    }
    foreach ($gate in $roadmap.release_gates) {
        foreach ($dependencyId in $gate.required_slices) {
            Assert-Roadmap ($sliceById.ContainsKey($dependencyId)) "Unknown release-gate slice: $dependencyId"
        }
    }

    foreach ($feature in $roadmap.slices) {
        foreach ($dependencyId in $feature.depends_on) {
            Assert-Roadmap ($sliceById.ContainsKey($dependencyId)) "Unknown dependency $dependencyId in $($feature.id)"
            # Strictly earlier dependencies imply an acyclic graph and a valid execution order.
            Assert-Roadmap ($sliceById[$dependencyId].priority -lt $feature.priority) "Dependency $dependencyId must precede $($feature.id); forward/cyclic dependencies are invalid."
            if ($feature.status -in @('in_progress', 'awaiting_live_test', 'done')) {
                Assert-Roadmap ($sliceById[$dependencyId].status -eq 'done') "$($feature.id) cannot be $($feature.status) while $dependencyId is unfinished."
            }
        }
        foreach ($requiredInput in $feature.required_inputs) {
            Assert-Roadmap ($inputIds.ContainsKey($requiredInput)) "Unknown operator input $requiredInput in $($feature.id)"
        }
        foreach ($reuseId in $feature.reuse_refs) {
            Assert-Roadmap ($reuseById.ContainsKey($reuseId)) "Unknown reuse component $reuseId in $($feature.id)"
        }

        $criteria = @{}
        $automaticCoverage = @{}
        $liveCoverage = @{}
        $testById = @{}
        foreach ($criterion in $feature.acceptance_criteria) { $criteria[$criterion.id] = $true }

        foreach ($collectionName in @('implementation_tasks', 'acceptance_criteria', 'automated_tests', 'live_tests', 'human_actions')) {
            foreach ($entry in $feature[$collectionName]) {
                Assert-Roadmap ($entry.id.StartsWith("$($feature.id)-", [System.StringComparison]::Ordinal)) "Foreign ID $($entry.id) inside $($feature.id)"
                Assert-Roadmap (-not $allIds.ContainsKey($entry.id)) "Duplicate ID: $($entry.id)"
                $allIds[$entry.id] = $true
                if ($collectionName -in @('automated_tests', 'live_tests')) {
                    $testById[$entry.id] = $entry
                    foreach ($criterionId in $entry.criterion_ids) {
                        Assert-Roadmap ($criteria.ContainsKey($criterionId)) "Unknown/foreign criterion $criterionId in $($entry.id)"
                        if ($collectionName -eq 'automated_tests') { $automaticCoverage[$criterionId] = $true }
                        else { $liveCoverage[$criterionId] = $true }
                    }
                }
            }
        }
        foreach ($criterionId in $criteria.Keys) {
            Assert-Roadmap ($automaticCoverage.ContainsKey($criterionId)) "Missing automated coverage for $criterionId"
            Assert-Roadmap ($liveCoverage.ContainsKey($criterionId)) "Missing live coverage for $criterionId"
        }
        $automatedCount += $feature.automated_tests.Count
        $liveCount += $feature.live_tests.Count
        $humanActionCount += $feature.human_actions.Count

        foreach ($action in $feature.human_actions) {
            foreach ($inputId in $action.related_input_ids) {
                Assert-Roadmap ($inputIds.ContainsKey($inputId)) "Unknown input $inputId in $($action.id)"
            }
            foreach ($testId in $action.related_test_ids) {
                Assert-Roadmap ($testById.ContainsKey($testId)) "Unknown/foreign test $testId in $($action.id)"
            }
            if ($action.blocking_scope -eq 'release_gate') {
                Assert-Roadmap (-not [string]::IsNullOrWhiteSpace($action.release_gate_id)) "Release-gate action $($action.id) needs a gate ID."
                Assert-Roadmap ($gateById.ContainsKey($action.release_gate_id)) "Unknown release gate in $($action.id)"
                Assert-Roadmap ($gateById[$action.release_gate_id].required_slices -contains $feature.id) "Release gate for $($action.id) must include $($feature.id)."
            }
            else {
                Assert-Roadmap ($null -eq $action.release_gate_id) "Non-release action $($action.id) cannot name a release gate."
            }
            if ($action.requirement -eq 'conditional') {
                Assert-Roadmap (-not [string]::IsNullOrWhiteSpace($action.condition)) "Conditional action $($action.id) needs an explicit condition."
            }
            else {
                Assert-Roadmap ($null -eq $action.condition) "Required action $($action.id) cannot have a conditional trigger."
            }
            if ($action.status -eq 'not_applicable') {
                Assert-Roadmap ($action.requirement -eq 'conditional') "Required action $($action.id) cannot be marked not_applicable."
                Assert-Roadmap (-not [string]::IsNullOrWhiteSpace($action.not_applicable_reason)) "Skipped conditional action $($action.id) needs a reason."
            }
            else {
                Assert-Roadmap ($null -eq $action.not_applicable_reason) "Applicable action $($action.id) cannot have a not-applicable reason."
            }
            if ($action.status -eq 'done') {
                Assert-Roadmap (-not [string]::IsNullOrWhiteSpace($action.completion_ref)) "Done human action $($action.id) needs actual completion evidence."
                $parsedHumanTime = [DateTimeOffset]::MinValue
                Assert-Roadmap ([DateTimeOffset]::TryParse($action.completed_at, [ref]$parsedHumanTime)) "Done human action $($action.id) needs a valid completion time."
            }
            else {
                Assert-Roadmap ($null -eq $action.completion_ref -and $null -eq $action.completed_at) "Unfinished/skipped action $($action.id) cannot contain completion evidence."
            }
            if ($feature.status -eq 'done' -and $action.blocking_scope -eq 'slice_completion') {
                Assert-Roadmap ($action.status -in @('done', 'not_applicable')) "Done slice $($feature.id) has unfinished human action $($action.id)."
            }
        }

        $resultById = @{}
        foreach ($result in $feature.test_results) {
            Assert-Roadmap ($testById.ContainsKey($result.test_id)) "Unknown test result $($result.test_id) in $($feature.id)"
            Assert-Roadmap (-not $resultById.ContainsKey($result.test_id)) "More than one current result for $($result.test_id)"
            $resultById[$result.test_id] = $result
            $parsedTime = [DateTimeOffset]::MinValue
            Assert-Roadmap ([DateTimeOffset]::TryParse($result.executed_at, [ref]$parsedTime)) "Invalid execution time for $($result.test_id)"
            if ($result.test_id -match '-LIVE') {
                Assert-Roadmap ($result.environment -eq 'live_real_services') "Live test $($result.test_id) cannot use mocked/local-only evidence."
                Assert-Roadmap ($result.data_origin -eq $testById[$result.test_id].data_policy) "Wrong data origin for $($result.test_id)"
            }
            else {
                Assert-Roadmap ($result.environment -eq 'local_synthetic' -and $result.data_origin -eq 'synthetic') "Automated regression $($result.test_id) must use the synthetic lane."
            }
        }

        if ($feature.status -eq 'blocked') {
            Assert-Roadmap ($feature.blockers.Count -gt 0) "Blocked slice $($feature.id) needs an explicit blocker."
        }
        if ($feature.status -eq 'done') {
            if ($feature.id -eq 'S01') {
                Assert-Roadmap ($roadmap.product_contract.ai_backend.reasoning_route.qualification_status -eq 'qualified') 'Done S01 requires an actually qualified reasoning route and its evidence.'
            }
            foreach ($requiredInput in $feature.required_inputs) {
                Assert-Roadmap ($inputIds[$requiredInput].status -in @('resolved', 'defaulted')) "Done slice $($feature.id) has unresolved input $requiredInput"
            }
            Assert-Roadmap (-not [string]::IsNullOrWhiteSpace($feature.implementation_revision)) "Done slice $($feature.id) needs an implementation revision."
            Assert-Roadmap ($feature.blockers.Count -eq 0) "Done slice $($feature.id) still has blockers."
            foreach ($testId in $testById.Keys) {
                Assert-Roadmap ($resultById.ContainsKey($testId)) "Done slice $($feature.id) has no evidence for $testId"
                $result = $resultById[$testId]
                Assert-Roadmap ($result.outcome -eq 'pass') "Done slice $($feature.id) has non-passing evidence for $testId"
                Assert-Roadmap ($result.implementation_revision -ceq $feature.implementation_revision) "Stale evidence revision for $testId"
            }
        }
    }

    $budget = $roadmap.constraints.budget
    Assert-Roadmap ($budget.excluded -contains 'GPT backend usage') 'GPT backend usage must remain outside the service budget.'
    if ($budget.currency_status -eq 'confirmed') {
        Assert-Roadmap ($null -ne $budget.currency) 'Confirmed currency cannot be null.'
        Assert-Roadmap ($budget.planning_currency -eq $budget.currency) 'Planning currency must match confirmed currency.'
    }
    else { Assert-Roadmap ($null -eq $budget.currency) 'Unconfirmed currency must not be recorded as confirmed fact.' }

    $doneCount = @($roadmap.slices | Where-Object { $_.status -eq 'done' }).Count
    if ($roadmap.implementation_status -eq 'complete') {
        Assert-Roadmap ($doneCount -eq $roadmap.slices.Count) 'Implementation cannot be complete while slices are unfinished.'
        foreach ($feature in $roadmap.slices) {
            foreach ($action in $feature.human_actions) {
                if ($action.blocking_scope -eq 'release_gate') {
                    Assert-Roadmap ($action.status -in @('done', 'not_applicable')) "Implementation cannot be complete with unfinished release-gate action $($action.id)."
                }
            }
        }
    }
    if ($roadmap.implementation_status -eq 'not_started') {
        foreach ($feature in $roadmap.slices) {
            Assert-Roadmap ($feature.status -in @('planned', 'blocked') -and $null -eq $feature.implementation_revision -and $feature.test_results.Count -eq 0) 'Implementation is marked not_started but contains implementation progress/evidence.'
        }
    }
    Write-Output "Roadmap valid: $($roadmap.slices.Count) slices, $humanActionCount human actions, $automatedCount automated checks, $liveCount live scenarios, $doneCount completed features."
    Write-Output 'Validation checks structure and evidence metadata; it does not run the application or independently verify private live evidence.'
    exit 0
}
catch {
    Write-Error "Roadmap validation failed: $($_.Exception.Message)" -ErrorAction Continue
    exit 1
}
