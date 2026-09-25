param(
    [string]$Prompt = 'Codex needs your response. Speak after the prompt, then press Alt+N to stop Dictation.',
    [Alias('CaptureSeconds')]
    [ValidateRange(0, 30)]
    [int]$AutoStopSeconds = 0,
    [ValidateRange(15, 300)]
    [int]$TimeoutSeconds = 120,
    [string]$Hotkey = '%n',
    [string]$HistoryRoot = (Join-Path $env:USERPROFILE '.codex\dictation-history'),
    [string]$LegacyHistoryFile = (Join-Path $env:USERPROFILE '.codex\transcription-history.jsonl')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Get-HistoryBaseline {
    $ids = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)

    if (Test-Path -LiteralPath $HistoryRoot) {
        Get-ChildItem -LiteralPath $HistoryRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $metadataPath = Join-Path $_.FullName 'metadata.json'
            try {
                $metadata = Get-Content -LiteralPath $metadataPath -Raw -ErrorAction Stop | ConvertFrom-Json
                if ($metadata.id) { [void]$ids.Add([string]$metadata.id) }
            } catch {
                # Codex can be writing metadata while the baseline is taken.
            }
        }
    }

    if (Test-Path -LiteralPath $LegacyHistoryFile) {
        Get-Content -LiteralPath $LegacyHistoryFile -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $metadata = $_ | ConvertFrom-Json
                if ($metadata.id) { [void]$ids.Add([string]$metadata.id) }
            } catch {
                # Ignore a partial final JSONL record and continue.
            }
        }
    }

    return ,$ids
}

function Find-NewDictationTranscript {
    param(
        [System.Collections.Generic.HashSet[string]]$BaselineIds,
        [long]$StartedAtMs
    )

    $earliestCreatedAtMs = $StartedAtMs - 3000
    $richCandidates = @()
    if (Test-Path -LiteralPath $HistoryRoot) {
        Get-ChildItem -LiteralPath $HistoryRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $metadataPath = Join-Path $_.FullName 'metadata.json'
            try {
                $metadata = Get-Content -LiteralPath $metadataPath -Raw -ErrorAction Stop | ConvertFrom-Json
                $id = [string]$metadata.id
                $createdAtMs = [long]$metadata.createdAtMs
                $text = [string]$metadata.text
                if (
                    $id -and
                    -not $BaselineIds.Contains($id) -and
                    $createdAtMs -ge $earliestCreatedAtMs -and
                    $metadata.status -eq 'completed' -and
                    $metadata.surface -eq 'global' -and
                    -not [string]::IsNullOrWhiteSpace($text)
                ) {
                    $richCandidates += [pscustomobject]@{
                        Id = $id
                        CreatedAtMs = $createdAtMs
                        Text = $text.Trim()
                        Source = 'rich-history'
                    }
                }
            } catch {
                # Metadata is updated in place; retry missing, locked, or partial files next tick.
            }
        }
    }

    $rich = $richCandidates | Sort-Object CreatedAtMs | Select-Object -First 1
    if ($rich) { return $rich }

    $legacyCandidates = @()
    if (Test-Path -LiteralPath $LegacyHistoryFile) {
        Get-Content -LiteralPath $LegacyHistoryFile -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $metadata = $_ | ConvertFrom-Json
                $id = [string]$metadata.id
                $createdAtMs = [long]$metadata.createdAtMs
                $text = [string]$metadata.text
                if (
                    $id -and
                    -not $BaselineIds.Contains($id) -and
                    $createdAtMs -ge $earliestCreatedAtMs -and
                    -not [string]::IsNullOrWhiteSpace($text)
                ) {
                    $legacyCandidates += [pscustomobject]@{
                        Id = $id
                        CreatedAtMs = $createdAtMs
                        Text = $text.Trim()
                        Source = 'legacy-history'
                    }
                }
            } catch {
                # Ignore a partial append and retry next tick.
            }
        }
    }

    return $legacyCandidates | Sort-Object CreatedAtMs | Select-Object -First 1
}

$baselineIds = Get-HistoryBaseline
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Codex voice response'
$form.Size = New-Object System.Drawing.Size(660, 245)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.ShowInTaskbar = $true
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$question = New-Object System.Windows.Forms.Label
$question.AutoSize = $false
$question.Location = New-Object System.Drawing.Point(18, 15)
$question.Size = New-Object System.Drawing.Size(610, 56)
$question.Text = $Prompt
$form.Controls.Add($question)

$answer = New-Object System.Windows.Forms.TextBox
$answer.Location = New-Object System.Drawing.Point(18, 78)
$answer.Size = New-Object System.Drawing.Size(610, 30)
$answer.Font = New-Object System.Drawing.Font('Segoe UI', 11)
$form.Controls.Add($answer)

$status = New-Object System.Windows.Forms.Label
$status.Location = New-Object System.Drawing.Point(18, 120)
$status.Size = New-Object System.Drawing.Size(610, 28)
$status.Text = 'Preparing Codex Dictation...'
$form.Controls.Add($status)

$instruction = New-Object System.Windows.Forms.Label
$instruction.Location = New-Object System.Drawing.Point(18, 152)
$instruction.Size = New-Object System.Drawing.Size(610, 28)
$instruction.Text = 'Speak normally. Press Alt+N when finished; no Enter key is required.'
$form.Controls.Add($instruction)

