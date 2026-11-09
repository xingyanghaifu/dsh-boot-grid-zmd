# 自检与验收记录

> 被测版本：`dsh-boot-grid-zmd@0.1.0`
> 自检日期：2026-11-09 · 环境：Windows / Edge 157.0.4341.42（headless, CDP）/ Node 24.18
> 产物：`assets/index.html`（静态动画）、DSH 插件（`entry.js` + `assets/screen.js`）

---

## 1. 运行方式与证据

| 项目 | 命令 / 文件 | 结果 |
|---|---|---|
| 直接运行 | `start dsh-boot-grid-zmd/assets/index.html` | 通过（file:// 下 CSS/JS/数据/PNG 全部加载） |
| 自动演示 | `.../index.html?auto=1` | 通过：约 16s 自动走完四拍并进入完成页 |
| 插件真实路由 | `node tools/serve.mjs 8123` → `http://127.0.0.1:8123/plugins/dsh-boot-grid-zmd/` | 通过：HTML/CSS/JS/数据/PNG 均 200，页面完整渲染（`docs/shots/40-subpath.png`） |
| DSH 实机路由 | 装进当前 profile 后请求 `http://127.0.0.1:50130/plugins/dsh-boot-grid-zmd/` | 通过：index/CSS/JS/数据/PNG 200；旧 `dsh-boot-grid` 路由 404（已停用），新屏为唯一启动屏（`docs/shots/41-live-route.png`） |
| DSH 注入逻辑 | `node smoke.mjs` | 通过：路由注册、注入表 2 条、6 个资产、404 拦截、脚本引用检查 |
| 页面静态检查 | `node tools/check.mjs` | 通过：50 个 id / 46 个 JS 引用无缺失、无语法错误、脚本文件存在 |
| 空间层次复检 | `node tools/depth-test.mjs` | 通过：15 项 PASS；详见 §9 |

---

## 2. 功能自检（真实鼠标 / 键盘事件）

测试脚本：`tools/test.mjs`、`tools/probe.mjs`、`tools/takeover.mjs`。

| 检查项 | 方法 | 结果 |
|---|---|---|
| 按住 1.5s 接入 | CDP 真实 `mousePressed` → 1500ms → `mouseReleased` | 通过：phase `access → order`，进度 12% |
| 按住不足被中断 | 提前松手 / 移出 | 通过：红框 + 抖动 + `已中断 · 需持续按住 1.2 秒` |
| 指令逐字打出 | 观察 DOM 文本 | 通过：26ms/字，完成前「复诵」禁用 |
| 复诵 | 点击「复诵」 | 通过：绿色回显逐字打出，「执行」解禁并获得焦点 |
| 执行 | 点击「执行」 | 通过：phase `order → close`，进度 52% |
| 拖动合闸 | 真实鼠标从把手拖到轨道 100% | 通过：电压 0.0→525.0 kV，phase `close → boot` |
| 未到位松手 | 拖到 50% 松手 | 通过：320ms 弹回 0%，`把手未到位 · 已复归` |
| 合闸键盘 | 方向键 + Home/End + Enter | 通过（`role="slider"`，`aria-valuenow` 同步） |
| 全网启动 | 等待 | 通过：6.4s 扫描，进度 72→100%，进入完成页 |
| 完成页进入 | 点击 CTA / Enter | 通过：独立页重播；iframe 内 `postMessage` 给宿主 |
| iframe 消息 | `tools/iframe.html` 监听，不点击 | 通过：完成页 3 秒后自动收到 `boot-grid-zmd:done` |
| 自动演示被接管 | `?auto=1` 中点击空白处 | 通过：`auto=false`、phase 停在 `access`、holding 复位 |
| 覆盖层 screen.js | 注入后检查 iframe，再按 Esc | 通过：iframe `src=.../?auto=1`，Esc 后 1s 内移除（`tools/overlay-test.mjs`） |
| 悬停反馈 | 鼠标移到「昌吉」节点 | 通过：经纬读数跟随、节点角括号、tooltip `昌吉 · ±1100 kV`（`docs/shots/16-hover-node.png`） |
| 键盘按住接入 | focus + 按住 Space 1.4s | 通过：phase `order`，hold=1 |
| 减弱动效 | `prefers-reduced-motion: reduce` | 通过：扫描带/入场位移关闭，交互与状态保留 |
| 控制台错误 | 全流程监听 `Runtime.exceptionThrown` / `Log.entryAdded` | 0 条 |

