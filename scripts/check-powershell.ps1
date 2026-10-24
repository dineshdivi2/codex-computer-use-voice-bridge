$ErrorActionPreference = 'Stop'
$failed = $false
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\plugin\job-form-voice-bridge\scripts') -Filter '*.ps1' | ForEach-Object {
    $tokens = $null; $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors)
    foreach ($parseError in $parseErrors) {
        [Console]::Error.WriteLine("$($_.Name): $($parseError.Message)")
        $failed = $true
    }
}
if ($failed) { exit 1 }
Write-Output 'PowerShell syntax checks passed.'
