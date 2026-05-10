# 给朋友 AI Agent 的安装任务书

把下面整段发给朋友的 AI Agent。目标不是让朋友手动照做，而是让 Agent 自己完成安装、配置、验证，并只在必须授权或必须手动点击 Chrome UI 时请求用户配合。

---

## 任务

你要在这台电脑上安装并配置 Think Anything。

Think Anything 是一个 Chrome + Obsidian + Codex 阅读知识工作台。它包含：

- Chrome 扩展：在网页选区旁呼出 Think 对话框。
- 本地 Bridge：只监听 `127.0.0.1`，负责调用 Codex 并写入 Obsidian Markdown vault。
- Obsidian vault：保存卡片、全文、讨论线程、图片/视频帧截图。

GitHub 仓库：

```text
https://github.com/skyrim0624/Think-Anything
```

完成标准：

1. 仓库已克隆并构建成功。
2. 本地 Bridge 能启动，`GET /api/status` 返回可用。
3. Chrome 已加载 `packages/extension/dist` 这个本地扩展。
4. 扩展设置里已填入 Bridge URL 和 token。
5. 用户能用 `Option+S` 在网页选区旁呼出 Think 对话框。
6. 用户能用 `Option+V` 快速保存选区或视觉材料。

## 安装步骤

### 1. 检查环境

先检查以下命令是否存在：

```bash
node --version
npm --version
git --version
codex --version
```

要求：

- Node.js 18+
- npm
- git
- Codex CLI
- Google Chrome 或 Chromium

如果 `codex` 不存在，先安装 Codex CLI。安装方式按当前机器环境选择；不要把 OpenAI API key 写进 Chrome 扩展。

### 2. 克隆项目

优先安装到用户主目录下的一个开发目录。如果没有偏好，用：

```bash
mkdir -p "$HOME/Projects"
cd "$HOME/Projects"
git clone https://github.com/skyrim0624/Think-Anything.git
cd Think-Anything
```

如果目录已存在：

```bash
cd "$HOME/Projects/Think-Anything"
git pull
```

### 3. 安装依赖并构建

```bash
npm install
npm run check
npm run build
```

如果构建失败，先修复依赖或 Node 版本问题，再继续。

### 4. 准备 Obsidian vault 和配置

默认 vault：

```bash
mkdir -p "$HOME/Documents/TWYR"
```

如果用户已有自己的 Obsidian vault，询问用户是否要使用已有 vault 的某个目录；否则使用默认 `~/Documents/TWYR`。

启动一次 Bridge，让它生成配置：

```bash
npm run start:bridge
```

如果这个命令占住终端，看到 `TWYR Bridge 正在运行` 后即可另开终端继续，或先停止后写后台启动配置。

配置文件位置：

```text
~/.twyr/config.json
```

确保配置大致如下：

```json
{
  "token": "twyr_自动生成",
  "vaultPath": "/用户主目录/Documents/TWYR",
  "agentMemoryPath": "/用户主目录/Documents/Agent-Memory",
  "codexCommand": "codex",
  "port": 47321
}
```

`agentMemoryPath` 可以不存在；不存在只影响旧笔记检索，不影响网页讨论和保存。

### 5. 让 Bridge 后台运行

macOS 推荐创建 LaunchAgent。

生成文件：

```bash
cat > "$HOME/Library/LaunchAgents/com.local.think-anything.bridge.plist" <<PLIST
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
  <string>$HOME/Projects/Think-Anything</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
PLIST
```

启动：

```bash
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.local.think-anything.bridge.plist" 2>/dev/null || true
launchctl bootstrap gui/$(id -u) "$HOME/Library/LaunchAgents/com.local.think-anything.bridge.plist"
```

验证：

```bash
node <<'NODE'
const fs = require('fs');
const path = require('path');
const config = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.twyr/config.json'), 'utf8'));
fetch(`http://127.0.0.1:${config.port || 47321}/api/status`, {
  headers: { 'x-twyr-token': config.token }
}).then(async (response) => {
  console.log(await response.text());
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
```

如果不是 macOS，可以用系统自带的后台进程方式，或先让 `npm run start:bridge` 保持运行。

### 6. 加载 Chrome 扩展

扩展目录：

```text
$HOME/Projects/Think-Anything/packages/extension/dist
```

如果你能控制 Chrome UI：

1. 打开 `chrome://extensions`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择上面的 `packages/extension/dist`。
5. 打开 Think 扩展的设置页。
6. 填：
   - Bridge URL：`http://127.0.0.1:47321`
   - Token：读取 `~/.twyr/config.json` 里的 `token`

如果你不能控制 Chrome UI，就把这 6 步作为唯一需要用户手动完成的部分交给用户，并把 token 明确展示给用户。

### 7. 验收

打开普通网页，完成下面测试：

1. 选中一段文字。
2. 按 `Option+S`。
3. 应出现 Think 原位对话框。
4. 输入“解释一下这段话”，按 `Enter`。
5. 右键一张图片或一个视频，应该能看到 `Think：查看这张图片/视频`。
6. 点击对话框里的 `保存`。
7. 检查 vault 里是否出现：

```text
20-CARDS/
30-THREADS/
00-INBOX/assets/
```

### 8. 交付给用户的信息

完成后，把下面信息发给用户：

- Think Anything 仓库路径。
- Obsidian vault 路径。
- Bridge 是否已后台运行。
- Chrome 扩展是否已加载。
- 快捷键：
  - `Option+S`：打开对话框
  - `Option+V`：快速保存
- 如果有未完成项，列出具体需要用户点击或授权的步骤。

## 常见问题处理

- Bridge 不可用：确认后台服务是否运行，或临时运行 `npm run start:bridge`。
- 未授权：Chrome 扩展里填的 token 必须等于 `~/.twyr/config.json` 里的 token。
- Codex 登录不可用：执行 `codex login --device-auth`。
- 快捷键没反应：打开 `chrome://extensions/shortcuts` 检查是否被其他扩展占用。
- 视频理解不完整：当前只看视频当前帧，不会自动分析完整视频。