---

## 3. 视觉自检

### 3.1 分辨率

| 尺寸 | 结果 | 证据 |
|---|---|---|
| 1440 × 900（主验收尺寸） | 通过；左栏、地图、交互坞均在画框内 | `shots/01-access.png`、`03-order.png`、`04-close.png`、`05-boot.png`、`06-done.png` |
| 1920 × 1080 | 通过；标题/读数放大，未溢出画框 | `shots/31-access-1920.png` |
| 1366 × 768（常见笔记本） | 通过；未压到画框/危险带 | `shots/32-access-1366.png` |
| 1280 × 720（短屏降级） | 通过；隐藏状态行/seq、缩小读数，未压到底框 | `shots/30-access-1280.png` |
| 1024 × 768（应急降级） | 通过；隐藏操作员 idline，指令/回显换行显示（非主验收尺寸） | `docs/depth/regression/1024x768-*.png` |

### 3.2 终末地风格一致性（对照 `research/zmd-style.md`）

| 判据 | 结果 | 证据 |
|---|---|---|
| 石墨底 `#0f1419`、纸白 `#f1eee5` | 通过 | 全局 |
| 信号黄占比 2–6%，只在读数/进度/角标/危险带 | 通过；无黄色底块（仅 420ms 收尾扫屏） | `01-access.png`、`17-sweep.png` |
| 全直角、无切角、无圆角卡片 | 通过；CSS 无 `clip-path`/`border-radius`（状态点/圆环除外） | `boot.css` |
| 线宽 1 / 2 / 6px | 通过；无更粗容器描边 | `boot.css` |
| 58px 画框 + 12px L 角 + 26px metabar | 通过；`--edge` 上限 58px | `01-access.png` |
| 14px 竖轨 + 41px 刻痕 | 通过 | `04-close.png`、`05-boot.png` |
| 中文不进超大拉丁字标位 | 通过；主字标为 `SC–01`，中文为 22px 标注行 | `01-access.png` |
| 单次 420ms 全屏黄扫收尾 | 通过 | `17-sweep.png`（180ms 定格） |
| 不用青蓝泛光 / 无 glitch | 通过；绿只做「认证/带电/正常」 | 全片 |
| 逐字模糊上移 | 通过；`SC–01` 550ms blur 8px→0 | 录屏/帧 |

### 3.3 线条与艺术性

- 省界 1px / 结构线 1px / 数据线 0.9px；无粗描边堆叠。
- 地图是石墨实体板 + 单色线稿 + 单色光点；厚度来自浅底座、上亮下暗的侧壁和遮挡顺序，颜色只在「带电」时介入。
- 黄扫、扫描线、竖轨、读数构成四个视觉重音，其余留白；信息密度靠排版而非装饰。
- 所有图形为直角正交构图；唯一旋转/圆形是状态点与进度环，符合「工业感来自线宽统一 + 密度」。

---

## 4. 交互反馈清晰度

| 反馈类型 | 表现 | 可感知性 |
|---|---|---|
| 进行中 | 圆环/填充连续变化、计时/电压数字实时更新、嗡鸣随进度 | 强（视觉 + 听觉双通道） |
| 成功 | 边框转绿、短音、提示条、日志、进度推进 | 强 |
| 失败 | 红框 + 抖动 + 明确文案 + 日志 | 强（不会静默失败） |
| 下一步 | 复诵完成后自动聚焦「执行」；合闸到位后提示语变绿 | 强（键盘用户无需摸索） |
| 悬停 | 经纬读数 + 节点括号 + tooltip | 中（细节层，不干扰主流程） |
| 跳过 | 底部「跳过 ESC」始终可见；Esc 在任意阶段生效 | 强 |

