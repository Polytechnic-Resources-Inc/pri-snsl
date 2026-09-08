# run_daily_report_manual.ps1
# Wrapper script to run daily_report.py manually/locally with interactive prompts

$ScriptDir = Split-Path $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path $ScriptDir
$PythonScript = Join-Path $ScriptDir "daily_report.py"

# Set default console colors
$Host.UI.RawUI.BackgroundColor = "Black"
$Host.UI.RawUI.ForegroundColor = "Gray"
Clear-Host

Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   Daily Build Report - Manual Generator      " -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# Check for Python
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Python not found in path." -ForegroundColor Red
    exit 1
}

# Prompt for date
$DefaultDate = (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
$UserDate = Read-Host "Enter report date (YYYY-MM-DD) or press Enter for yesterday [$DefaultDate]"

if ([string]::IsNullOrWhiteSpace($UserDate)) {
    $TargetDate = $DefaultDate
}
else {
    $TargetDate = $UserDate
}

# Prompt for recipients
$DefaultRecipients = "eric@polytechres.com, ksilesky1@verizon.net, krogers.pri@gmail.com"
Write-Host ""
$UserRecipients = Read-Host "Enter recipients (comma-separated) or press Enter for default [$DefaultRecipients]"

if (-not [string]::IsNullOrWhiteSpace($UserRecipients)) {
    $env:REPORT_RECIPIENTS = $UserRecipients
}
else {
    # Ensure env var is set to default (or rely on python backup, but setting it here is clearer)
    $env:REPORT_RECIPIENTS = $DefaultRecipients
}

# Prompt for Test Mode
Write-Host ""
$TestModeInput = Read-Host "Run in TEST mode (no email)? (Y/n) [Y]"

if ($TestModeInput -eq 'n' -or $TestModeInput -eq 'N') {
    $TestFlag = ""
    $ModeStr = "LIVE (Sending Emails)"
    Write-Host "[WARNING] This will send emails to: $env:REPORT_RECIPIENTS" -ForegroundColor Yellow
}
else {
    $TestFlag = "--test"
    $ModeStr = "TEST (No Email)"
}

Write-Host ""
Write-Host "Running report for: $TargetDate ($ModeStr)" -ForegroundColor Cyan
Write-Host "----------------------------------------------" -ForegroundColor Gray

# Run python script
# Use Invoke-Expression or direct execution
if ($TestFlag) {
    python $PythonScript $TargetDate $TestFlag
}
else {
    python $PythonScript $TargetDate
}

Write-Host ""
Write-Host "----------------------------------------------" -ForegroundColor Gray
if ($LASTEXITCODE -eq 0) {
    Write-Host "SUCCESS: Report generated successfully." -ForegroundColor Green
}
else {
    Write-Host "ERROR: Report generation failed." -ForegroundColor Red
}

Write-Host ""
Pause
