# Pure finite-choice validation, kept in agreement with mcp/answers.mjs by shared fixtures.
function ConvertTo-NormalizedAnswer([string]$Text) {
    return ($Text.Normalize([Text.NormalizationForm]::FormKC).ToLowerInvariant() -replace '[^\p{L}\p{N}]+', ' ').Trim()
}

function Resolve-ResponseChoice([string]$Text, [string[]]$Choices) {
    $value = ConvertTo-NormalizedAnswer $Text
    $exact = @($Choices | Where-Object { (ConvertTo-NormalizedAnswer $_) -ceq $value })
    if ($exact.Count -eq 1) { return $exact[0] }
    if ($exact.Count -gt 1) { return $null }
    if ($value -cmatch '^(?:(?:option|choice) ([1-5])|([1-5])|(?:the )?(first|second|third|fourth|fifth)(?: (?:option|choice))?)$') {
        if ($Matches[1] -or $Matches[2]) { $index = [int]($Matches[1] + $Matches[2]) - 1 }
        else { $index = [array]::IndexOf(@('first', 'second', 'third', 'fourth', 'fifth'), $Matches[3]) }
        if ($index -ge 0 -and $index -lt $Choices.Count) { return $Choices[$index] }
    }
    return $null
}
