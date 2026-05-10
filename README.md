# TWYR

TWYR = Thinking, when you are reading!

TWYR 是一个 Chrome + Obsidian + Codex 阅读知识工作台。Chrome 负责捕获阅读现场，本地 Bridge 负责调用 Codex、检索旧笔记和写入 Obsidian，TWYR vault 负责长期保存。

## 项目结构

- `packages/shared`：Chrome 扩展和 Bridge 共用的数据类型。
- `packages/bridge`：本地 Node 服务，只监听 `127.0.0.1`。
- `packages/extension`：Manifest V3 Chrome 扩展，包含右键菜单、快捷键、Side Panel 和选区浮动工具条。

## 本地启动

```bash
npm install
npm run build
npm run start:bridge
```

首次启动 Bridge 会创建 `~/.twyr/config.json`，里面有 Chrome 扩展需要填写的 `token`。

当前机器已安装为 LaunchAgent，登录后会自动启动：

```text
/Users/andreas/Library/LaunchAgents/com.andreas.twyr.bridge.plist
```

Bridge 日志位置：

```text
/Users/andreas/Library/Logs/TWYR/bridge.out.log
/Users/andreas/Library/Logs/TWYR/bridge.err.log
```

## 安装 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 开启开发者模式。
3. 选择“加载已解压的扩展程序”。
4. 选择 `packages/extension/dist`。
5. 打开 TWYR 侧边栏，在设置里填写 `Bridge URL` 和 `token`。

默认 Bridge URL：

```text
http://127.0.0.1:47321
```

当前 Chrome 已加载本地扩展：

```text
/Users/andreas/vibe coding/读书/twyr/packages/extension/dist
```

常用入口：

- 选中文字后按 `Option+V`，会在选区附近打开 TWYR 原位对话框；输入问题后按 `Enter` 发送，`Shift+Enter` 换行，`Esc` 关闭。
- 原位对话框里可以直接继续追问，也可以点 `保存`、`查库`、`展开`。展开后会进入完整 TWYR 工作台。
- 选中文字后按 `Option+S`，会把当前选区快速保存到 TWYR 知识库。
- `Option+V` 和 `Option+S` 同时有页面内兜底监听；即使 Chrome 没登记扩展快捷键，普通阅读页面也能触发，但在输入框、编辑器和 TWYR 自己的对话框内不会抢快捷键。
- 默认选中文字不会弹出 TWYR 工具条，避免干扰复制、翻译、搜索等日常操作。
- 需要持续阅读讨论某个页面时，右键页面或选区，点 `TWYR：本页开启选区工具条`。
- 本页工具条开启后，选中文字会出现“问 / 反驳 / 旧笔记 / 保存 / 关”；点“关”会关闭本页工具条。
- 临时只处理一次时，右键选中文字，直接使用 `TWYR：解释选中内容` 等菜单。
- `Command+Shift+K` 打开讨论工作台。
- `TWYR：本页开启选区工具条` 仍保留为右键菜单入口；如需快捷键，可在 `chrome://extensions/shortcuts` 自行绑定。

## Codex 登录

TWYR 不把 API key 放进 Chrome 扩展；AI 提问由本地 Bridge 调用 Codex CLI / Codex SDK。若面板显示“Codex 登录不可用”，说明 Chrome 捕获和 Obsidian 写入都正常，但本机 Codex 凭据失效。

重新登录方式：

```bash
codex login --device-auth
```

或者使用有效 API key：

```bash
printenv OPENAI_API_KEY | codex login --with-api-key
```

登录完成后重启 Bridge：

```bash
launchctl bootout gui/$(id -u) /Users/andreas/Library/LaunchAgents/com.andreas.twyr.bridge.plist
launchctl bootstrap gui/$(id -u) /Users/andreas/Library/LaunchAgents/com.andreas.twyr.bridge.plist
```

## Obsidian 仓库

默认 TWYR 知识库位置：

```text
/Users/andreas/cmi社区知识库/TWYR
```

目录含义：

- `00-INBOX/`：临时捕获。
- `10-SOURCES/`：确认入库的全文原文。
- `20-CARDS/`：问题卡、洞察卡、观点卡、反驳卡、术语卡、摘录卡。
- `30-THREADS/`：围绕网页或主题的讨论。
- `40-MOC/`：主题索引和阅读线索。
- `90-SYSTEM/`：schema、模板、TWYR skill、SQLite 索引。

## API

- `GET /api/status`：检查 Bridge、vault、索引、Codex 状态。
- `POST /api/ask`：向 TWYR 提问。
- `POST /api/capture`：保存片段或卡片。
- `POST /api/retrieve`：手动查旧笔记。
- `POST /api/promote-source`：确认后全文入库。

除 `/api/status` 外，所有接口都需要 `x-twyr-token`。

## 安全边界

- Bridge 只监听 `127.0.0.1`。
- Chrome 扩展不保存 API key。
- 全文入库必须由用户确认。
- Codex SDK 是主路径；如果 SDK 调用失败，Bridge 会用 `codex exec --sandbox read-only` 兜底。
