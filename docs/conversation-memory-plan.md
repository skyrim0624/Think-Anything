# TWYR Inline Conversation Memory 更新计划

更新日期：2026-05-10

## 目标

Inline Codex Bubble 需要从“视觉上连续显示问答”升级为“模型真正理解前文讨论”。用户在同一网页上连续追问时，TWYR 必须把已有问题和回答作为上下文传给 Bridge，并且在用户点击保存时沉淀完整对话链路。

## 当前短板

- Bubble 内已经能显示多轮问答，但每次 `/api/ask` 只发送当前问题，模型不知道前一轮回答。
- 保存按钮只保存最后一个问题和回答，丢失用户真正感兴趣的连续思考路径。
- Bridge 的 prompt 没有明确区分“当前问题”和“同页历史讨论”，连续追问容易被当成孤立问题。

## 本轮交付

| 步骤 | 状态 | 目标 | 交付物 |
| --- | --- | --- | --- |
| 0 | 已完成 | 建立本阶段计划 | `docs/conversation-memory-plan.md` |
| 1 | 未开始 | 扩展共享数据结构 | `TwyrConversationMessage`、`AskRequest.conversation`、`CaptureRequest.conversation` |
| 2 | 未开始 | Bubble 发送历史对话 | 提问时传入前序 user/assistant 消息 |
| 3 | 未开始 | Bridge prompt 理解历史 | prompt 中加入“本页对话历史”段落 |
| 4 | 未开始 | 保存完整讨论链路 | 卡片中写入对话摘录，而不只写最后一问一答 |
| 5 | 未开始 | 构建验证并提交推送 | `npm run check && npm run build` 通过 |

## 边界

- 只保存同一个 Bubble 生命周期内的对话历史。
- 暂不做跨页面会话恢复，避免把无关网页的上下文混进来。
- 历史消息会截断，防止 prompt 过长。
