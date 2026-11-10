$ErrorActionPreference = 'Stop'
$bingoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $bingoRoot
try {
    $bingoNode = Get-Command node -ErrorAction Stop
    $bingoMajor = [int]((& $bingoNode.Source --version).TrimStart('v').Split('.')[0])
    if ($bingoMajor -lt 24) { throw 'Install Node.js 24 or newer from https://nodejs.org/ and run again.' }
    if (-not (Test-Path -LiteralPath (Join-Path $bingoRoot 'node_modules'))) {
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'The game could not be built.' }
    & npm.cmd start
    exit $LASTEXITCODE
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
