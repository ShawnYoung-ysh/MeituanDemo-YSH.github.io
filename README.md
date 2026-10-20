# 校园跑腿互助平台

本地开发更新（2026-10-21，用户 task 2-1，尚未发布）：固定顶部标题与圆形身份入口，首次说明改为确认后不再弹出的弹窗；95 项测试通过。黄色强调色仅制定[方案](docs/COLOR_SCHEME.md)，仍保留绿色页面。以下线上版本与历史交付记录保持原状态。

固定作品网址：<https://shawnyoung-ysh.github.io/MeituanDemo-YSH.github.io/>

当前版本：v0.7.0-rc.1 候选预览，已发布至原作品网址；候选提交 cb9e73c、Pages 39189140691 成功，后续文档交接及归档提交见验收记录和 release.json。任务大厅、发布、详情、七种状态操作、我的任务、个人资料、信用明细与双方评价已实现。同一浏览器可通过页面入口跑通“发布→切换身份接单→交付→发布者确认→双方评价”；确认完成向跑腿者唯一入账 +2，信用封顶 100，评价不额外加分。当前没有真实账号、支付或多人共享数据库。

M1 可操作版已于 2026-10-19 更新到原作品网址，业务提交 `2f1fd04`、Pages 部署成功并完成线上文件与基础页面核验；后续真机与完整异常验收仍按计划进行。

异常修复版v0.6.0（`c2eb1c5`）随后已部署成功。Redmi K20 Pro / Android 10 / Chrome 152 真机已跑通发布、接单、交付、确认与双方评价，信用唯一入账 80→82；用户没有 iPhone，当前手机也无 SIM，完整两端门槛尚未通过。

Mock 数据已接入；普通刷新恢复已有快照，不重新移动截止时间。大厅仅展示同校区待接单任务；我的任务按“我发布的 / 我接的”和状态筛选，保留历史进度及本次会话的筛选/返回位置。信用明细解释历史基数、事件增量和封顶后的实际变化；评分与发布/跑腿完成数分别计算。双方各可评一次，1–5 星、选填文字最多 300 字，内容按纯文本展示。

异常回归及可执行修复已完成：94项自动化测试，补齐首次下载竞态保护、临时页面重试与统一外部变更提示。未提交发布输入按身份在本次会话内保留；损坏记录可恢复，存储失败明确提示临时会话，不保证跨标签抢单事务。Android 已实测真实键盘、横竖屏、系统返回、断网后操作及 200% 显示；放大下完整流程、部分表单/恢复条件、关页重开、慢网、蜂窝与 iPhone 仍待补测。

候选版 [三分钟演示脚本](docs/DEMO_WALKTHROUGH.md) 已完成，桌面工具走查 131 秒跑通发布至双方互评，刷新/关闭重开保留结果；不含旁白与准备。94项测试通过，无新业务缺陷；本轮不改变业务 JS/CSS/种子。

实际部署见 [验收记录](docs/ACCEPTANCE.md)，状态与限制见 [版本报告](docs/RELEASE_REPORT.md)，打包和运行见 [交付说明](docs/DELIVERY.md)，Android 原始结果见 [真机记录表](docs/MOBILE_TEST_REPORT.md)。候选包已准备，完整手机发布门槛待完成，不宣称 M2/M3 通过；冻结后只修兼容性及严重缺陷。

## 开发与发布约定

- 使用原生 HTML、CSS、JavaScript，暂不引入框架或构建依赖。
- GitHub Pages 从 `main` 分支根目录发布；`.nojekyll` 保持静态文件直接发布。
- 保持仓库公开、用户名和仓库名称不变，不改域名配置。
- 资源使用相对路径；地址包含 `/MeituanDemo-YSH.github.io/`。页面切换优先使用锚点路由，防止刷新出现 404。
- 不提交密码、访问令牌、真实学生资料或本地考试文件。

## 本地开发

运行环境：Node.js 22 或更高版本；不需要安装第三方依赖。

```powershell
pnpm dev
# 或 node scripts/serve.mjs
```

打开 <http://127.0.0.1:4173/MeituanDemo-YSH.github.io/>。预览服务仅监听本机，并模拟正式网站的子路径。

## 检查、提交与上传

```powershell
pnpm check
# 无包管理器时，可直接执行：
node scripts/check-site.mjs
node scripts/check-mock.mjs
node scripts/check-js.mjs
node scripts/check-budget.mjs
node --test
git diff
git add <本次明确要提交的文件>
git commit -m "说明本次变更"
.\scripts\publish.ps1 -DryRun
.\scripts\publish.ps1
```

首次上传需要在本机完成 GitHub 身份验证；浏览器登录不等于本地 Git 已登录。发布脚本不会代为暂存文件、创建提交或强制覆盖远程分支。

在仓库 Actions 中确认 Pages 发布成功后执行：

```powershell
pnpm check:live
# 正式 Demo 发布前，还应运行占位内容检查：
node scripts/check-site.mjs --url https://shawnyoung-ysh.github.io/MeituanDemo-YSH.github.io/ --require-demo
```

本地检查覆盖 HTML、静态资源、Mock 一致性、浏览器模块语法和自动化测试。`check:live` 仅检查线上基础访问与资源；自动化测试不替代浏览器视觉或手机网络验收。检查报告生成于本地 `artifacts/`，不上传仓库。

独立故障预检运行 `node scripts/serve-regression.mjs`（4174端口，仅回环地址）；场景和独立记录方式见回归报告。普通预览不加载故障脚本。静态体积检查的gzip为本地估算，不代表实际移动网络速度。

干净 Git 工作区执行 `pnpm archive:release`，生成同一提交的源码 ZIP、静态网站 ZIP、release.json 与 SHA256SUMS.txt，保存至 artifacts/releases/。工具拒绝覆盖既有目录；生成清单不等于完成手机验收，详见交付说明。

## 回退

通过 `git log --oneline` 确认要撤销的版本，使用 `git revert <提交号>` 创建撤销提交，再按相同流程推送。避免强制推送、删除仓库或更换网址。

## 项目记录

- [后续每次对话的开发任务](docs/SESSION_PLAN.md)（从 task 1-3 开始，共 10 轮）
- [开发交接方案与排期](docs/DEVELOPMENT_PLAN.md)
- [Android / iOS 验收清单](docs/MOBILE_ACCEPTANCE.md)
- [Mock 数据接入说明](docs/MOCK_DATA.md)与[种子数据](mock/db.json)
- [阶段验收与待办](docs/ACCEPTANCE.md)
- [三分钟演示脚本](docs/DEMO_WALKTHROUGH.md)
- [候选版本报告与已知限制](docs/RELEASE_REPORT.md)
- [交付、运行与归档](docs/DELIVERY.md)
- [变更记录](CHANGELOG.md)
- [提交信息](docs/SUBMISSION.md)
