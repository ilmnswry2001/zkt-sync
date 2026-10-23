$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$agentPath = Join-Path $scriptDir "agent.py"
$configPath = Join-Path $scriptDir "agent_config.ini"
$requirementsPath = Join-Path $scriptDir "requirements.txt"

foreach ($path in @($agentPath, $configPath, $requirementsPath)) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Required file is missing: $path" }
}

$pythonPath = (& py -3 -c "import sys; print(sys.executable)").Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pythonPath)) { throw "Python 3 was not found. Install Python 3, then run this installer again." }
$pythonwPath = Join-Path (Split-Path -Parent $pythonPath) "pythonw.exe"
if (-not (Test-Path -LiteralPath $pythonwPath)) { throw "pythonw.exe was not found beside Python. Repair the Python installation and retry." }

& $pythonPath -m pip install -r $requirementsPath
if ($LASTEXITCODE -ne 0) { throw "Could not install the attendance agent requirements." }

$taskName = "ZKTeco Attendance Sync Agent"
$action = New-ScheduledTaskAction -Execute $pythonwPath -Argument "`"$agentPath`" `"$configPath`"" -WorkingDirectory $scriptDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Keeps the ZKTeco attendance agent running in the background."
Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "The background attendance agent is installed and running. It will start automatically when you sign in."
Write-Host "Logs: $scriptDir\agent.log"
Read-Host "Press Enter to close"
