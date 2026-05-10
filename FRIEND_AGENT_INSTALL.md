# 给朋友 Agent 的安装快捷指南

目标：在朋友电脑上装好 Think Anything，让 Chrome 里选中文本、图片或视频画面后能呼出 Codex 讨论，并保存到 Obsidian Markdown vault。

## 1. 克隆和构建

```bash
git clone https://github.com/skyrim0624/Think-Anything.git
cd Think-Anything
npm install
npm run build
```

## 2. 准备 Codex

```bash
codex login --device-auth
```

确认能运行：

```bash
codex --version
```

## 3. 启动本地 Bridge

```bash
npm run start:bridge
```

第一次启动会生成：

```text
~/.twyr/config.json
```

把里面的 `token` 复制出来，稍后填到 Chrome 扩展设置里。

如需指定 Obsidian vault：

```json
{
  "vaultPath": "/你的/Obsidian/TWYR",
  "agentMemoryPath": "/可选/Agent-Memory",
  "codexCommand": "codex",
  "port": 47321
}
```

改完后重启 Bridge。

## 4. 加载 Chrome 扩展

1. 打开 `chrome://extensions`。
2. 打开“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择 `Think-Anything/packages/extension/dist`。
5. 点击工具栏里的 `Think` 图标，打开设置。
6. 填：
   - Bridge URL：`http://127.0.0.1:47321`
   - Token：`~/.twyr/config.json` 里的 `token`

## 5. 使用方式

- `Option+S`：选中文字后打开原位对话框。
- `Option+V`：快速保存选区或视觉材料。
- 右键图片/视频：`Think：查看这张图片/视频`。
- 对话框里点 `保存`：写入 Obsidian 卡片。
- 对话框里点 `入库`：确认后全文入库。
- 对话框里点 `查库`：联系旧笔记。

## 6. 验收测试

1. 打开任意网页，选中一句话。
2. 按 `Option+S`，应该弹出 Think 对话框。
3. 输入“解释一下”，按 `Enter`。
4. 右键一张图片或一个视频，点 `Think：查看这张图片/视频`。
5. 点 `保存`，检查 Obsidian vault 里是否出现：

```text
20-CARDS/
30-THREADS/
00-INBOX/assets/
```

## 7. 常见问题

- 对话框报 Bridge 不可用：确认 `npm run start:bridge` 正在运行。
- 报未授权：Chrome 扩展里的 token 和 `~/.twyr/config.json` 不一致。
- 报 Codex 登录不可用：重新执行 `codex login --device-auth`。
- 快捷键没反应：去 `chrome://extensions/shortcuts` 看是否被其他扩展占用。
- 视频回答不准：当前只看视频当前帧，不会自动看完整视频。
