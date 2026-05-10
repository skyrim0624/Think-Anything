# TWYR MVP 收口计划

更新日期：2026-05-10

## 目标

把前面讨论过的 TWYR 核心闭环收束为可以真实长期试用的 MVP：原位提问、连续讨论、查旧笔记、保存卡片、卡片反链线程、AI 保存建议、用户确认全文入库。

## 已完成基线

- Inline Bubble：`Option+V` 原位打开，`Enter` 发送，`Esc` 关闭。
- 选区不再自动弹工具条，避免打扰普通复制、翻译和搜索。
- 同一 Bubble 内的多轮问答会进入下一轮 prompt。
- 保存卡片会写入完整对话链路，并反链到 `30-THREADS`。
- 保存时会应用 AI 的 `saveRecommendation`。

## 剩余收口项

| 步骤 | 状态 | 目标 | 交付物 |
| --- | --- | --- | --- |
| 0 | 已完成 | 建立 MVP 收口计划 | `docs/mvp-completion-plan.md` |
| 1 | 已完成 | Inline 里确认全文入库 | Bubble 新增“入库”动作，经确认后调用 `/api/promote-source` |
| 2 | 已完成 | README 同步最终使用方式 | 说明保存、查库、入库、reload 扩展 |
| 3 | 已完成 | 端到端构建验证 | `npm run check && npm run build` 通过 |

## 边界

- 全文入库必须二次确认；AI 只能建议，不能自动提升为 source。
- 文件/图片拖拽、多模态附件、跨页面会话恢复不进入本轮 MVP 收口，单独作为后续阶段。
- 真实 Chrome 仍需用户 reload 本地扩展后才能使用最新构建。

## 提交记录

- `d64167b`：建立 MVP 收口计划。
- `0931097`：Inline Bubble 新增确认全文入库动作，经确认后调用 `/api/promote-source`。
- `dc41787`：README 同步保存、查库、入库和扩展 reload 使用方式。

## 验证记录

- `npm run check && npm run build` 已通过。
- `入库` 动作会先弹出确认；取消时只写入系统消息，不调用 Bridge。
- 确认后会带上当前页面上下文、最近一次回答摘要、入库理由和 `threadPath`，由 Bridge 写入 `10-SOURCES/` 并更新 `40-MOC/来源索引.md`。
