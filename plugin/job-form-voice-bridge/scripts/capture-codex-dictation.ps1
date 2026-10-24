# Compatibility entry point.
param(
    [string]$Prompt, [string]$Context, [string]$TaskTitle, [string[]]$Options,
    [int]$TimeoutSeconds, [string]$Hotkey, [string]$HistoryRoot, [string]$LegacyHistoryFile,
    [Alias('CaptureSeconds')][int]$AutoStopSeconds, [string]$SessionId, [string]$CancelFile,
    [switch]$RequestFromStdin, [string]$PreviewImage, [switch]$VerifyControls
)
& (Join-Path $PSScriptRoot 'response-window.ps1') @PSBoundParameters
