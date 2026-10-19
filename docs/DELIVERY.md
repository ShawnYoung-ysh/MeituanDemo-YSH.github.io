# 候选版本交付与归档

版本：v0.7.0-rc.1。交付类型：响应式 H5 候选预览，不含 Android/iOS 原生安装包。固定入口：[校园跑腿互助平台](https://shawnyoung-ysh.github.io/MeituanDemo-YSH.github.io/)。

业务演示、源码、静态网站与验收材料可交付；完整手机发布门槛尚未满足。状态与限制见 RELEASE_REPORT.md，演示方法见 DEMO_WALKTHROUGH.md，不能将归档成功等同 M2/M3 或考试平台提交成功。

## 文件与用途

| 文件 | 用途 |
| --- | --- |
| campus-errand-v0.7.0-rc.1-提交短号-source.zip | Git 提交的完整源码、Mock、测试、脚本与公开文档；不含 .git、浏览器记录、截图、令牌或本地 artifacts |
| campus-errand-v0.7.0-rc.1-提交短号-site.zip | index.html、.nojekyll、assets/、mock/；根目录可部署至静态托管的项目子路径 |
| release.json | 实际版本、完整提交号、归档时间、每个 ZIP 及其内部文件的字节数和 SHA-256 |
| SHA256SUMS.txt | 两个 ZIP 的 SHA-256，供交付后复核完整性 |
| artifacts/task-1-11-1-12/ | 本轮走查、检查与部署证据，留在本机；Android 历史证据位于 task-1-9-1-10/android/ |

归档工具输出到 artifacts/releases/v版本-提交短号/，具体路径由执行输出及 release.json 确认。公开源码包不附私人浏览器账号、设备序列号或网络标识。

本轮候选业务提交 cb9e73c 已完成 Pages39189140691 部署与线上主流程复核。其首轮源码60文件、网站29文件均通过独立解压/逐文件SHA-256校验，源码包解压后可启动并显示首次样例；后续仅更新交接文档。最终交付包以归档目录的 release.json.commit 为准，勿把首轮工具验证包与最终交付包混用。

## 运行与验证

源码包解压后进入其根目录，需要 Node.js 22+，不需要第三方依赖：

```powershell
node scripts/serve.mjs
```

打开 http://127.0.0.1:4173/MeituanDemo-YSH.github.io/。不要直接双击 index.html：模块与种子需要 HTTP 服务。其他端口可在启动前设置 PORT 环境变量，演示记录随网址来源独立保存。

```powershell
pnpm check
# 无 pnpm 时：
node scripts/check-site.mjs
node scripts/check-mock.mjs
node scripts/check-js.mjs
node scripts/check-budget.mjs
node --test
```

静态网站包不包含开发服务器；用于已有 HTTP 静态托管。不要覆盖固定仓库名称、用户名或域名设置。

## 在 Git 仓库中重新归档

```powershell
git status --short
node scripts/archive-release.mjs
# 或 pnpm archive:release
```

工具只归档已提交的 HEAD。工作区有未提交/未跟踪文件、版本不一致、文档缺失或目标目录已存在时停止，不覆盖旧交付。源码 ZIP 来自 Git 原文，避免工作区 CRLF 差异影响交付；验收截图仍单独本地留存。

解压后核对 release.json 的文件列表和 SHA-256；仅核对 ZIP 文件名不足以证明内容正确。生成命令负责打包与生成清单，独立校验结果以本轮本地 archive-verification.json 为准。

## 维护与下一步

1. 保留当前候选提交、Pages 回执、release.json 和原始截图，后续有变更另建归档，不覆盖本轮。
2. 补齐 iPhone、蜂窝及剩余 Android 验收；发现阻塞/严重问题再修复和针对性回归，不增加 P1。
3. 手机门槛满足后，再确认 M2/M3；考试平台提交须单独取得真实回执。
4. 如需回退，按 RELEASE_REPORT.md 使用 git revert，再核对线上版本与资源。回退不删除浏览器演示数据。