---

## 5. 官方文档符合性（详见 `docs/official-crosswalk.md`）

| 检查项 | 结果 |
|---|---|
| 法定名称 / 英文名 | 通过（全称，无旧名） |
| 标识等比、不改色、不加特效、白底净空 | 通过（48px，净空 12px） |
| 国网绿只做「认证/正常」 | 通过 |
| 复诵挂 GB 26860—2011 §7.3.1.2 | 通过（未误挂《调度管理条例》） |
| 合闸挂 GB 26860—2011 §7.3.6.1 | 通过 |
| 并网前置引用《条例》§25/§26 | 通过（日志） |
| 现行宗旨「人民电业为人民」 | 通过（完成页） |
| 2024 年数据带年份与口径 | 通过 |
| 无停用口号 / 无 Q/GDW 条款号 / 无 SGCC 缩写 | 通过 |
| 非官方、非实时、非商用声明 | 通过（顶部 SIM、底部声明、完成页脚注） |
| 地图非标准地图 | 已标注 `SIMULATED` 并在文档限定 |

---

## 6. 自检中发现并修复的问题

| # | 问题 | 原因 | 修复 |
|---|---|---|---|
| 1 | 左栏文字被黄色竖条遮住 | `.rail` 被包进了 `.leftcol`，`left:0` 相对于左栏定位 | 把 `.rail` 移回 `#stage` 直接子级 |
| 2 | 「复诵」按钮消失且撑满交互坞 | 按钮状态类 `.done` 与完成页 `.done{position:absolute;display:grid;opacity:0}` 冲突 | 按钮状态改名 `.settled`，与完成页解耦 |
| 3 | 左进度 97% / 坞内 98% 不一致 | 两处分别 floor/round | 统一 `Math.floor`，坞内改为总进度 72→100% |
| 4 | 1280×720 下读数压到底框 | 左栏/坞用 `vh` 定位，短屏时落进画框 | 统一以 `--edge` 为锚点，短屏隐藏状态行与 seq、缩小读数 |
| 5 | 1920×1080 左栏内容被 `margin-top:auto` 撕开 | 两处 `auto` 分配空白 | 遥测改固定间距，仅读数吸底；加大标题/读数上限 |
| 6 | 收尾白光与 ZMD 不符 | 原实现是 hush+白闪 | 换成 420ms 全屏黄扫 → 黑场 → 完成页 |
| 7 | 悬停 tooltip 不出现 | `pointermove` 绑定在 `#map`，但坐标换算用了错误原点 | 修正经纬反算，节点 15px 命中 |
| 8 | 自动演示中真实输入后按住状态卡死 | `holding` 未复位 | `manualTakeover()` 复位 holding、取消 rAF、清空填充 |
| 9 | 完成页未显示时按钮可被 Tab 到；`aria-live` 每帧播报进度；DSH 覆盖层播完要等点击才交还 | 完成页只做了 opacity；dock 带 aria-live；无自动交还 | 完成页改 `visibility` 切换、背景层 `inert`、去掉 dock 的 aria-live、iframe 内 3 秒倒计时自动交还 |
| 10 | 1024×768 指令与回显被横向裁切 | 指令使用 `white-space: nowrap`，窄屏容器不足 | 1120px 以下允许换行并缩小字号/字距，回归通过 |
| 11 | 首版深度地图逐帧重绘 5153 点，帧间隔 33.3ms | 每点切换 `fillStyle` + 每帧整图 `drawImage` | 地图/城市点/热点烘焙，逐帧一次 `clip + drawImage`，回到 16.7ms |

---

## 7. 复现命令

