param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3000
)

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Run this script from PowerShell opened with 'Run as administrator'."
}

$node = Get-Command node.exe -ErrorAction Stop
$ruleName = "Twinkle Toes LAN TCP $Port"
$legacyRuleName = "Texture Robot LAN TCP $Port"
# Remove the previous app name too, so upgrades do not leave a duplicate rule.
Get-NetFirewallRule -DisplayName $ruleName, $legacyRuleName -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule

New-NetFirewallRule `
    -DisplayName $ruleName `
    -Description "Allow the Twinkle Toes web app on TCP $Port from the local subnet only." `
    -Direction Inbound `
    -Action Allow `
    -Enabled True `
    -Profile Private,Public `
    -Protocol TCP `
    -LocalPort $Port `
    -RemoteAddress LocalSubnet `
    -Program $node.Source | Out-Null

Write-Host "Added '$ruleName' for Node.js, limited to devices on the local subnet."
