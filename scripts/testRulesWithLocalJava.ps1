[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$jdkRoot = Join-Path $projectRoot '.tools\jdk-21'
$javaExe = Join-Path $jdkRoot 'bin\java.exe'

function Stop-ProjectEmulatorOrphans {
  foreach ($port in @(18080, 19199)) {
    $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
      $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
      if ($process -and $process.Path -eq $javaExe) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

if (-not (Test-Path -LiteralPath $javaExe)) {
  throw "Project-local Java 21 was not found at $jdkRoot. Run the project setup step first."
}

$versionErrorAction = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$javaVersion = (& $javaExe -version 2>&1 | Out-String)
$ErrorActionPreference = $versionErrorAction
if ($javaVersion -notmatch 'version "21\.') {
  throw "Expected project-local Java 21, but found: $javaVersion"
}

$previousJavaHome = $env:JAVA_HOME
$previousPath = $env:Path
try {
  $env:JAVA_HOME = $jdkRoot
  $env:Path = "$(Join-Path $jdkRoot 'bin');$previousPath"
  Push-Location $projectRoot
  npm run test:rules
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Stop-ProjectEmulatorOrphans
  Pop-Location
  $env:JAVA_HOME = $previousJavaHome
  $env:Path = $previousPath
}
