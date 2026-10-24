param(
    [string]$Prompt = 'What does Codex need to know?', [string]$Context = '',
    [string]$TaskTitle = 'Codex task', [string[]]$Options = @(),
    [ValidateRange(1, 300)][int]$TimeoutSeconds = 120, [string]$Hotkey = '%n',
    [string]$HistoryRoot = (Join-Path $env:USERPROFILE '.codex\dictation-history'),
    [string]$LegacyHistoryFile = (Join-Path $env:USERPROFILE '.codex\transcription-history.jsonl'),
    [Alias('CaptureSeconds')][ValidateRange(0, 30)][int]$AutoStopSeconds = 0,
    [string]$SessionId = '', [string]$CancelFile = '', [switch]$RequestFromStdin,
    [string]$PreviewImage = '', [switch]$VerifyControls
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($RequestFromStdin) {
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    $Prompt = [string]$request.prompt; $Context = [string]$request.context
    $TaskTitle = [string]$request.taskTitle
    if (-not $TaskTitle) { $TaskTitle = 'Codex task' }
    $Options = @($request.options | Where-Object { $null -ne $_ })
    $SessionId = [string]$request.sessionId; $CancelFile = [string]$request.cancelFile
    if ($request.timeoutMs) { $TimeoutSeconds = [Math]::Max(1, [Math]::Min(300, [Math]::Ceiling($request.timeoutMs / 1000))) }
    if ($request.hotkey) { $Hotkey = [string]$request.hotkey }
    if ($request.historyRoot) { $HistoryRoot = [string]$request.historyRoot }
    if ($request.legacyHistoryFile) { $LegacyHistoryFile = [string]$request.legacyHistoryFile }
    if ($request.autoStopSeconds) { $AutoStopSeconds = [Math]::Max(0, [Math]::Min(30, $request.autoStopSeconds)) }
}
if (-not $SessionId) { $SessionId = [Guid]::NewGuid().ToString() }
if ([string]::IsNullOrWhiteSpace($Prompt) -or $Prompt.Length -gt 4000 -or $Options.Count -gt 5) { throw 'Invalid response-window request.' }
. (Join-Path $PSScriptRoot 'dictation-history.ps1')
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$script:startedAt = [DateTime]::UtcNow
$script:state = 'waiting'; $script:mutexHeld = $false; $script:recordingActive = $false
$script:dictationWasStarted = $false; $script:forcedClose = $false
$script:controlVerificationPassed = $false
$script:dictationStartedAtMs = 0L; $script:baseline = $null; $script:voice = $null
$script:source = 'typed'; $script:programmaticEdit = $false; $script:userEdited = $false
$script:seenId = ''; $script:confirmed = $false; $script:resultText = ''; $script:outcome = 'cancelled'; $script:mutex = $null

$form = [System.Windows.Forms.Form]::new()
$form.Text = 'Codex - Your answer'
$form.ClientSize = [System.Drawing.Size]::new(720, 535)
$form.MinimumSize = [System.Drawing.Size]::new(660, 550)
$form.StartPosition = 'CenterScreen'
$form.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#F6F7F9')
$form.Font = [System.Drawing.Font]::new('Segoe UI', 10)
$form.AutoScaleMode = 'Dpi'; $form.TopMost = $true

function Add-Label([string]$Text, [int]$X, [int]$Y, [int]$Width, [int]$Height, [string]$Color = '#263244') {
    $label = [System.Windows.Forms.Label]::new()
    $label.Text = $Text; $label.SetBounds($X, $Y, $Width, $Height)
    $label.ForeColor = [System.Drawing.ColorTranslator]::FromHtml($Color)
    $label.Anchor = 'Top, Left, Right'; $form.Controls.Add($label)
    return $label
}
$badge = Add-Label 'CODEX  /  ONE QUESTION' 26 20 660 24 '#53647B'
$badge.Font = [System.Drawing.Font]::new('Segoe UI Semibold', 10)
$task = Add-Label $TaskTitle 26 49 660 28
$task.Font = [System.Drawing.Font]::new('Segoe UI Semibold', 14); $task.AutoEllipsis = $true
$question = [System.Windows.Forms.TextBox]::new()
$question.SetBounds(26, 90, 668, 94); $question.Multiline = $true; $question.ReadOnly = $true
$question.ScrollBars = 'Vertical'; $question.BorderStyle = 'None'; $question.BackColor = $form.BackColor
$question.Font = [System.Drawing.Font]::new('Segoe UI', 12)
$question.Text = $Prompt + $(if ($Context) { "`r`n$Context" } else { '' })
$question.Anchor = 'Top, Left, Right'; $question.TabStop = $false; $form.Controls.Add($question)
$choice = [System.Windows.Forms.ComboBox]::new()
$choice.SetBounds(26, 195, 668, 32); $choice.DropDownStyle = 'DropDownList'
$choice.Anchor = 'Top, Left, Right'; $choice.AccessibleName = 'Allowed answers'
if ($Options.Count) {
    [void]$choice.Items.Add('Choose a listed answer, or speak / type below')
    foreach ($option in $Options) { [void]$choice.Items.Add([string]$option) }
    $choice.SelectedIndex = 0
}
else { [void]$choice.Items.Add('Free-text answer - speak or type below'); $choice.Enabled = $false; $choice.SelectedIndex = 0 }
$form.Controls.Add($choice)
$answerLabel = Add-Label 'YOUR ANSWER - review before sending' 26 244 660 24 '#53647B'
$answer = [System.Windows.Forms.TextBox]::new()
$answer.SetBounds(26, 273, 668, 74); $answer.Multiline = $true; $answer.AcceptsReturn = $false
$answer.ScrollBars = 'Vertical'; $answer.MaxLength = 4000; $answer.Anchor = 'Top, Left, Right'
$answer.AccessibleName = 'Your answer'; $form.Controls.Add($answer)
$status = Add-Label 'Waiting for the response channel. You can type an answer now.' 26 360 668 45 '#53647B'
$status.AccessibleName = 'Capture status'
$stopped = [System.Windows.Forms.CheckBox]::new()
$stopped.SetBounds(26, 407, 668, 30); $stopped.Anchor = 'Top, Left, Right'
$stopped.Text = 'I have stopped Dictation (check the Codex recording indicator)'
$stopped.Enabled = $false; $stopped.Checked = $true
$stopped.AccessibleName = 'Dictation is stopped'
$form.Controls.Add($stopped)
function Add-Button([string]$Text, [int]$X, [int]$Width) {
    $button = [System.Windows.Forms.Button]::new()
    $button.Text = $Text; $button.SetBounds($X, 453, $Width, 42)
    $button.FlatStyle = 'Flat'; $button.BackColor = [System.Drawing.Color]::White
    $button.Anchor = 'Bottom, Left'; $form.Controls.Add($button)
    return $button
}
$dictate = Add-Button 'Start Dictation' 26 160
$type = Add-Button 'Type instead' 196 130
$cancel = Add-Button 'Cancel' 432 100
$send = Add-Button 'Send answer' 542 152
$cancel.Anchor = 'Bottom, Right'; $send.Anchor = 'Bottom, Right'
$send.BackColor = [System.Drawing.ColorTranslator]::FromHtml('#244CCF')
$send.ForeColor = [System.Drawing.Color]::White; $send.Enabled = $false
$form.AcceptButton = $send; $form.CancelButton = $cancel
function Stop-PromptAudio {
    if ($null -ne $script:voice) { try { [void]$script:voice.Speak('', 2) } catch { } }
}
function Set-CaptureStarted([bool]$Manual = $false) {
    # A failed shortcut injection may have partially succeeded. Keep stop controls
    # available and preserve the prepared history baseline for manual Dictation.
    $script:dictationWasStarted = $true; $stopped.Enabled = $true; $stopped.Checked = $false
    $script:recordingActive = $true; $dictate.Text = 'How to stop'
    if ($Manual) {
        $script:state = 'manual'
        $status.Text = 'Shortcut unavailable. Use your Codex shortcut manually in this answer box. Check its indicator before toggling; stop, then tick the box.'
    } else {
        $script:state = 'listening'
        $status.Text = '1. Speak. 2. Stop with your Dictation shortcut. 3. Check the stopped box. 4. Review the answer, then Send.'
    }
}
function Start-Capture {
    if (-not $script:mutexHeld) { $status.Text = 'Another question is using Dictation. Type here or wait.'; return }
    if (Test-DictationInProgress -HistoryRoot $HistoryRoot) {
        Stop-PromptAudio; $script:state = 'typing'
        $status.Text = 'A recent global recording may still be active. Stop it first, then retry, or type an answer.'
        return
    }
    Stop-PromptAudio; $form.Activate(); [void]$answer.Focus()
    if (-not $form.ContainsFocus) { $status.Text = 'Click this window before starting Dictation.'; return }
    $script:baseline = Get-DictationBaseline -HistoryRoot $HistoryRoot -LegacyHistoryFile $LegacyHistoryFile
    $script:dictationStartedAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $script:seenId = ''; $script:userEdited = $false
    $script:programmaticEdit = $true; $answer.Clear(); $script:programmaticEdit = $false
    try {
        [System.Windows.Forms.SendKeys]::SendWait($Hotkey)
        Set-CaptureStarted
    } catch { Set-CaptureStarted -Manual $true }
}
$answer.Add_TextChanged({
    $send.Enabled = -not [string]::IsNullOrWhiteSpace($answer.Text)
    if (-not $script:programmaticEdit) {
        $script:userEdited = $true; $script:source = 'typed'
        if ($script:state -in @('waiting', 'prompting')) { Stop-PromptAudio; $script:state = 'typing' }
    }
})
$choice.Add_SelectedIndexChanged({
    if ($choice.Enabled -and $choice.SelectedIndex -gt 0) { $answer.Text = [string]$choice.SelectedItem; [void]$answer.Focus() }
})
$dictate.Add_Click({
    if ($script:dictationWasStarted -and -not $stopped.Checked) {
        $status.Text = 'Stop using the configured Codex Dictation shortcut (default Alt+N). Check its indicator, then tick the stopped box.'
    } else { Start-Capture }
})
$stopped.Add_CheckedChanged({
    if ($stopped.Checked) {
        $script:recordingActive = $false; $dictate.Text = 'Try Dictation again'
        $status.Text = 'Dictation stopped by your confirmation. Wait for the transcript, edit if needed, then Send answer.'
    }
})
$type.Add_Click({
    Stop-PromptAudio; $script:state = 'typing'; $script:userEdited = $true
    $status.Text = $(if ($script:recordingActive) { 'Stop Codex Dictation with its shortcut before typing. Review and send when ready.' } else { 'Type an answer, choose an option, then Send answer.' })
    [void]$answer.Focus()
})
$send.Add_Click({
    if ([string]::IsNullOrWhiteSpace($answer.Text)) { return }
    if ($script:dictationWasStarted -and -not $stopped.Checked) {
        $status.Text = 'Stop Dictation first and tick the stopped box before sending your answer.'; [void]$stopped.Focus(); return
    }
    $script:resultText = $answer.Text.Trim(); $script:confirmed = $true; $script:outcome = 'answered'; $form.Close()
})
$cancel.Add_Click({ $form.Close() })
$form.Add_FormClosing({
    param($sender, $eventArgs)
    if (-not $script:forcedClose -and $script:dictationWasStarted -and -not $stopped.Checked) {
        $eventArgs.Cancel = $true
        $status.Text = 'Before closing: stop Codex Dictation with its shortcut, then tick the stopped box and choose Cancel.'
        [void]$stopped.Focus()
    }
})
$timer = [System.Windows.Forms.Timer]::new()
$timer.Interval = 250
$timer.Add_Tick({
    if ($CancelFile -and (Test-Path -LiteralPath $CancelFile)) { $script:forcedClose = $true; $form.Close(); return }
    $remaining = $TimeoutSeconds - ([DateTime]::UtcNow - $script:startedAt).TotalSeconds
    if ($remaining -le 0) { $script:outcome = 'timeout'; $script:forcedClose = $true; $form.Close(); return }
    $form.Text = "Codex - Your answer ($([Math]::Ceiling($remaining))s)"
    if (-not $script:mutexHeld -and $script:mutex) {
        $script:mutexHeld = Enter-DictationMutex -Mutex $script:mutex
        if ($script:mutexHeld -and $script:state -eq 'waiting') {
            $script:state = 'prompting'
            try {
                $script:voice = New-Object -ComObject SAPI.SpVoice
                [void]$script:voice.Speak($Prompt, 1)
                $status.Text = 'Reading the question. You can choose Type instead at any time.'
            } catch { $script:state = 'ready'; $status.Text = 'Ready. Choose Start Dictation when you are ready to speak, or type an answer.' }
        }
    }
    if ($script:state -eq 'prompting') {
        try {
            if ($null -eq $script:voice -or $script:voice.Status.RunningState -ne 2) {
                $script:state = 'ready'; $status.Text = 'Ready. Choose Start Dictation when you are ready to speak, or type an answer.'
            }
        } catch { $script:state = 'ready'; $status.Text = 'Choose Start Dictation, or type an answer.' }
    }
    if ($script:dictationStartedAtMs -gt 0) {
        if ($AutoStopSeconds -gt 0 -and $script:state -eq 'listening' -and $script:recordingActive -and
            ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() - $script:dictationStartedAtMs) -ge ($AutoStopSeconds * 1000)) {
            [System.Windows.Forms.SendKeys]::SendWait($Hotkey); $script:recordingActive = $false
        }
        $records = @(Get-DictationCandidates -HistoryRoot $HistoryRoot -LegacyHistoryFile $LegacyHistoryFile -BaselineIds $script:baseline -StartedAtMs $script:dictationStartedAtMs)
        if ($records.Count -gt 1) {
            if ($script:source -eq 'dictation-reviewed' -and -not $script:userEdited) {
                $script:programmaticEdit = $true; $answer.Clear(); $script:programmaticEdit = $false
            }
            $script:userEdited = $true; $status.Text = 'Multiple new recordings detected. Type the intended answer here, then review and send.'
        } elseif ($records.Count -eq 1 -and $records[0].Id -ne $script:seenId -and
            (-not $script:userEdited -or $answer.Text.Trim() -eq $records[0].Text)) {
            $script:seenId = $records[0].Id
            $script:programmaticEdit = $true; $answer.Text = $records[0].Text; $script:programmaticEdit = $false
            $script:source = 'dictation-reviewed'; $script:state = 'review'
            $status.Text = 'Transcript received. Confirm Dictation is stopped, review this answer, edit if needed, then Send answer.'
        }
    }
})
try {
    if ($PreviewImage -or $VerifyControls) {
        $status.Text = 'A new Codex transcript is ready. Review, edit if needed, then Send answer.'
        $answer.Text = 'Within two weeks'; $script:programmaticEdit = $true
        $form.Show()
        [System.Windows.Forms.Application]::DoEvents()
        if ($PreviewImage) {
            $PreviewImage = [IO.Path]::GetFullPath($PreviewImage)
            [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($PreviewImage))
            $bitmap = [System.Drawing.Bitmap]::new($form.Width, $form.Height)
            try { $form.DrawToBitmap($bitmap, [System.Drawing.Rectangle]::new(0, 0, $form.Width, $form.Height)); $bitmap.Save($PreviewImage) }
            finally { $bitmap.Dispose() }
        }
        if ($VerifyControls) {
            # Exercise the real controls with simulated state, without starting Dictation.
            Set-CaptureStarted -Manual $true
            if (-not $stopped.Enabled -or $stopped.Checked -or $script:state -ne 'manual') { throw 'Manual shortcut fallback did not expose stop controls.' }
            $send.PerformClick()
            if ($script:confirmed -or $form.IsDisposed) { throw 'Answer was sent before stop confirmation.' }
            $form.Close()
            if ($form.IsDisposed -or -not $form.Visible) { throw 'Response sink closed before stop confirmation.' }
            $stopped.Checked = $true
            $send.PerformClick()
            if (-not $script:confirmed -or -not $form.IsDisposed) { throw 'Confirmed answer could not be sent after stopping.' }
            $script:controlVerificationPassed = $true
            $script:confirmed = $false; $script:resultText = ''; $script:outcome = 'synthetic-control-check'
        }
    } else {
        $script:mutex = New-DictationMutex
        $form.Add_Shown({ $form.Activate(); $form.BringToFront(); [void]$answer.Focus(); $timer.Start() }); [void]$form.ShowDialog()
    }
} finally {
    $timer.Stop(); $timer.Dispose(); Stop-PromptAudio
    if ($script:voice) { try { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($script:voice) } catch { } }
    if ($script:mutexHeld) { $script:mutex.ReleaseMutex() }
    if ($script:mutex) { $script:mutex.Dispose() }
    $form.Dispose()
}
[pscustomobject]@{
    ok = $script:confirmed; confirmed = $script:confirmed; sessionId = $SessionId
    text = $script:resultText; source = $script:source; code = $script:outcome
    captureMayBeActive = ($script:dictationWasStarted -and -not $stopped.Checked)
    syntheticOnly = [bool]$VerifyControls; uiCheckPassed = $script:controlVerificationPassed
    totalElapsedMs = [int]([DateTime]::UtcNow - $script:startedAt).TotalMilliseconds
} | ConvertTo-Json -Compress
