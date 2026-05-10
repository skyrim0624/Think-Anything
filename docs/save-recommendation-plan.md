# TWYR Save Recommendation 更新计划

更新日期：2026-05-10

## 目标

Inline Bubble 的保存动作要尊重 AI 在 `/api/ask` 中给出的 `saveRecommendation`。用户点击保存时，TWYR 应尽量按推荐的保存等级和卡片类型写入，而不是把所有选区都保存成 `quote`。

## 当前短板

- Bridge 已经让模型输出 `level`、`cardType`、`shouldPromoteSource` 和 `reason`。
- Side Panel 会展示保存建议，但 Inline Bubble 只展示回答，没有使用保存建议。
- Inline Bubble 保存时固定使用 `quote/card` 或 `insight/card`，会污染长期知识库的卡片类型。

## 本轮交付

| 步骤 | 状态 | 目标 | 交付物 |
| --- | --- | --- | --- |
| 0 | 已完成 | 建立本阶段计划 | `docs/save-recommendation-plan.md` |
| 1 | 已完成 | Bubble 记住最近保存建议 | 保存最近一次 `AskResponse.saveRecommendation` |
| 2 | 已完成 | 保存时应用推荐类型 | `cardType` 和 `level` 来自推荐，缺省时保留原 fallback |
| 3 | 已完成 | 处理全文入库边界 | `source` 推荐只作为保存理由，全文仍需用户二次确认 |
| 4 | 已完成 | 构建验证并提交推送 | `npm run check && npm run build` 通过 |

## 边界

- `Option+S` 快速保存仍保持纯摘录卡，不等待 AI 分类。
- AI 推荐 `source` 时，Inline 保存只生成卡片，不自动调用全文入库。
- 用户点击保存代表明确要保存，即使 AI 推荐 `scratch`，也允许写入 `00-INBOX`。

## 提交记录

- `c0fbcd7`：建立 Save Recommendation 更新计划。
- `0a20c4c`：Inline Bubble 保存时应用 AI 推荐的保存等级和卡片类型。

## 验证记录

- `npm run check && npm run build` 已通过。
- 没有 AI 保存建议时仍按原 fallback 保存：有选区为 `card/quote`，无选区为 `card/insight`。
- AI 推荐 `source` 时不会自动全文入库，只会保存为卡片，并在保存理由中提示全文入库仍需二次确认。
