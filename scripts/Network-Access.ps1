[CmdletBinding()]
param(
    [ValidateSet('Enable','Disable')][string]$Mode = 'Enable',
    [ValidateRange(0,65535)][int]$Port = 0,
    [ValidateRange(0,65535)][int]$ExternalPort = 0,
    [string]$LocalAddress = ''
)

$ErrorActionPreference = 'Stop'
$bingoRoot = Split-Path -Parent $PSScriptRoot
$bingoData = Join-Path $bingoRoot 'data'
$bingoReport = Join-Path $bingoData 'network-access.json'
$bingoEnvironment = Join-Path $bingoRoot '.env'
if ($Port -eq 0) {
    $Port = 54321
    if (Test-Path -LiteralPath $bingoEnvironment) {
        foreach ($bingoLine in Get-Content -LiteralPath $bingoEnvironment) {
            if ($bingoLine -match '^\s*(?:export\s+)?PORT\s*=\s*["'']?(\d+)["'']?\s*(?:#.*)?$') { $Port = [int]$Matches[1] }
        }
    }
}
if ($Port -lt 1 -or $Port -gt 65535) { throw 'Invalid server port.' }
if ($ExternalPort -eq 0) { $ExternalPort = $Port }
$bingoAdministrator = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $bingoAdministrator) {
    Write-Host 'Windows will ask for administrator permission to configure the Bingo firewall rule.'
    $bingoArguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"' + $PSCommandPath + '"'),'-Mode',$Mode,'-Port',[string]$Port,'-ExternalPort',[string]$ExternalPort)
    if ($LocalAddress) { $bingoArguments += @('-LocalAddress',$LocalAddress) }
    try {
        $bingoChild = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $bingoArguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
        if (Test-Path -LiteralPath $bingoReport) { Get-Content -Raw -LiteralPath $bingoReport | Write-Host }
        exit $bingoChild.ExitCode
    } catch { Write-Host 'Administrator permission was not granted. No configuration was applied.' -ForegroundColor Yellow; exit 1 }
}

New-Item -ItemType Directory -Path $bingoData -Force | Out-Null
$bingoRule = "StickerPartyBingo-TCP-$Port"
$bingoResult = [ordered]@{ status='error'; mode=$Mode; port=$Port; externalPort=$ExternalPort; localAddress=$LocalAddress; firewallRule=$bingoRule; routerMapped=$false; publicUrl=$null; updatedAt=(Get-Date).ToUniversalTime().ToString('o') }
function Set-BingoPublicUrl([string]$Value) {
    $bingoContent = if (Test-Path -LiteralPath $bingoEnvironment) { [IO.File]::ReadAllText($bingoEnvironment) } else { "HOST=0.0.0.0`nPORT=$Port`nDATA_DIR=./data`n" }
    if ($bingoContent -match '(?m)^PUBLIC_URL=') { $bingoContent = [regex]::Replace($bingoContent, '(?m)^PUBLIC_URL=.*$', ('PUBLIC_URL=' + $Value)) }
    else { $bingoContent = $bingoContent.TrimEnd() + "`nPUBLIC_URL=$Value`n" }
    [IO.File]::WriteAllText($bingoEnvironment, $bingoContent, (New-Object Text.UTF8Encoding($false)))
}
try {
    $bingoNat = New-Object -ComObject HNetCfg.NATUPnP
    $bingoMappings = $bingoNat.StaticPortMappingCollection
    if ($Mode -eq 'Disable') {
        if (Test-Path -LiteralPath $bingoReport) {
            $bingoPrevious = Get-Content -Raw -LiteralPath $bingoReport | ConvertFrom-Json
            if ($bingoPrevious.port -eq $Port -and $bingoPrevious.routerMapped -and $null -ne $bingoMappings) {
                try {
                    $bingoExisting = $bingoMappings.Item([int]$bingoPrevious.externalPort,'TCP')
                    if ($bingoExisting.Description -in @('Beango','Sticker Party Bingo') -and $bingoExisting.InternalClient -eq $bingoPrevious.localAddress -and $bingoExisting.InternalPort -eq $Port) {
                        $bingoMappings.Remove([int]$bingoPrevious.externalPort,'TCP')
                    }
                } catch { Write-Host 'The previous router mapping is already absent.' }
            }
        }
        Get-NetFirewallRule -Name $bingoRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        Set-BingoPublicUrl ''
        $bingoResult.status = 'disabled'
    } else {
        $bingoPortable = Join-Path $bingoRoot 'Beango.exe'
        $bingoNodeProgram = if (Test-Path -LiteralPath $bingoPortable) { $bingoPortable } else { (Get-Command node -ErrorAction Stop).Source }
        if (-not $LocalAddress) {
            $bingoCandidates = foreach ($bingoConfiguration in Get-NetIPConfiguration) {
                if ($bingoConfiguration.IPv4DefaultGateway) {
                    foreach ($bingoIP in $bingoConfiguration.IPv4Address.IPAddress) {
                        if ($bingoIP -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)') {
                            [pscustomobject]@{ Address=$bingoIP; Metric=$bingoConfiguration.NetIPv4Interface.InterfaceMetric }
                        }
                    }
                }
            }
            $LocalAddress = ($bingoCandidates | Sort-Object Metric | Select-Object -First 1).Address
        }
        if (-not $LocalAddress -or -not (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -eq $LocalAddress })) { throw 'No suitable local IPv4 address was found. Use -LocalAddress with this computer LAN address.' }
        $bingoResult.localAddress = $LocalAddress
        if ($null -eq $bingoMappings) { throw 'The router does not expose UPnP port mappings. Enable UPnP or configure a TCP port forward manually.' }
        $bingoExisting = $null
        try { $bingoExisting = $bingoMappings.Item($ExternalPort,'TCP') } catch { }
        if ($bingoExisting -and ($bingoExisting.InternalClient -ne $LocalAddress -or $bingoExisting.InternalPort -ne $Port -or $bingoExisting.Description -notin @('Beango','Sticker Party Bingo'))) {
            throw "External TCP port $ExternalPort is already used by another application. Choose -ExternalPort with another number."
        }
        Get-NetFirewallRule -Name $bingoRule -ErrorAction SilentlyContinue | Remove-NetFirewallRule
        New-NetFirewallRule -Name $bingoRule -DisplayName "Beango (TCP $Port)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program $bingoNodeProgram -Profile Any | Out-Null
        $bingoMapping = $bingoMappings.Add($ExternalPort,'TCP',$Port,$LocalAddress,$true,'Beango')
        $bingoResult.routerMapped = $true
        $bingoResult.publicUrl = 'http://' + $bingoMapping.ExternalIPAddress + ':' + $ExternalPort
        Set-BingoPublicUrl $bingoResult.publicUrl
        $bingoResult.status = 'enabled'
        $bingoResult['nodeProgram'] = $bingoNodeProgram
    }
    $bingoResult | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $bingoReport -Encoding UTF8
    Write-Host ($bingoResult | ConvertTo-Json -Depth 4)
    Write-Host 'Restart the game to refresh the invitation link in Settings.'
    exit 0
} catch {
    $bingoResult['error'] = $_.Exception.Message
    $bingoResult | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $bingoReport -Encoding UTF8
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
