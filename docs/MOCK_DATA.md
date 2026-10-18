# Mock 数据交接与接入约定

日期：2026-10-18｜数据集版本：2026-10-18.1｜schemaVersion：1

数据文件：[mock/db.json](../mock/db.json)。用户已允许将虚构测试数据推送到公开 GitHub 仓库。本数据集不含真实账号、学号、手机号、邮箱、取件码、精确坐标或访问令牌。

## 1. 使用边界

这是一份可随静态网站发布的只读种子数据，不是服务器数据库。网页首次读取它，后续修改存到当前浏览器 localStorage；不能直接修改 GitHub 上的 JSON。跨设备和跨浏览器不共享操作记录。未来多人版通过数据适配层接真实 API。

数据文件已经准备好；当前占位首页尚未调用此文件。Mock 适配层、页面交互和状态管理由后续开发任务实现。

## 2. 内容与关键场景

共 1 个虚构校区、6 个公共地点、5 个演示用户、4 个类别、12 个任务、3 条评价、2 条信用事件。

| 用户 | 用途 | 初始派生信用 |
| --- | --- | ---: |
| u001 小周 | 默认身份，兼有发布与接单记录 | 82 |
| u002 阿晴 | 核心流程的第二演示身份 | 80 |
| u003 小林 | 发布其他任务和历史评价 | 84 |
| u004 糖糖 | 已交付及争议场景 | 75 |
| u005 新同学 | 信用门槛测试，可发布、不能接单 | 58 |

所有用户的 `campusVerification` 都是 `demo_unverified`。展示时明确为演示资料，不显示真实“校内认证成功”。

| 任务 | 初始状态 | 建议测试 |
| --- | --- | --- |
| t001 | open | u001 发布，u002 接单；默认主流程 |
| t002–t004 | open | 不同类别、地点、酬谢与长标题换行 |
| t005 | accepted | u001 已接单，开始或退出 |
| t006 | in_progress | u002 提交完成，u001 查看进度 |
| t007 | awaiting_confirmation | u001 确认后 u004 从 75 增至 77；重复确认不得再增分 |
| t008–t009 | completed | 完成记录、双方评价、派生统计；不重复发放历史信用 |
| t010 | cancelled | 发布者在接单前取消，不扣信用 |
| t011 | expired | 禁止接单，显示截止原因 |
| t012 | disputed | 待处理异议，不计完成、不自动扣信用 |

## 3. 字段与关联

所有主键为字符串，所有金额为人民币整数分，所有时间偏移为整数分钟；不存在同名用户的模糊匹配，关联只用 ID。

| 集合 | 关键字段 | 约束 |
| --- | --- | --- |
| meta | schemaVersion、datasetVersion、defaultUserId、timeMode、storageKey | schemaVersion=1；fictional=true |
| campuses | id、name、fictional | 当前仅虚构校区 c001 |
| locations | id、campusId、name、fictional | 公共地点，归属校区存在 |
| users | id、nickname、campusId、creditBase、campusVerification、avatarText | creditBase 为 0–100；分数通过事件派生 |
| tasks | id、campusId、category、publisherId、runnerId、status | 接单者不得等于发布者；双方及地点均属于同一校区 |
| tasks | title、description、pickupLocationId、dropoffLocationId | 标题 4–60，描述 10–500，纯文本 |
| tasks | rewardCents、goodsBudgetCents | 酬谢 0–5000 分，商品预算独立且非负，均为演示金额 |
| tasks | createdOffsetMinutes、deadlineOffsetMinutes、updatedOffsetMinutes | 首次初始化转换为绝对毫秒时间；截止晚于发布 |
| tasks | revision、timeline、completionNote、disputeReason | revision 正整数；记录每次状态事件；完成说明、异议原因按状态提供 |
| reviews | id、taskId、authorId、targetUserId、rating、comment、createdOffsetMinutes | completed 任务参与双方互评；每任务每作者最多一次；1–5 星 |
| creditEvents | id、taskId、userId、type、delta、createdOffsetMinutes | 每个 completed 任务仅一条 task_completed，接单者 +2 |

