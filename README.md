# Think Anytime

Think Anytime 是一个 Chrome + Obsidian + Codex 阅读知识工作台。Chrome 负责捕获网页现场，本地 Bridge 负责调用 Codex、检索旧笔记和写入 Obsidian，Obsidian vault 负责长期保存。

Chrome 扩展的显示名是 `Think Anytime`。代码仓库地址仍是历史名称 `Think-Anything`；内部包名和部分环境变量仍保留 `TWYR`，来自项目原名 `Thinking, when you are reading!`。

## 能做什么

- 按 `Option+A` 唤出或关闭右侧常驻 Dock，按 `Option+D` 把当前选区或画面添加到 Dock 上下文。
- 在 Dock 里继续追问、并行多个阅读会话、恢复历史对话、查旧笔记、保存卡片、确认全文入库。
- 选区里包含链接时，会自动抓取可访问链接正文，回答时综合原选区和链接页面。
- Dock 可折叠、拖动、记住位置；默认收起在页面右下角，不再卡在正文中央。
- 默认模型是 `gpt-5.5`；默认提问走极速模式，只发送选区、附近上下文和最近对话，也可手动切到 `xhigh` 深度思考。
- 选区附近有图片、视频或 canvas 时，自动交给 Codex 看；视频优先抓字幕，没字幕再采样多帧，但不会自动理解完整未播放片段或音频。
- 右键图片或视频，点击 `Think Anytime：查看这张图片/视频`，直接基于画面讨论。
- 按 `Option+V` 快速保存当前选区或视觉材料。
- 保存后自动生成知识消化结构：一句话摘要、主题线索、兴趣点、后续问题、检索提示。
- 检索旧笔记时混合使用标题、摘要、主题、正文、路径、短语和本地语义重合度排序。
- 后台记录可回放 trace，回答可一键反馈“有用/没用”，用于后续评测和降权。
- 生成 Dream Proposal：把可能相关的笔记关系写成可审计提案，不自动污染长期知识库。
- 长期知识沉淀到 Obsidian：临时收件箱、全文来源、问题卡、洞察卡、讨论线程、主题索引。

## 架构

```text
packages/
├── shared      # 扩展和 Bridge 共用类型
├── bridge      # 本地 Node 服务，只监听 127.0.0.1
└── extension   # Manifest V3 Chrome 扩展
```

数据流：

```text
Chrome 页面选区/图片/视频帧
  -> Think Anytime Chrome Extension
  -> 127.0.0.1 本地 Bridge
  -> Codex SDK / Codex CLI
  -> Obsidian Markdown vault
```

## 环境要求

- macOS / Linux / Windows 均可开发，当前自动启动示例以 macOS 为主。
- Node.js 18+
- npm
- Google Chrome 或 Chromium
- Codex CLI 已登录
- 一个 Obsidian vault 目录

安装或登录 Codex CLI：

```bash
codex login --device-auth
```

如果使用 API key：

```bash
printenv OPENAI_API_KEY | codex login --with-api-key
```

## 安装

给朋友或另一个 AI Agent 安装时，优先把 [FRIEND_AGENT_INSTALL.md](./FRIEND_AGENT_INSTALL.md) 里的任务书整段发给对方 Agent。下面是人类手动安装说明。

```bash
git clone https://github.com/skyrim0624/Think-Anything.git
cd Think-Anything
npm install
npm run build
```

首次启动 Bridge：

```bash
npm run start:bridge
```

Bridge 会创建：

```text
~/.twyr/config.json
```

默认配置：

```json
{
  "token": "twyr_...",
  "vaultPath": "~/Documents/TWYR",
  "agentMemoryPath": "~/Documents/Agent-Memory",
  "codexCommand": "codex",
  "port": 47321
}
```

你可以直接编辑 `~/.twyr/config.json`，或用环境变量覆盖：

```bash
TWYR_VAULT_PATH="$HOME/Documents/TWYR" \
TWYR_AGENT_MEMORY_PATH="$HOME/Documents/Agent-Memory" \
TWYR_CODEX_COMMAND="codex" \
npm run start:bridge
```

`agentMemoryPath` 可不存在；不存在时只是少一部分旧笔记检索，不影响当前网页问答和保存。

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本仓库里的 `packages/extension/dist`。
5. 点击 Chrome 工具栏里的 `Think Anytime` 图标，打开侧边栏设置。
6. 填入：
   - Bridge URL：`http://127.0.0.1:47321`
   - Token：从 `~/.twyr/config.json` 复制 `token`

更新代码后，重新运行：

```bash
npm run build
```

然后在 `chrome://extensions` 里点 Think Anytime 的刷新按钮。

## 常用入口

- `Option+A`：唤出或折叠 Think Anytime Dock。
- `Option+D`：把当前选区、图片或视频画面添加到 Dock 上下文。
- `Option+V`：快速保存当前选区或视觉材料。
- `Command+Shift+K`：打开完整讨论工作台。
- 右键选中文字：解释、挑战观点、联系旧笔记、快速保存。
- 右键图片或视频：查看这张图片/视频。
- 右键页面：开启/关闭本页选区工具条，或建议全文入库。

Dock 内：

