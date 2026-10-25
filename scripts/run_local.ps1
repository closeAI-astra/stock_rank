# 自分の PC で株探・IRBANK を取得し、暗号化した data/ を GitHub に送る(Windows PowerShell)。
# 株探(HTTP 405)も IRBANK(HTTP 403)も GitHub Actions からの接続を拒否するので、取得はこちらで実行する。
#
#   cd stock_rank
#   powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1                 # IRBANK(全銘柄・続きから)
#   powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1 -Codes 7203     # 1銘柄だけ試す
#   powershell -ExecutionPolicy Bypass -File scripts\run_local.ps1 -Source kabutan -Mode full
param(
  [ValidateSet("irbank", "kabutan")][string]$Source = "irbank",
  [ValidateSet("weekly", "full")][string]$Mode = "weekly",
  [string]$Codes = "",
  [double]$MaxMinutes = 300,
  [double]$Delay = 1.5,
  [switch]$SavePassword   # 定期実行(register_weekly_task.ps1)のために、パスワードをこの PC に暗号化して保存する
)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# パスワード: 環境変数 → この PC に保存したもの(DPAPI で暗号化。このユーザー・この PC でしか読めない)→ その場で入力
$pwFile = Join-Path $env:LOCALAPPDATA "stock_rank\fs-password.txt"
if (-not $env:FS_PAGES_PASSWORD -and (Test-Path $pwFile)) {
  $sec = Get-Content $pwFile | ConvertTo-SecureString
  $env:FS_PAGES_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
}
if (-not $env:FS_PAGES_PASSWORD) {
  $sec = Read-Host "Future Sight のパスワード(画面には表示されません)" -AsSecureString
  $env:FS_PAGES_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  if ($SavePassword) {
    New-Item -ItemType Directory -Force (Split-Path $pwFile) | Out-Null
    $sec | ConvertFrom-SecureString | Set-Content $pwFile
    Write-Host "パスワードをこの PC に暗号化して保存しました: $pwFile"
  }
}
$py = if (Get-Command py -ErrorAction SilentlyContinue) { "py" } else { "python" }
& $py -m pip install --quiet "cryptography>=42"

git pull --rebase
$raw = "$Source-raw-$(Get-Date -Format yyyyMMdd-HHmm).tar.gz.enc"   # 生の HTML(暗号化)。この PC に残す(.gitignore 済み)
# Windows PowerShell 5.1 は空の引数 "" を外部コマンドに渡さないので、--codes は指定したときだけ付ける
$archiveArgs = @("scripts\stock_archive.py", "--source", $Source, "--mode", $Mode, "--max-minutes", $MaxMinutes, "--delay", $Delay, "--raw-out", $raw)
if ($Codes) { $archiveArgs += @("--codes", $Codes) }
& $py @archiveArgs
if ($LASTEXITCODE -ne 0) { throw "取得に失敗しました(上のメッセージを確認してください)" }

git add "data/$Source"
git diff --cached --quiet
if ($LASTEXITCODE -ne 0) {
  git commit -m "$Source archive (local) $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
  git push
  Write-Host "GitHub に送りました。数分で Stock Rank のページに反映されます。"
} else {
  Write-Host "新しく保存したものはありませんでした。"
}
