param(
  [Parameter(Mandatory)] [string]$Jdk,
  [Parameter(Mandatory)] [string]$Platform,
  [Parameter(Mandatory)] [string]$BuildTools,
  [Parameter(Mandatory)] [string]$Zxing,
  [Parameter(Mandatory)] [string]$SigningKey,
  [Parameter(Mandatory)] [string]$SigningPasswordFile,
  [string]$Alias = 'companion'
)
$ErrorActionPreference = 'Stop'
$env:JAVA_HOME = (Resolve-Path -LiteralPath $Jdk).Path
$Zxing = (Resolve-Path -LiteralPath $Zxing).Path
$SigningKey = (Resolve-Path -LiteralPath $SigningKey).Path
$SigningPasswordFile = (Resolve-Path -LiteralPath $SigningPasswordFile).Path
$android = Join-Path (Resolve-Path -LiteralPath $Platform).Path 'android.jar'
$toolsPath = (Resolve-Path -LiteralPath $BuildTools).Path
$buildPath = Join-Path $PSScriptRoot 'build'
$classes = Join-Path $buildPath 'classes'
$dex = Join-Path $buildPath 'dex'
New-Item -ItemType Directory -Force $classes,$dex | Out-Null

function Invoke-BuildStep([string]$Exe, [string[]]$Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Build step failed ($LASTEXITCODE): $Exe" }
}

$archive = Join-Path $buildPath 'resources.zip'
$manifest = Join-Path $PSScriptRoot 'AndroidManifest.xml'
$unsigned = Join-Path $buildPath 'unsigned.apk'
$aligned = Join-Path $buildPath 'aligned.apk'
$sources = @(Get-ChildItem (Join-Path $PSScriptRoot 'src') -Recurse -Filter '*.java' | ForEach-Object FullName)
Invoke-BuildStep (Join-Path $toolsPath 'aapt2.exe') @('compile','--dir',(Join-Path $PSScriptRoot 'res'),'-o',$archive)
Invoke-BuildStep (Join-Path $toolsPath 'aapt2.exe') @('link','-I',$android,'--manifest',$manifest,'-o',$unsigned,$archive)
Invoke-BuildStep (Join-Path $env:JAVA_HOME 'bin/javac.exe') (@('--release','8','-encoding','UTF-8','-classpath',"$android;$Zxing",'-d',$classes) + $sources)
$jar = Join-Path $buildPath 'app.jar'
Invoke-BuildStep (Join-Path $env:JAVA_HOME 'bin/jar.exe') @('cf',$jar,'-C',$classes,'.')
Invoke-BuildStep (Join-Path $toolsPath 'd8.bat') @('--release','--min-api','26','--lib',$android,'--output',$dex,$jar,$Zxing)
Invoke-BuildStep (Join-Path $env:JAVA_HOME 'bin/jar.exe') @('uf',$unsigned,'-C',$dex,'classes.dex','-C',$PSScriptRoot,'assets')
Invoke-BuildStep (Join-Path $toolsPath 'zipalign.exe') @('-f','4',$unsigned,$aligned)
$apk = Join-Path $buildPath 'ZKTeco-Mobile-Companion.apk'
Invoke-BuildStep (Join-Path $toolsPath 'apksigner.bat') @('sign','--ks',$SigningKey,'--ks-key-alias',$Alias,'--ks-pass',"file:$SigningPasswordFile",'--v4-signing-enabled','false','--out',$apk,$aligned)
Invoke-BuildStep (Join-Path $toolsPath 'apksigner.bat') @('verify','--verbose','--print-certs',$apk)
$download = Join-Path (Split-Path $PSScriptRoot) 'public/downloads'
New-Item -ItemType Directory -Force $download | Out-Null
Copy-Item -LiteralPath $apk -Destination $download
Get-FileHash -Algorithm SHA256 (Join-Path $download 'ZKTeco-Mobile-Companion.apk')
