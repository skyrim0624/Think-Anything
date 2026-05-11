import type { ReadingContext, RetrievalDecisionType } from "@twyr/shared";
import { loadConfig } from "./config.js";
import { HarnessService } from "./harness.js";
import { RetrievalService } from "./retrieval.js";

interface RetrievalEvalCase {
  id: string;
  description: string;
  query: string;
  context: ReadingContext;
  mode?: Parameters<RetrievalService["decideAndSearch"]>[0]["mode"];
  force?: boolean;
  expectedType: RetrievalDecisionType;
}

interface EvalCaseResult {
  id: string;
  description: string;
  passed: boolean;
  expected: string;
  actual: string;
  reason: string;
}

const baseContext: ReadingContext = {
  source: {
    url: "https://example.com/think-anytime-eval",
    title: "Think Anytime Harness Eval",
    site: "Eval",
  },
  selectionText: "embedding 是把文本映射成语义向量，用来寻找相似内容。",
  surroundingText: "这段内容解释 embedding 的基本定义。",
  capturedAt: new Date().toISOString(),
};

const retrievalCases: RetrievalEvalCase[] = [
  {
    id: "retrieval-skip-term",
    description: "简单术语解释不应该默认查库。",
    query: "embedding 是什么？",
    context: baseContext,
    expectedType: "skip",
  },
  {
    id: "retrieval-search-old-notes",
    description: "明确要求结合旧笔记时必须查库。",
    query: "结合我之前的笔记，这个对 Think Anytime 有什么用？",
    context: baseContext,
    expectedType: "search",
  },
  {
    id: "retrieval-force-connect",
    description: "connect 模式必须强制查库。",
    query: "联系旧笔记分析这段话。",
    context: baseContext,
    mode: "connect",
    expectedType: "forceSearch",
  },
  {
    id: "retrieval-search-long-selection",
    description: "长选区可能包含完整论证，应该查库。",
    query: "帮我判断这段观点是否值得保存。",
    context: {
      ...baseContext,
      selectionText: "一个长期思考工具必须记录用户为什么停下来，而不只是记录原文。".repeat(28),
    },
    expectedType: "search",
  },
  {
    id: "retrieval-force-flag",
    description: "force 标记必须强制查库。",
    query: "查一下相关笔记。",
    context: baseContext,
    force: true,
    expectedType: "forceSearch",
  },
];

async function main(): Promise<void> {
  const config = loadConfig();
  const retrieval = new RetrievalService(config);
  const harness = new HarnessService(config);
  harness.ensureStructure();

  const results = retrievalCases.map((testCase): EvalCaseResult => {
    const decision = retrieval.decideAndSearch({
      context: testCase.context,
      query: testCase.query,
      mode: testCase.mode,
      force: testCase.force,
      limit: 2,
    });
    return {
      id: testCase.id,
      description: testCase.description,
      passed: decision.type === testCase.expectedType,
      expected: testCase.expectedType,
      actual: decision.type,
      reason: decision.reason,
    };
  });

  const passed = results.filter((result) => result.passed).length;
  const output = {
    type: "twyr-harness-eval-run",
    createdAt: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length ? passed / results.length : 0,
    },
    coverage: [
      "简单术语解释不查库",
      "旧笔记/项目关联触发查库",
      "connect/force 触发强制查库",
      "长选区触发查库",
    ],
    nextCoverage: [
      "关系建议 should-connect / should-not-connect",
      "偏好识别",
      "时间变化后旧判断失效",
      "用户拒绝反馈后的降权效果",
    ],
    results,
  };
  const path = harness.writeEvalRun(output);
  console.log(JSON.stringify({ ...output.summary, path }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
