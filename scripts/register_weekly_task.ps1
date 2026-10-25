# 毎週水曜の朝に、この PC で株探の信用残・決算を取得して GitHub に送るタスクを登録する(Windows タスク スケジューラ)。
# 株探は前週金曜申込分の信用残を火曜の夕方に出すので、水曜 07:23 に実行する。PC が起きていなければ、次に起きたときに実行する。
#
#   cd stock_rank
#   powershell -ExecutionPolicy Bypass -File scripts\register_weekly_task.ps1
#   (やめるとき) Unregister-ScheduledTask -TaskName "StockRank Kabutan weekly" -Confirm:$false
$ErrorActionPreference = "Stop"
$repo = Split-Path $PSScriptRoot -Parent
$runner = Join-Path $PSScriptRoot "run_local.ps1"

# 最初にパスワードを保存しておく(タスクは無人で動くため)。保存先は %LOCALAPPDATA%\stock_rank\fs-password.txt(DPAPI で暗号化)
$pwFile = Join-Path $env:LOCALAPPDATA "stock_rank\fs-password.txt"
if (-not (Test-Path $pwFile)) {
  $sec = Read-Host "Future Sight のパスワード(この PC に暗号化して保存します)" -AsSecureString
  New-Item -ItemType Directory -Force (Split-Path $pwFile) | Out-Null
  $sec | ConvertFrom-SecureString | Set-Content $pwFile
}

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runner`" -Source kabutan -Mode weekly" -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Wednesday -At "07:23"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 6)
Register-ScheduledTask -TaskName "StockRank Kabutan weekly" -Action $action -Trigger $trigger -Settings $settings -Description "株探の信用残・決算を取得して stock_rank に送る" -Force | Out-Null
Write-Host "登録しました: 毎週水曜 07:23 に株探を取得します(タスク名 StockRank Kabutan weekly)。今すぐ試すには: Start-ScheduledTask -TaskName 'StockRank Kabutan weekly'"
