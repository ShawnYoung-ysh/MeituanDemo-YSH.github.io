# Android / iPhone 真机验收记录

日期：2026-10-19（北京时间）｜版本：v0.6.0｜结论：Android 核心流程实测通过，部分条件待补；iPhone 无设备，未执行。完整手机发布门槛未满足。

正式入口：[校园跑腿互助平台](https://shawnyoung-ysh.github.io/MeituanDemo-YSH.github.io/)。业务提交 c2eb1c5，Pages 部署 39156054992 成功；手机实际显示“功能冻结预览 v0.6.0”。本次未发现新的业务缺陷，无新增业务代码修改。

## 设备与执行方式

| 字段 | Android / Chrome | iPhone / Safari |
| --- | --- | --- |
| 机型 | Redmi K20 Pro | 无设备 |
| OS | Android 10，API 29 | 未提供；目标 iOS 16+ |
| 浏览器 | Chrome 152.0.7977.82 | 未提供 |
| 屏幕 | 1080×2340，440dpi；横屏 2340×1080 | 未测 |
| 网络 | Wi-Fi；断网用例关闭后恢复；双卡槽 ABSENT，蜂窝未测 | 未测 |
| 时间 / 时区 | 手机时间 2026-10-19 09:37–10:03；Asia/Hong_Kong，UTC+8，与北京时间同偏移 | 未执行 |
| 版本 / 提交 | v0.6.0 / c2eb1c5 | 未执行 |
| 测试人 / 方式 | Codex 按用户授权，通过 ADB 操作已打开的 Chrome，保存屏幕截图与界面 XML | 未执行 |
| 本地证据 | artifacts/task-1-9-1-10/android/ | 无 |

用户已授权 ADB 操作和截图。最初启动 Chrome 的命令被自动审批策略拒绝，仅反馈策略阻止；用户手动打开网页后，截图、触控、输入和滚动均可执行，未再尝试被拒绝的启动命令。无需额外开放手机权限。

Chrome 默认缩放从 100% 调至 200%，再恢复 100%；旋转锁定/竖屏恢复原值 0/0，Wi-Fi 恢复开启并重新连接。未改系统字体、未装辅助应用。浏览器设置页中的私人账号不纳入交付证据。桌面模拟不计作真机通过。

## M01–M20 实测结果

“部分通过”仅表示列明的子项通过，其余仍待补。证据名称省略 .png，全部位于上方本地证据目录。iPhone 每项均未执行。

| 编号 | 内容 | Android 实际结果及证据 | iPhone |
| --- | --- | --- | --- |
| M01 | 正式链接、首次说明、首屏 | 通过：HTTPS 页面显示 v0.6.0，确认说明后可操作，无 GitHub 登录要求；home、hall | 未执行 |
| M02 | 横竖屏、滚动与返回 | 通过：大厅、发布、详情、我的任务、个人页实际旋转并浏览；landscape-hall、landscape-publish、landscape-detail-scroll、landscape-my-tasks、landscape-me | 未执行 |
| M03 | 底部安全区、末条内容 | Android 补充通过：底栏在系统手势条上方，评价末条可完整滚动到；html-review、both-reviews。iPhone 专项仍未测 | 未执行 |
| M04 | 最后字段、键盘、错误与提交 | 通过：商品预算输入 0，真实数字键盘弹出；滚动后提交可达，非法金额定位错误，收键盘后底栏恢复；last-field-keyboard、keyboard-submit、invalid-reward、ready-submit | 未执行 |
| M05 | 200% 缩放 / 字体放大 | 部分通过：设置明确显示 200%，大厅/个人页放大换行、导航可点击；zoom-settings-200、zoom-200-hall、zoom-200-result。放大下完整发布/交付未覆盖；zoom-restored-100 证明恢复 | 未执行 |
| M06 | 卡片、按钮、筛选、防误触 | 通过：类别/地点/身份/评分选择、搜索、卡片和导航可操作，重复点击无额外结果；category-options、pickup-options、rating-options、offline-hall、completed | 未执行 |
| M07 | 非法表单、输入保留 | 部分通过：酬谢 100 被拦截，其他输入保留；改 3.50 后同一任务成功发布；invalid-reward、ready-submit、published。空白标题、过去截止时间未在真机单独提交，桌面/自动化已有覆盖 | 未执行 |
| M08 | 发布、切身份、接单与权限 | 通过：u001 发布 Android test task，切 u002 从大厅接单；发布者不能自接；published、runner-hall、ready-accept、runner-accepted | 未执行 |
| M09 | 开始、交付、确认与信用 | 通过：u002 从详情开始并交付，u001 从我的任务找到待确认任务并确认，信用 80→82；start-dialog、delivery-ready、publisher-tasks、completed、credit-event | 未执行 |
| M10 | 重复点击、刷新、重复评价 | 通过：连续点确认后只有完成反馈，本任务仅一条 +2；双击评价后双方各一条，已评无提交入口；刷新保留记录；completed、credit-event、html-review、both-reviews、refreshed-reviews、after-zoom | 未执行 |
| M11 | 低信用、自接、过期拦截 | 通过：u005 信用 58 无接单入口，自己的任务不能自接，t011 已截止不可接；lowcredit-blocked、published、expired-settled | 未执行 |
| M12 | 刷新 / 重开 / 直达恢复 | 部分通过：地址栏任务锚点直达、Chrome 刷新后状态/身份/信用保留；direct-reload、refreshed-reviews、credit-event、reconnected-reload。关闭标签页或浏览器再重开未执行 | 未执行 |
| M13 | 存储 / 种子失败恢复 | 隔离环境真机通过：USB 转发至本机故障服务，503 后点击重试恢复，损坏记录确认重置恢复，存储 getter 禁用时提示临时会话；phone-seed-failure、phone-seed-recovered、phone-storage-corrupt、phone-corrupt-reset-dialog、phone-corrupt-recovered、phone-storage-denied。并非正式站点发生真实故障 | 未执行 |
| M14 | 重置与身份切换 | 通过：切换保留新任务；重置先确认，取消保留 u005，确认恢复 u001、原样例与 u002 信用 80；reset-section、reset-dialog、reset-cancelled、reset-complete、reset-credit-options | 未执行 |
| M15 | 过期、取消、退出、争议、空结果 | 通过：无结果可清空恢复；接单后退出回待接单；u001 取消 t001、对 t007 提出异议均反馈信用不变；offline-hall、offline-cleared、withdrawn、expired-settled、cancelled-task、disputed-task | 未执行 |
| M16 | 慢网与已加载后断网 | 部分通过：Wi-Fi 关闭且无 SIM，Chrome 明示断网时仍可筛选、进详情和接单；恢复后刷新保留接单；offline-cleared、offline-detail、offline-accepted、reconnected-reload。隔离服务延迟种子约 1.8 秒，手机先显示加载反馈再进入大厅；phone-slow-loading、phone-slow-ready。真实弱网/首次离线未测，不承诺首次离线可用 | 未执行 |
| M17 | 蜂窝、HTTPS、无需登录 | 部分通过：Wi-Fi 下 HTTPS/业务资源可访问，无 GitHub 登录要求；home、published。无 SIM，蜂窝及中端 Android/4G 三秒目标未测；未声称 Chrome 已退出 GitHub 账号 | 未执行 |
| M18 | 信用明细、统计、双向互评 | 通过：本任务实际 +2、80→82、跑腿完成数 2、收到评分 5.0/2 条可见；双方 5 星/4 星互不覆盖，评价不加信用；runner-credit、credit-event、after-zoom、both-reviews | 未执行 |
| M19 | 系统返回、未提交输入 | 通过：填写 AndroidBackDraft，系统返回先收键盘、再回前一任务；重新进入发布页标题保留；draft-keyboard、system-back-history、draft-returned | 未执行 |
| M20 | HTML / 长文本安全显示 | 通过：评论 `<b>Android</b>` 按字面显示；另一方 300 字连续文本换行，末条与导航不重叠；html-review、long-review-ready、both-reviews。脚本执行边界另有自动化/桌面覆盖 | 未执行 |

## 关键操作记录

- 新任务 t-0c9efc4e-3d15-41aa-b327-8038d7d7e891：代取快递，北门驿站→学生公寓公共门厅，酬谢 3.50、预算 0，快捷截止 2 小时后。双方完成并互评后，按重置用例清除；截图保留全过程。
- 交付说明 Delivered to public hall。u002 确认前信用 80，确认后 82，本任务明细仅一条实际 +2；互评后仍 82，重置后恢复 80。
- 断网使用种子 t001：u002 接单，联网刷新仍已接单，再退出；后续重置后由 u001 取消。t007 由 u001 填写 Demo missing pages 并提出异议。
- 10:01–10:03 补测 M13 与受控延迟加载：手机通过 ADB reverse 将 4174 端口转发至本机仅回环监听的独立故障服务。每场景使用独立记录命名空间，正式站点记录不受影响；测试后返回正式站点、移除本次端口转发并停止测试服务。测试页标签改为与设备无关的“隔离环境，非正式站点”，正式业务代码未改变。
- 抓图来自真实屏幕。ADB 传输增加的 CR 字节仅在 PNG 签名不符时还原，不改变像素。200% 缩放后 Chrome 网页 XML 部分仅返回 WebView，后续以屏幕截图定位和核验，不误报为页面空白。
- 本轮未发现新的阻塞或严重业务缺陷。截图/XML 仅本地归档，公开仓库保存无私人信息的报告；设备序列号、网络标识、浏览器账号不公开。

## 尚待补测与结论

2026-10-20 说明补充（本次未新增实测）：本文“蜂窝”指手机 SIM 卡的 4G/5G 移动数据，即关闭 Wi-Fi 后使用手机流量访问。上次手机无 SIM 卡，因此没有这部分证据。“剩余 Android 验收”具体指以下五组未覆盖条件，不是已复现的功能故障。

| 编号 | 已覆盖 | 尚未覆盖的 Android 真机条件 |
| --- | --- | --- |
| M05 | 200% 缩放显示、换行和导航 | 在 200% 缩放下完整操作发布至交付流程 |
| M07 | 酬谢金额越界被拦截、输入保留 | 单独提交空白标题、过去的截止时间；桌面/自动化已有覆盖 |
| M12 | 刷新、详情链接直达后恢复 | 关闭标签页或浏览器再打开，核对任务、身份与信用保留；桌面重开已有覆盖 |
| M16 | 已加载后断网操作、受控约 1.8 秒种子延迟 | 真实弱网，以及首次打开就无网络时的表现；不承诺首次离线可用 |
| M17 | Wi-Fi 下 HTTPS、资源访问、无需 GitHub 登录 | 手机卡 4G/5G 访问、资源加载和首屏可操作耗时；原 4G 三秒目标尚无实测结果 |

Android：M05 放大下完整流程、M07 两类非法表单、M12 关页重开、M16 真实弱网/首次离线、M17 蜂窝及 4G 耗时。iPhone：取得设备后执行全部 M01–M20，优先键盘、Safari 返回手势和底部安全区。

task 1-9 异常回归完成；task 1-10 Android 核心真机实测完成，但两端完整验收仍未完成，不能宣布 M2/M3 或全部手机发布门槛通过。可准备下一轮演示材料，保留以上待测条件。
