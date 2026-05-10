# TWYR Thread Link 更新计划

更新日期：2026-05-10

## 目标

让 Inline Bubble 产生的阅读讨论线程和用户手动保存的卡片互相可追溯。用户在浏览器里追问后点击保存，卡片应该明确记录对应的 `30-THREADS` 讨论路径，Obsidian 中可以从卡片跳回完整阅读现场。

## 当前短板

- `/api/ask` 已经返回 `threadPath`，但 Inline Bubble 没有保存这个路径。
- `/api/capture` 的 `CaptureRequest` 没有 `threadPath` 字段，Bridge 无法把卡片反链到讨论线程。
- Obsidian 卡片只能看到最后问题、回答和对话链路，不能直接跳到完整线程文件。

## 本轮交付

| 步骤 | 状态 | 目标 | 交付物 |
| --- | --- | --- | --- |
| 0 | 已完成 | 建立本阶段计划 | `docs/thread-link-plan.md` |
| 1 | 未开始 | 扩展保存协议 | `CaptureRequest.threadPath` |
| 2 | 未开始 | Bubble 记住最近线程 | 保存时把 `AskResponse.threadPath` 传给 capture |
| 3 | 未开始 | 卡片写入线程反链 | frontmatter 和正文写入讨论线程链接 |
| 4 | 未开始 | 构建验证并提交推送 | `npm run check && npm run build` 通过 |

## 边界

- 只链接最近一次成功 `/api/ask` 返回的线程。
- 快速保存 `Option+S` 没有线程上下文时不强行制造线程。
- 本轮不改变线程文件命名规则。