```bash
cd E:/dshwork/dsh-boot-grid-zmd
node smoke.mjs                     # 宿主半边 + 资产白名单
node tools/check.mjs               # HTML/CSS/JS 引用与语法
node tools/serve.mjs 8123          # 用真实路由起服务
# 另开无头 Edge（--remote-debugging-port=9223）后：
node tools/capture.mjs "file:///E:/dshwork/dsh-boot-grid-zmd/assets/index.html" out.png 2600
node tools/test.mjs                # 四拍交互全流程
node tools/probe.mjs               # 悬停 / 黄扫 / 键盘 / 减弱动效
node tools/takeover.mjs            # 自动演示接管 + iframe 消息
node tools/depth-capture.mjs docs/depth/after   # 同状态空间层次截图
node tools/depth-test.mjs          # 本轮全量回归（已安装路由）
node tools/perf.mjs                # 90 帧间隔采样
```

---

## 8. 未覆盖 / 风险

1. **未在浏览器里录屏验证刷新后的 iframe 覆盖层**：插件已在当前 profile 安装并启用，旧启动屏已停用；资源路由与页面渲染已在 50130 实机验证（`41-live-route.png`），但「刷新 DSH 首页 → 覆盖层自动播放」这一步需要用户刷新页面触发，未在本轮自动录屏。
2. **官方 VI 手册 / 矢量标识 / 色卡未获取**：见设计说明 §10 与对照记录 §4。
3. **地图非标准地图**：仅本地演示，不可直接公开发布。
4. **未做移动端竖屏版式**：主验收尺寸 1440×900；1280×720 为短屏下限；1024×768 只做应急降级验证。
5. **音频未做听感验收**：只验证了 AudioContext 创建与音量上限（0.035 增益），未做主观试听；默认在首次真实输入后才发声，可一键关闭。
6. **帧率只做本机 headless 采样**：16.7ms 中位只代表本次 Edge/headless 环境，不代表所有 GPU/DPI 或真实 DSH 覆盖层场景。

---

## 9. 空间层次优化复检（2026-11-09 第二轮）

对比图：[接入](depth/compare-access.png) · [指令](depth/compare-order.png) · [合闸](depth/compare-close.png) · [启动](depth/compare-boot.png)
完整说明：[`depth/optimization.md`](depth/optimization.md)；原始结果：[`depth/regression/results.json`](depth/regression/results.json)。

| 检查项 | 结果 |
|---|---|
| 短按中断后回 access、`hold=0` | PASS |
| 复诵前「执行」禁用；合闸 48% 松手回弹到 0 | PASS |
| 真实鼠标四阶段到完成页 | PASS |
| 减弱动效键盘四阶段；地图 220ms 内无变化；扫描条隐藏；无黄扫 | PASS |
| 自动演示被真实输入接管 | PASS |
| 1920 / 1440 / 1366 / 1280 / 1024 × 四阶段：按钮不越坞，指令/回显/提示不横向裁切 | PASS |
| 抬高后的节点顶面命中「昌吉」 | PASS |
| 注入真实 `screen.js` 后 Esc 移除覆盖层；自动四阶段并完成 iframe 交还 | PASS |
| 控制台异常 | 0 |
| 页面资源失败 | 仅浏览器自动请求的 `/favicon.ico` 404；页面自身无失败 |
| 89 帧帧间隔（1440×900，`?jump=boot`） | 中位 16.7ms / p95 16.7ms / >50ms 0 帧 |
| 同版本烘焙前采样 | 中位 33.3ms / p95 50ms / >50ms 3 帧（后通过烘焙消除） |

说明：本轮修改了 `assets/index.html`、`assets/boot.css`、`assets/boot.js`，新增 `tools/depth-capture.mjs`、`tools/depth-test.mjs`、`tools/perf.mjs`、`docs/depth/`；未改官方标识、品牌文案、地图数据、四阶段流程或 DSH 路由。
