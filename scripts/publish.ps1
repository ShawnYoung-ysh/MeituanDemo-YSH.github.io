param([switch]$DryRun)
$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
  & node scripts/check-site.mjs
  if ($LASTEXITCODE -ne 0) { throw '本地检查失败，未上传。' }
  & node scripts/check-mock.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Mock 数据检查失败，未上传。' }
  & node scripts/check-js.mjs
  if ($LASTEXITCODE -ne 0) { throw 'JavaScript 模块检查失败，未上传。' }
  & node scripts/check-budget.mjs
  if ($LASTEXITCODE -ne 0) { throw '静态资源体积检查失败，未上传。' }
  & node --test
  if ($LASTEXITCODE -ne 0) { throw '自动化测试失败，未上传。' }
  $branchName = (& git branch --show-current).Trim()
  if ($branchName -ne 'main') { throw '请在 main 分支发布。' }
  $remoteUrl = (& git remote get-url origin).Trim()
  if ($remoteUrl -ne 'https://github.com/ShawnYoung-ysh/MeituanDemo-YSH.github.io.git') { throw '远程仓库与固定部署目标不符。' }
  $pendingChanges = & git status --porcelain
  if ($LASTEXITCODE -ne 0) { throw '无法读取 Git 状态。' }
  if ($pendingChanges) { throw '请先检查并提交本次修改，再发布。' }
  if ($DryRun) { & git push --dry-run origin main } else { & git push origin main }
  if ($LASTEXITCODE -ne 0) { throw '上传失败；请检查 Git 登录状态或远程分支更新。' }
  Write-Output '上传检查完成。实际发布后请等待 GitHub Pages 部署成功，再运行 pnpm check:live。'
} finally { Pop-Location }
