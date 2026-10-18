# 校园跑腿互助平台

固定作品网址：<https://shawnyoung-ysh.github.io/MeituanDemo-YSH.github.io/>

当前阶段：已上线占位首页；发布任务、接单、完成确认和信用评价尚待实现。当前没有真实账号、支付或多人共享数据库。

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

自动检查覆盖公开访问、HTML 声明、固定网址和静态资源；不替代业务操作、浏览器视觉或手机网络验收。检查报告生成于本地 `artifacts/`，不上传仓库。

## 回退

通过 `git log --oneline` 确认要撤销的版本，使用 `git revert <提交号>` 创建撤销提交，再按相同流程推送。避免强制推送、删除仓库或更换网址。

## 项目记录

- [阶段验收与待办](docs/ACCEPTANCE.md)
- [变更记录](CHANGELOG.md)
- [提交信息](docs/SUBMISSION.md)
