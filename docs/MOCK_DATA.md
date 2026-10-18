# Mock 数据交接与接入约定

日期：2026-10-18｜数据集版本：2026-10-18.1｜schemaVersion：1

数据文件：[mock/db.json](../mock/db.json)。用户已允许将虚构测试数据推送到公开 GitHub 仓库。本数据集不含真实账号、学号、手机号、邮箱、取件码、精确坐标或访问令牌。

## 1. 使用边界

这是一份可随静态网站发布的只读种子数据，不是服务器数据库。网页首次读取它，后续修改存到当前浏览器 localStorage；不能直接修改 GitHub 上的 JSON。跨设备和跨浏览器不共享操作记录。未来多人版通过数据适配层接真实 API。

数据文件及 Mock 适配层已经接入。会话、任务大厅、发布、状态操作、我的任务、个人资料、信用明细和评价写入均已实现（v0.5.0）；具体发布结果见 ACCEPTANCE.md。

v0.6.0异常修复：首次初始化/首次重置在下载前记录持久化原文，保存前再次比较，即使尚无内存快照也阻止旧下载结果覆盖外部新记录。所有页面服务的EXTERNAL_CHANGE统一进入刷新提示。快照/schema/种子版本未变，不迁移或清空合法v1记录。

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
4. 快照结构约定为 `{schemaVersion, datasetVersion, initializedAt, activeUserId, db, processedRequests}`，其中 initializedAt 为 anchor，activeUserId 初始为 u001。实现增加可选字段 `preferences: {introAcknowledged: boolean}` 保存首次说明的确认状态；缺少此字段的 v1 快照按 false 恢复，不需要升级 schema。
5. 每次操作先校验并构造完整新快照，单次 `setItem` 保存后更新 UI；若写入失败，可在明确提示的临时内存模式下继续。
6. 重置先征求确认，再重新载入种子并生成新 anchor，仅替换此项目键。实现采用先准备、校验新快照，再单次覆盖项目键的方式，避免种子加载失败时丢失旧记录；不得调用 `localStorage.clear()` 清除同源其他应用数据。写入失败则保留旧持久化记录并进入临时会话，明确提示刷新可能恢复旧记录。
7. schemaVersion 不兼容时提示用户重置，不静默丢数据。datasetVersion 改变但 schema 兼容时保留已存会话，用户可主动重置体验新样例。

这是相对时间的展示策略，不是假装任务每天被真实用户发布。界面保留“演示数据”标识。已接任务到期只标超时；只有 open 自动转 expired。

## 5. 服务接口约定（会话、查询、发布与状态操作已实现）

基础阶段已实现 `createDemoService(repository)`：`initialize`、`getSession`、`switchDemoUser`、`acknowledgeIntro`、`resetDemo` 和只读 `getTask`。统一返回下述成功/失败结构；会话数据附 `persistence.mode`（persistent/memory）及存储失败提示。大厅、发布、详情及状态操作的完成情况见以下分阶段补充。

task 1-4 新增 `createTaskService(repository, {now?})`，由 demoService 统一导出 `listTasks` 与 `getTask`。`now` 可注入时钟进行边界测试，浏览器默认使用 Date.now：

- `listTasks` 默认 status=open，仅返回当前身份所属校区；类别、关键词、取件地点取交集。关键词匹配标题、描述、取送地点和类别名称，做首尾空白清理、NFKC 与大小写归一化，不解析 HTML。
- 成功的 `data` 为 `{tasks, categories, locations, totalOpen, checkedAt, persistence}`。locations 同样限制在当前校区；tasks 按截止时间升序，时间相同再按发布时间降序及 ID 排序。
- 每次列表与详情读取在仓库串行更新边界内检查到期：只有 open 且 deadlineAt≤当前时间才更新 expired、revision、updatedAt 和一条系统时间线。没有变化时返回快照副本，不写 localStorage；不修改信用、评价和初始化 anchor。
- 详情附 `statusLabel/isOwn/isOverdue/isUrgent/remainingMinutes` 及类别、发布者、接单者、地点信息。已接单、跑腿中和待确认任务超时仅增加派生标记，不自动改状态；待接单剩余不超过 60 分钟标为紧急。
- 大厅在页面可见时每 15 秒复查，并在重新回到前台时复查；离开页面释放定时器。筛选与滚动位置在本次页面会话内保留，不增加持久化字段。

task 1-5 新增发布与完整详情展示：

