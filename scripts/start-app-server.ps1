param(
    [Parameter(Mandatory = $true)]
    [string]$CodexBinary
)

$ErrorActionPreference = 'Stop'
& $CodexBinary app-server
exit $LASTEXITCODE