$script:recordingActive = $false
$script:dictationStartedAt = $null
$script:dictationStartedAtMs = 0L
$script:transcriptReceivedAt = $null
$script:dialogStartedAt = [DateTime]::UtcNow
$script:lastText = ''
$script:stableTicks = 0
$script:failure = $null
$script:resultText = ''
$script:resultSource = $null
$script:historyId = $null
$script:promptAudio = 'not-attempted'

$autoStopTimer = New-Object System.Windows.Forms.Timer
if ($AutoStopSeconds -gt 0) {
    $autoStopTimer.Interval = $AutoStopSeconds * 1000
    $autoStopTimer.Add_Tick({
        $autoStopTimer.Stop()
        if ($script:recordingActive) {
            [System.Windows.Forms.SendKeys]::SendWait($Hotkey)
            $script:recordingActive = $false
            $status.Text = 'Transcribing...'
        }
    })
}

$pollTimer = New-Object System.Windows.Forms.Timer
$pollTimer.Interval = 250
$pollTimer.Add_Tick({
    if ($script:dictationStartedAtMs -le 0) { return }

    $historyRecord = Find-NewDictationTranscript -BaselineIds $baselineIds -StartedAtMs $script:dictationStartedAtMs
    if ($historyRecord) {
        $script:resultText = [string]$historyRecord.Text
        $script:resultSource = [string]$historyRecord.Source
        $script:historyId = [string]$historyRecord.Id
        $script:transcriptReceivedAt = [DateTime]::UtcNow
        $script:recordingActive = $false
        $pollTimer.Stop()
        $form.Close()
        return
    }

    $current = $answer.Text.Trim()
    if ($current -and $current -eq $script:lastText) {
        $script:stableTicks += 1
    } else {
        $script:lastText = $current
        $script:stableTicks = 0
    }

    # Give rich history one second to win before accepting the controlled paste sink.
    if ($current -and $script:stableTicks -ge 4) {
        $script:resultText = $current
        $script:resultSource = 'paste-sink'
        $script:transcriptReceivedAt = [DateTime]::UtcNow
        $script:recordingActive = $false
        $pollTimer.Stop()
        $form.Close()
        return
    }

    if (([DateTime]::UtcNow - $script:dictationStartedAt).TotalSeconds -ge $TimeoutSeconds) {
        $script:failure = "Timed out after $TimeoutSeconds seconds. If Dictation is still active, press Alt+N once to stop it."
        $pollTimer.Stop()
        $form.Close()
    }
})

$form.Add_Shown({
    $form.Activate()
    $answer.Focus()

    $voice = $null
    try {
        $voice = New-Object -ComObject SAPI.SpVoice
        $voice.Rate = 0
        $voice.Volume = 100
        [void]$voice.Speak($Prompt)
        $script:promptAudio = 'spoken'
    } catch {
        # Spoken prompting is helpful but must never prevent the Dictation capture path.
        $script:promptAudio = 'unavailable'
        $status.Text = 'Spoken prompt unavailable; starting Dictation...'
        try { [System.Media.SystemSounds]::Asterisk.Play() } catch { }
    } finally {
        if ($null -ne $voice) {
            try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice) } catch { }
        }
    }

    try {
        $form.Activate()
        $answer.Focus()
        $script:dictationStartedAt = [DateTime]::UtcNow
        $script:dictationStartedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $status.Text = if ($script:promptAudio -eq 'spoken') {
            'Listening. Press Alt+N when you finish speaking.'
        } else {
            'Listening (spoken prompt unavailable). Press Alt+N when you finish speaking.'
        }
        [System.Windows.Forms.SendKeys]::SendWait($Hotkey)
        $script:recordingActive = $true
        if ($AutoStopSeconds -gt 0) { $autoStopTimer.Start() }
        $pollTimer.Start()
    } catch {
        $script:failure = "Could not start Codex Dictation: $($_.Exception.Message)"
        $form.Close()
    }
})

$form.Add_FormClosed({
    $autoStopTimer.Stop()
    $pollTimer.Stop()
    if (-not $script:resultText -and -not $script:failure) {
        $script:failure = if ($script:recordingActive) {
            'Voice window was closed while Dictation may still be active. Press Alt+N once before continuing.'
        } else {
            'No Codex Dictation transcript was captured.'
        }
    }
})

[void]$form.ShowDialog()

$completedAt = [DateTime]::UtcNow
[pscustomobject]@{
    ok = [bool]$script:resultText
    text = $script:resultText
    error = if ($script:resultText) { $null } else { $script:failure }
    source = $script:resultSource
    historyId = $script:historyId
    promptAudio = $script:promptAudio
    manualStop = ($AutoStopSeconds -eq 0)
    transcriptionLatencyMs = if ($script:transcriptReceivedAt -and $script:dictationStartedAt) {
        [int]($script:transcriptReceivedAt - $script:dictationStartedAt).TotalMilliseconds
    } else { $null }
    totalElapsedMs = [int]($completedAt - $script:dialogStartedAt).TotalMilliseconds
} | ConvertTo-Json -Compress