- `getPublishOptions()` 返回 `{actor,campus,categories,locations}`，地点仅来自当前校区。
- `createTask({actorId,form,requestId})` 的 form 为 `{category,title,description,pickupLocationId,dropoffLocationId,deadlineAt,reward,goodsBudget?}`。deadlineAt 为绝对毫秒时间戳；reward/goodsBudget 为元的十进制文本，预算留空按 0。服务精确转换为整数分，不按浮点金额四舍五入；酬谢 0–5000 分，预算非负且须为安全整数分。
- 校验标题 4–60、说明 10–500（去除首尾空白）、地点/类别有效、提交时距截止 10 分钟至 24 小时。失败返回 `VALIDATION_ERROR`，附 `error.field` 首字段及 `error.fields` 字段提示映射；校验失败不写入快照。
- actorId 必须等于当前 activeUserId；身份变化的旧表单返回 FORBIDDEN。低于 60 信用的身份仍可发布。
- 成功返回 `{task,persistence}`。新任务为 open、revision=1，任务和首次 published 时间线一并保存，不生成信用事件。页面成功后进入锚点详情，存储失败时明确显示临时会话。
- 请求记录保存到 `processedRequests['createTask:'+requestId] = {operation,actorId,fingerprint,taskId,result}`。result 为创建时的独立任务副本；同一请求重试返回原结果，不因之后到期再创建或重新校验旧截止时间。相同 requestId 携带不同内容返回 REVISION_CONFLICT。任务和请求记录在一次快照写入中保存，恢复时检查记录结构；这是 v1 的增量实现，无需更改种子版本。
- `getTask` 新增发布者/跑腿者的派生信用、评分、跑腿完成数，timeline.actorName、campus、acceptBlocker 及 persistence/checkedAt。接单阻止原因覆盖自接、过期、已接、低信用与跨校区；本阶段只展示原因，实际状态动作在 task 1-6 接入。
- datetime-local 输入按本地年月日时分逐项构造并校验，不依赖非标准日期字符串。未提交表单仅保存在本次页面会话的内存中，按身份隔离，刷新/关页提示可能丢失；不增加持久化草稿字段。

task 1-6 新增状态操作与唯一信用入账：

- `transitionTask({taskId,actorId,action,expectedRevision,requestId,payload?})`；actorId 必须是当前演示身份，expectedRevision 必须是当前任务的正整数版本。requestId 为 8–128 位字母、数字、下划线或连字符。服务内部串行校验和更新，页面不直接修改数据。
- `getTask` 附 `allowedActions`，由同一套服务规则计算；详情依此展示动作，提交时服务仍重新校验。低信用限制只阻止接新单，不阻止已接任务继续履约。

| action | 来源 → 目标状态 | 操作者 | payload |
| --- | --- | --- | --- |
| accept | open → accepted | 同校区、非发布者、信用 ≥60 的身份；未截止 | confirmed: true |
| cancel | open → cancelled | 发布者 | confirmed: true |
| start | accepted → in_progress | 接单者 | 无 |
| withdraw | accepted → open 或 expired | 接单者 | confirmed: true |
| submit_completion | in_progress → awaiting_confirmation | 接单者 | completionNote |
| confirm_completion | awaiting_confirmation → completed | 发布者 | confirmed: true |
| dispute | awaiting_confirmation → disputed | 发布者 | disputeReason |

- completionNote/disputeReason 必须是文本，去除首尾空白后 1–500 字；UI 和服务均校验，展示按纯文本处理。取消、退出、异议都不产生信用事件，disputed 暂不提供仲裁操作。
- 退出清除 runnerId；截止前回到 open，截止后记 withdrawn 和系统 expired 两条时间线，一次命令递增一次 revision。其他成功动作各增加一条时间线与一次 revision；updatedAt 不早于上次更新时间。已接单/进行中/待确认超时不自动关闭。
- 命令在串行更新内检查 open 到期。若动作因截止而失败，必要的到期状态和系统事件仍会保存；非法操作本身不应用。已截止 open 任务按 expired 规则返回错误。
- 同一快照写入任务状态、时间线、请求结果，确认完成还写入唯一 `credit-${taskId}-completed` 事件。事件 delta=2，用户信用由事件派生并封顶 100；成功 data 为 `{task,creditAward,persistence}`，非确认动作 creditAward=null，确认时为 `{userId,before,after,delta:2,appliedDelta}`，实际增量 appliedDelta 为 0/1/2。
- 请求记录键为 `transitionTask:${requestId}`，含 operation、actorId、taskId、action、fingerprint、result。指纹绑定任务、身份、动作、原 revision 和 payload；相同请求返回原任务副本及原信用结果，不再次变更。相同 ID 换内容返回 REVISION_CONFLICT；不同 ID 也受状态与信用事件唯一性约束。页面成功或失败后重新读取当前任务，避免旧请求结果覆盖最新状态。
- 恢复时校验已知状态请求记录的引用、结果结构、revision、时间线和信用结果。写入失败进入临时内存模式，任务与信用仍一起更新，旧持久化快照不变；页面明确提示刷新可能恢复旧记录。此保证限于单页面串行操作。

task 1-7 / task 1-8 合并补充：