`timeline` 每项包含 `id / action / actorId / atOffsetMinutes`。过期事件 actorId 为 null，其他事件必须指向参与用户。事件依时间先后排列。状态语义以 DEVELOPMENT_PLAN.md 为准。

## 4. 初始化、持久化和重置

1. 启动时先读取 `campus-errand-demo:v1`。存在合法快照就恢复；不能每次刷新重新加载种子覆盖操作。
2. 无快照时读取相对 URL：`new URL('./mock/db.json', document.baseURI)`。文件不是从域名根路径 `/mock/db.json` 获取。
3. 捕获一次 `anchor = Date.now()`。复制数据，将 `createdOffsetMinutes → createdAt`、`deadlineOffsetMinutes → deadlineAt`、`updatedOffsetMinutes → updatedAt`、时间线 `atOffsetMinutes → at` 转为 `anchor + 分钟偏移 × 60000`，值为整数毫秒时间戳；移除副本中的偏移字段。用户设置、版本等元信息不改。
4. 快照结构约定为 `{schemaVersion, datasetVersion, initializedAt, activeUserId, db, processedRequests}`，其中 initializedAt 为 anchor，activeUserId 初始为 u001。
5. 每次操作先校验并构造完整新快照，单次 `setItem` 保存后更新 UI；若写入失败，可在明确提示的临时内存模式下继续。
6. 重置先征求确认，再清除此项目键，重新载入种子并生成新 anchor；不得调用 `localStorage.clear()` 清除同源其他应用数据。
7. schemaVersion 不兼容时提示用户重置，不静默丢数据。datasetVersion 改变但 schema 兼容时保留已存会话，用户可主动重置体验新样例。

这是相对时间的展示策略，不是假装任务每天被真实用户发布。界面保留“演示数据”标识。已接任务到期只标超时；只有 open 自动转 expired。

## 5. 服务接口约定（待实现）

统一使用 Promise，成功返回 `{ok:true, data}`，业务失败返回 `{ok:false, error:{code,message,field?}}`。页面不直接写 localStorage。

| 服务方法 | 输入 | 结果 |
| --- | --- | --- |
| listTasks | category?、query?、pickupLocationId?、status? | 经过筛选的任务，附派生展示信息 |
| getTask | taskId | 任务、发布者、接单者、时间线、当前身份可执行操作 |
| createTask | actorId、form、requestId | 校验后新任务；生成唯一 ID |
| transitionTask | taskId、actorId、action、expectedRevision、requestId、payload? | 接单/开始/退出/交付/确认/取消/异议后的任务 |
| addReview | taskId、actorId、rating、comment、requestId | 新评价；不重复增加信用 |
| getProfile | userId | 派生信用、评分、完成数量、相关事件 |
| switchDemoUser | userId | 切换演示身份，保持任务数据 |
| resetDemo | confirmed=true | 重置当前项目快照 |

错误码至少覆盖 `VALIDATION_ERROR / SELF_ACCEPT / LOW_CREDIT / TASK_EXPIRED / INVALID_STATE / FORBIDDEN / REVISION_CONFLICT / STORAGE_UNAVAILABLE / SEED_LOAD_FAILED / NOT_FOUND`。

同一 requestId 的重试返回原操作结果，不能重复应用事件；任务 revision 每次状态变更递增。completed 状态与唯一信用事件在一个快照操作中写入。生产后端不能信任前端 actorId，必须从已验证会话取得身份。

Mock 可以减少单页面重复操作问题，但 localStorage 不提供跨标签或跨设备的事务保证。真实多人接单需要后端事务与唯一约束，不在前端模拟“已经解决”。

## 6. 检查与版本管理

执行 `node scripts/check-mock.mjs` 或 `pnpm check:mock`，检查引用、角色、状态、时间顺序、金额、评价和信用事件。该检查针对种子一致性，不代表服务接口或 UI 已实现。

新增字段时更新本说明；破坏性变更递增 schemaVersion，并写明迁移/重置方式。测试截图和日志放在本地 artifacts/；公开仓库仅保存虚构数据和非敏感开发记录。
