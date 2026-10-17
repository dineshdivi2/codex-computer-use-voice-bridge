# Shared, side-effect-free history helpers. Dot-sourcing never starts Dictation.
function Test-DictationInProgress {
    param([string]$HistoryRoot)
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if (Test-Path -LiteralPath $HistoryRoot) {
        foreach ($directory in (Get-ChildItem -LiteralPath $HistoryRoot -Directory -ErrorAction SilentlyContinue)) {
            try {
                $record = Get-Content -LiteralPath (Join-Path $directory.FullName 'metadata.json') -Raw -ErrorAction Stop | ConvertFrom-Json
                if ($record.surface -eq 'global' -and $record.status -in @('recording', 'transcribing', 'processing') -and
                    $record.createdAtMs -ge ($now - 300000) -and $record.createdAtMs -le $now) { return $true }
            } catch { }
        }
    }
    return $false
}

function Get-DictationBaseline {
    param([string]$HistoryRoot, [string]$LegacyHistoryFile)
    $ids = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    if (Test-Path -LiteralPath $HistoryRoot) {
        Get-ChildItem -LiteralPath $HistoryRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            # Include the directory even when metadata is missing, locked or only partly written.
            [void]$ids.Add("folder:$($_.Name)")
            try {
                $record = Get-Content -LiteralPath (Join-Path $_.FullName 'metadata.json') -Raw -ErrorAction Stop | ConvertFrom-Json
                if ($record.id) { [void]$ids.Add([string]$record.id) }
            } catch { }
        }
    }
    if (Test-Path -LiteralPath $LegacyHistoryFile) {
        Get-Content -LiteralPath $LegacyHistoryFile -ErrorAction SilentlyContinue | ForEach-Object {
            try { $record = $_ | ConvertFrom-Json; if ($record.id) { [void]$ids.Add([string]$record.id) } } catch { }
        }
    }
    return ,$ids
}

function Get-DictationCandidates {
    param([string]$HistoryRoot, [string]$LegacyHistoryFile,
        [System.Collections.Generic.HashSet[string]]$BaselineIds, [long]$StartedAtMs)
    $candidates = @{}
    $excluded = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if (Test-Path -LiteralPath $HistoryRoot) {
        Get-ChildItem -LiteralPath $HistoryRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $record = Get-Content -LiteralPath (Join-Path $_.FullName 'metadata.json') -Raw -ErrorAction Stop | ConvertFrom-Json
                $id = [string]$record.id
                if ($BaselineIds.Contains("folder:$($_.Name)") -or $record.surface -ne 'global') {
                    if ($id) { [void]$excluded.Add($id) }
                } elseif ($id -and -not $BaselineIds.Contains($id) -and
                    $record.createdAtMs -ge $StartedAtMs -and $record.createdAtMs -le $now -and
                    $record.status -eq 'completed' -and -not [string]::IsNullOrWhiteSpace([string]$record.text)) {
                    $candidates[$id] = [pscustomobject]@{ Id=$id; Text=([string]$record.text).Trim(); Source='rich-history' }
                }
            } catch { }
        }
    }
    if (Test-Path -LiteralPath $LegacyHistoryFile) {
        Get-Content -LiteralPath $LegacyHistoryFile -ErrorAction SilentlyContinue | ForEach-Object {
            try {
                $record = $_ | ConvertFrom-Json
                $id = [string]$record.id
                if ($id -and -not $BaselineIds.Contains($id) -and -not $excluded.Contains($id) -and
                    -not $candidates.ContainsKey($id) -and $record.createdAtMs -ge $StartedAtMs -and
                    $record.createdAtMs -le $now -and -not [string]::IsNullOrWhiteSpace([string]$record.text)) {
                    $candidates[$id] = [pscustomobject]@{ Id=$id; Text=([string]$record.text).Trim(); Source='legacy-history' }
                }
            } catch { }
        }
    }
    return @($candidates.Values | Where-Object { -not $excluded.Contains($_.Id) })
}

function New-DictationMutex {
    return [System.Threading.Mutex]::new($false, 'Local\CodexVoiceBridge.Dictation.v1')
}

function Enter-DictationMutex {
    param([System.Threading.Mutex]$Mutex)
    try { return [bool]$Mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { return $true }
}