- `listMyTasks({role='publisher',status=''})`，role 只接受 publisher/runner，status 留空表示全部，否则使用已有任务状态。只匹配当前 activeUserId 的 publisherId/runnerId；退出不再属于当前接单者。返回 `{tasks,counts,total,role,status,checkedAt,persistence}`，counts 为当前角色全部状态计数，total 不受状态过滤影响；活动任务优先，然后按 updatedAt 降序、ID 排序。与大厅/详情共用 open 到期检查与派生信息。
- 我的任务保存每个身份在当前页面会话内的角色、状态和滚动位置，不增加持久化字段。详情从该列表进入时提供返回我的任务入口。定时刷新在离开后清理；刷新浏览器仍恢复业务快照，但列表筛选回到默认。
- `getProfile(userId?)` 默认当前身份，返回用户演示资料、campus、credit、rating、reviewCount、completedAsPublisher、completedAsRunner、creditEvents、reviews、persistence。完成数只统计 completed，评分为收到的评分平均值保留一位小数，没评价时 rating=null。
- creditEvents 附 taskTitle/before/after/appliedDelta；历史基数单列，明细按数组入账顺序从新到旧展示，保留 delta=2 和实际封顶增量 0/1/2 的区别，不按回拨的设备时钟重新分配增量。原有 t008/t009 信用不重发；reviews 附作者与任务标题并按时间倒序。
- `addReview({taskId,actorId,rating,comment='',requestId})`：仅已完成任务双方、当前演示身份可提交；评价对象由服务推导，客户端不可指定。每任务每作者一次，1–5 整数星；comment 选填，必须是字符串，去除首尾空白后 0–300 字，纯文本展示。双方不互相覆盖，不改变任务 revision/updatedAt、信用或完成数量。重复作者返回 ALREADY_REVIEWED。
- 评价与 `processedRequests['addReview:'+requestId] = {operation:'addReview',actorId,taskId,fingerprint,result}` 一次保存，result 为原始评价副本；同请求内容重放不再写，内容变化返回 REVISION_CONFLICT。requestId 格式与状态操作相同。恢复时检查结果是否对应真实评价，损坏记录保留原文并提示恢复。成功 data 为 `{review,persistence}`；存储失败进入临时会话并保留旧持久化记录。
- 同源其他标签 storage 变更时页面提示刷新、停用旧内容与导航；仅监听本项目键或同源 clear 事件，不读取其他应用数据。仓库读取/写入前对比原持久化文本，发现变化返回 EXTERNAL_CHANGE，阻止旧页写入或重置；刷新重新加载最新快照。该检测不是事务锁，同时竞态仍需后端解决。

统一使用 Promise，成功返回 `{ok:true, data}`，业务失败返回 `{ok:false, error:{code,message,field?}}`。页面不直接写 localStorage。

| 服务方法 | 输入 | 结果 |
| --- | --- | --- |
| listTasks | category?、query?、pickupLocationId?、status? | 经过筛选的任务，附派生展示信息 |
| listMyTasks | role?、status? | 当前身份的发布/接单列表、状态计数 |
| getTask | taskId | 任务、发布者、接单者、时间线、当前身份可执行操作 |
| createTask | actorId、form、requestId | 校验后新任务；生成唯一 ID |
| transitionTask | taskId、actorId、action、expectedRevision、requestId、payload? | 接单/开始/退出/交付/确认/取消/异议后的任务 |
| addReview | taskId、actorId、rating、comment、requestId | 新评价；不重复增加信用 |
| getProfile | userId | 派生信用、评分、完成数量、相关事件 |
| switchDemoUser | userId | 切换演示身份，保持任务数据 |
| resetDemo | confirmed=true | 重置当前项目快照 |

错误码至少覆盖 `VALIDATION_ERROR / SELF_ACCEPT / LOW_CREDIT / TASK_EXPIRED / INVALID_STATE / FORBIDDEN / REVISION_CONFLICT / ALREADY_REVIEWED / EXTERNAL_CHANGE / CONFIRMATION_REQUIRED / STORAGE_UNAVAILABLE / SEED_LOAD_FAILED / NOT_FOUND`。

同一 requestId 的重试返回原操作结果，不能重复应用事件；任务 revision 每次状态变更递增。completed 状态与唯一信用事件在一个快照操作中写入。生产后端不能信任前端 actorId，必须从已验证会话取得身份。

Mock 可以减少单页面重复操作问题，但 localStorage 不提供跨标签或跨设备的事务保证。真实多人接单需要后端事务与唯一约束，不在前端模拟“已经解决”。

## 6. 检查与版本管理

执行 `node scripts/check-mock.mjs` 或 `pnpm check:mock`，检查引用、角色、状态、时间顺序、金额、评价和信用事件。该检查针对种子一致性，不代表服务接口或 UI 已实现。

新增字段时更新本说明；破坏性变更递增 schemaVersion，并写明迁移/重置方式。测试截图和日志放在本地 artifacts/；公开仓库仅保存虚构数据和非敏感开发记录。
