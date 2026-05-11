# Think Anytime

Think Anytime 是一个 Chrome + Obsidian + Codex 阅读知识工作台。Chrome 负责捕获网页现场，本地 Bridge 负责调用 Codex、检索旧笔记和写入 Obsidian，Obsidian vault 负责长期保存。

Chrome 扩展的显示名是 `Think Anytime`。代码仓库地址仍是历史名称 `Think-Anything`；内部包名和部分环境变量仍保留 `TWYR`，来自项目原名 `Thinking, when you are reading!`。

## 能做什么

- 在任意网页选中文字后按 `Option+S`，在选区附近打开原位 AI 对话框。
- 在对话框里继续追问、查旧笔记、保存卡片、确认全文入库。
- 选区附近有图片、视频或 canvas 时，自动截取当前可见画面并交给 Codex 看。
- 右键图片或视频，点击 `Think Anytime：查看这张图片/视频`，直接基于画面讨论。
- 按 `Option+V` 快速保存当前选区或视觉材料。
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

- `Option+S`：打开原位对话框。
- `Option+V`：快速保存当前选区或视觉材料。
- `Command+Shift+K`：打开完整讨论工作台。
- 右键选中文字：解释、挑战观点、联系旧笔记、快速保存。
- 右键图片或视频：查看这张图片/视频。
- 右键页面：开启/关闭本页选区工具条，或建议全文入库。

对话框内：

- `Enter`：发送。
- `Shift+Enter`：换行。
- `Esc`：关闭。
- `保存`：按 AI 建议写入卡片。
- `查库`：强制联系旧笔记。
- `入库`：二次确认后把全文保存到 `10-SOURCES/`。
- `展开`：进入完整工作台。

## Obsidian Vault 结构

默认 vault 路径是 `~/Documents/TWYR`，可在 `~/.twyr/config.json` 里改。

```text
00-INBOX/          临时捕获和视觉附件
00-INBOX/assets/   图片、视频当前帧、canvas 截图
10-SOURCES/        用户确认后保存的全文原文
20-CARDS/          问题卡、洞察卡、观点卡、反驳卡、术语卡、摘录卡
30-THREADS/        围绕网页或主题的连续讨论
40-MOC/            来源索引、主题索引、阅读线索
90-SYSTEM/         schema、模板、skill、SQLite 索引
```

## API

除 `/api/status` 外，所有接口都需要 `x-twyr-token`。

- `GET /api/status`：检查 Bridge、vault、索引、Codex 状态。
- `POST /api/ask`：向 Codex 提问。
- `POST /api/capture`：保存片段、卡片或视觉材料。
- `POST /api/retrieve`：手动查旧笔记。
- `POST /api/promote-source`：确认后全文入库。

## 安全边界

- Bridge 只监听 `127.0.0.1`。
- Chrome 扩展不保存 OpenAI API key。
- Chrome 扩展只保存 Bridge URL 和本地 token。
- 全文入库必须由用户确认。
- 视觉输入默认是当前可见画面截图，不会绕过网站权限下载私有视频源。
- Codex 默认在 vault 目录下以只读沙盒处理问答，写入由 Bridge 负责。

## 开发命令

```bash
npm run check
npm run build
npm run start:bridge
npm run build:extension
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

- 视频理解目前是“当前帧截图”，不是自动看完整视频。
- 截图式视觉素材库、设计偏好库、多帧视频采样、文件拖拽还在后续路线里。
- Chrome 全局快捷键可能被系统或其他扩展占用，可在 `chrome://extensions/shortcuts` 手动调整。