- `Enter`：发送。
- `Shift+Enter`：换行。
- 中文输入法组词时按 `Enter` 只确认输入，不会误发送。
- `Esc`：折叠 Dock，不清空当前对话。
- 拖动顶部细条：移动 Dock。
- 顶栏 `5.5 / 5.4 / mini`：切换 Codex 模型，默认 `gpt-5.5`。
- 顶栏 `⚡ / xH`：切换思考强度，`⚡` 使用 fast/low，`xH` 使用 deep/xhigh。
- 顶栏 `◷`：恢复最近的 Dock 对话，继续沿着原来的 session、threadPath 和上下文追问。
- 顶栏 `＋`：新对话；已有会话如果正在回答，会继续在后台等待，回答回到原会话。
- 顶栏 `⌄`：折叠 Dock。
- `Option+D` 附加上下文后会自动聚焦输入框，可以直接语音或键盘输入。
- `停止`：停止等待当前回答；迟到结果会被忽略。
- `重试`：重新发送上一问。
- `保存`：按 AI 建议写入卡片。
- `查库`：强制联系旧笔记。
- `入库`：二次确认后把全文保存到 `10-SOURCES/`。
- `展开`：进入完整工作台。

## Obsidian Vault 结构

默认 vault 路径是 `~/Documents/TWYR`，可在 `~/.twyr/config.json` 里改。

```text
00-INBOX/          临时捕获和视觉附件
00-INBOX/assets/   用户保存或入库后保留的图片、视频帧、canvas 截图
10-SOURCES/        用户确认后保存的全文原文
20-CARDS/          问题卡、洞察卡、观点卡、反驳卡、术语卡、摘录卡
30-THREADS/        围绕网页或主题的连续讨论
40-MOC/            来源索引、主题索引、阅读线索
90-SYSTEM/         schema、模板、skill、SQLite 索引、harness、dream 提案
```

新保存的卡片和全文会包含 `## 知识消化`：

- `一句话摘要`：快速理解这条记录为什么存在。
- `主题线索`：给后续检索和 Agent 判断使用。
- `与我产生连接的点`：保留用户当时为什么注意到它。
- `后续问题`：把阅读现场延伸成可继续思考的问题。
- `检索提示`：说明未来什么问题应该找回这条记录。

## Harness 与 Dream Proposal

Think Anytime Harness 用来验证系统是不是真的在变聪明，而不是只生成听起来合理的整理结论。

- Trace：`90-SYSTEM/harness/traces/YYYY-MM-DD.jsonl`，记录每次 ask、capture、retrieve、promote、dream 的后台判断。
- Feedback：`90-SYSTEM/harness/feedback.jsonl`，记录你对回答、检索和整理建议的接受或拒绝。
- Eval Run：`90-SYSTEM/harness/eval-runs/`，保存本地评测运行结果。
- Dream Proposal：`90-SYSTEM/dreams/*-proposal.md`，只生成可审计提案，不直接改 `20-CARDS/` 或 `40-MOC/`。

Dream Proposal v0 会先从现有混合检索中找候选关系，再让 Codex 判断关系类型。Codex 不可用时，会退回到保守的本地相似度提案，并明确标注这只是相似，不等于深层关系。

当前关系类型：

- `same-topic`
- `extends`
- `contradicts`
- `example-of`
- `method-for`
- `design-preference`
- `question-raised-by`

## API

除 `/api/status` 外，所有接口都需要 `x-twyr-token`。

- `GET /api/status`：检查 Bridge、vault、索引、Codex 状态。
- `POST /api/ask`：向 Codex 提问。
- `POST /api/capture`：保存片段、卡片或视觉材料。
- `POST /api/retrieve`：手动查旧笔记。
- `POST /api/promote-source`：确认后全文入库。
- `POST /api/feedback`：记录回答、检索或整理建议的用户反馈。
- `POST /api/dream/propose`：生成后台整理提案。

`/api/ask` 支持 `responseMode`：

- `fast`：默认模式，只使用选区、附近上下文、字幕/视觉附件和最近对话，不默认查库。
- `deep`：深度模式，用于查库、旧笔记关联和更完整的页面判断。

`/api/ask` 也支持 `model` 和 `modelReasoningEffort`；Dock 默认传 `gpt-5.5`，极速模式传 `low`，`xhigh` 模式传 `xhigh`。

## 安全边界

- Bridge 只监听 `127.0.0.1`。
- Chrome 扩展不保存 OpenAI API key。
- Chrome 扩展只保存 Bridge URL 和本地 token。
- 全文入库必须由用户确认。
- 视频输入优先使用页面可访问字幕；普通提问中的截图帧只作为临时上下文，用完即删。
- 只有用户点击保存、入库或标记重要时，图片/视频帧才写入 `00-INBOX/assets/`。
- 视觉输入不会绕过网站权限下载私有视频源。
- Codex 默认在 vault 目录下以只读沙盒处理问答，写入由 Bridge 负责。

## 开发命令

```bash
npm run check
npm run build
npm run start:bridge
npm run build:extension
npm run eval:harness
```

## macOS 后台启动示例

把下面内容保存为 `~/Library/LaunchAgents/com.local.think-anything.bridge.plist`，把路径改成你的仓库路径：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.think-anything.bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npm</string>
    <string>run</string>
    <string>start:bridge</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/absolute/path/to/Think-Anything</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

启动：

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.local.think-anything.bridge.plist
```

停止：

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.local.think-anything.bridge.plist
```

## 当前限制

- 视频理解优先依赖字幕；没有字幕时才看当前可见片段的多帧采样，不是自动看完整视频。
- Dock 的 `停止` 会忽略迟到结果，但不会真正取消已经发给 Codex 的底层请求。
- 当前不是 token 级流式输出；回答仍是完成后一次性显示。
- Harness v0 先覆盖检索决策评测；关系质量、偏好识别、时间变化类评测会继续扩展。
- Dream Proposal v0 只提案，不提供自动 apply。
- 截图式视觉素材库、设计偏好库、多帧视频采样、文件拖拽还在后续路线里。
- Chrome 全局快捷键可能被系统或其他扩展占用，可在 `chrome://extensions/shortcuts` 手动调整。
