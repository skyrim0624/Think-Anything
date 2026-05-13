import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { isCodexAuthError, isCodexCliAvailable, isCodexSdkAvailable, runCodexPrompt } from "./codex-client.js";
import { DreamService } from "./dream.js";
import { HarnessService } from "./harness.js";
import { buildAskPrompt, parseModelAnswer } from "./prompt.js";
import { RetrievalService } from "./retrieval.js";
import { VaultService } from "./vault.js";
import { prepareVisualContext } from "./visual-assets.js";
import { buildVidMarkTranslatePrompt, parseVidMarkTranslateOutput } from "./vidmark.js";
import { shortHash } from "./markdown.js";
import type {
  AskRequest,
  AskResponse,
  CaptureRequest,
  DreamProposeRequest,
  FeedbackRequest,
  PromoteSourceRequest,
  RetrieveRequest,
  VidMarkSaveCardRequest,
  VidMarkTranslateRequest,
} from "@twyr/shared";
import { DEFAULT_CODEX_MODEL, type TwyrModelReasoningEffort } from "@twyr/shared";

const config = loadConfig();
const vault = new VaultService(config);
vault.ensureStructure();
const harness = new HarnessService(config);
harness.ensureStructure();
const retrieval = new RetrievalService(config);
retrieval.refreshIndex(true);
const dream = new DreamService(config, retrieval);

const server = createServer(async (request, response) => {
  setCorsHeaders(request, response);
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    const url = new URL(request.url ?? "/", config.bridgeUrl);
    if (request.method === "GET" && url.pathname === "/api/status") {
      await handleStatus(request, response);
      return;
    }

    if (!isAuthenticated(request)) {
      sendJson(response, 401, { error: "未授权", detail: "请在 Think Anytime 扩展中填写本地 Bridge token。" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/ask") {
      await handleAsk(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/vidmark/translate") {
      await handleVidMarkTranslate(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/vidmark/save-card") {
      const body = await readJson<VidMarkSaveCardRequest>(request);
      const result = vault.writeVidMarkCard(body);
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/capture") {
      const startedAt = Date.now();
      const body = await readJson<CaptureRequest>(request);
      const prepared = prepareVisualContext(body.context, config);
      const result = vault.writeCard({ ...body, context: prepared.context });
      retrieval.refreshIndex(true);
      const trace = harness.writeTrace({
        action: "capture",
        context: prepared.context,
        question: body.question ?? body.note,
        resultPath: result.path,
        result: { level: result.level, cardType: result.cardType },
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { ...result, traceId: trace.traceId });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/retrieve") {
      const startedAt = Date.now();
      const body = await readJson<RetrieveRequest>(request);
      const decision = retrieval.decideAndSearch({
        context: body.context,
        query: body.query,
        force: body.force,
        limit: body.limit,
      });
      const trace = harness.writeTrace({
        action: "retrieve",
        context: body.context,
        question: body.query,
        retrieval: decision,
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { retrieval: decision, traceId: trace.traceId });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/promote-source") {
      const startedAt = Date.now();
      const body = await readJson<PromoteSourceRequest>(request);
      const prepared = prepareVisualContext(body.context, config);
      const result = vault.promoteSource({ ...body, context: prepared.context });
      retrieval.refreshIndex(true);
      const trace = harness.writeTrace({
        action: "promote-source",
        context: prepared.context,
        question: body.reason ?? body.summary,
        resultPath: result.sourcePath,
        result: { mocPath: result.mocPath },
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { ...result, traceId: trace.traceId });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      const body = await readJson<FeedbackRequest>(request);
      const result = harness.appendFeedback(body);
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/dream/propose") {
      const startedAt = Date.now();
      const body = await readJson<DreamProposeRequest>(request);
      const result = await dream.propose(body);
      const trace = harness.writeTrace({
        action: "dream-propose",
        resultPath: result.proposalPath,
        result: {
          dreamRunId: result.dreamRunId,
          suggestionCount: result.suggestionCount,
          candidateCount: result.candidateCount,
        },
        durationMs: Date.now() - startedAt,
      });
      sendJson(response, 200, { ...result, traceId: trace.traceId });
      return;
    }

    sendJson(response, 404, { error: "未找到接口" });
  } catch (error) {
    sendJson(response, 500, {
      error: "Think Anytime Bridge 处理失败",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Think Anytime Bridge 正在运行：${config.bridgeUrl}`);
  console.log(`Think Anytime vault：${config.vaultPath}`);
  console.log(`Chrome 扩展 token 位于：${config.configPath}`);
});

async function handleStatus(request: IncomingMessage, response: ServerResponse): Promise<void> {
  sendJson(response, 200, {
    ok: true,
    authenticated: isAuthenticated(request),
    bridgeUrl: config.bridgeUrl,
    vaultPath: config.vaultPath,
    vaultExists: vault.getStatus().vaultExists,
    indexReady: retrieval.indexReady,
    harnessReady: true,
    codexSdkAvailable: await isCodexSdkAvailable(),
    codexCliPath: isCodexCliAvailable(config) ? config.codexCommand : undefined,
    message: "Think Anytime Bridge 可用。",
  });
}

async function handleAsk(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const startedAt = Date.now();
  const body = await readJson<AskRequest>(request);
  const prepared = prepareVisualContext(body.context, config, { storageMode: "ephemeral" });
  try {
    const mode = body.mode ?? "freeform";
    const responseMode = body.responseMode ?? (body.forceRetrieval || mode === "connect" ? "deep" : "fast");
    const contextScope = body.contextScope ?? (responseMode === "fast" ? "selection" : "page");
    const sessionId =
      body.sessionId ?? `session-${shortHash(`${prepared.context.source.url}:${prepared.context.capturedAt}`)}`;
    const model = body.model?.trim() || DEFAULT_CODEX_MODEL;
    const modelReasoningEffort = normalizeReasoningEffort(
      body.modelReasoningEffort ?? (responseMode === "fast" ? "low" : "xhigh"),
    );
    const decision =
      responseMode === "fast" && !body.forceRetrieval && mode !== "connect"
        ? {
            type: "skip" as const,
            reason: "极速模式默认不查库；用户点击查库或进入深度模式时再检索。",
            query: body.question.trim(),
            notes: [],
          }
        : retrieval.decideAndSearch({
            context: prepared.context,
            query: body.question,
            mode,
            force: body.forceRetrieval,
          });
    const prompt = buildAskPrompt({
      context: prepared.context,
      question: body.question,
      mode,
      responseMode,
      contextScope,
      retrieval: decision,
      conversation: body.conversation,
    });
    let output: Awaited<ReturnType<typeof runCodexPrompt>>;
    output = await runCodexPrompt(prompt, config, prepared.assets, { model, modelReasoningEffort });
    const parsed = parseModelAnswer(output.text);
    const threadPath = vault.appendThread({
      context: prepared.context,
      question: body.question,
      answer: parsed.answer,
      retrieval: decision,
      recommendation: parsed.saveRecommendation,
    });
    retrieval.refreshIndex(responseMode === "deep");
    const trace = harness.writeTrace({
      action: "ask",
      context: prepared.context,
      question: body.question,
      mode,
      responseMode,
      contextScope,
      sessionId,
      model,
      modelReasoningEffort,
      retrieval: decision,
      saveRecommendation: parsed.saveRecommendation,
      answer: parsed.answer,
      resultPath: threadPath,
      result: { runtime: output.runtime },
      durationMs: Date.now() - startedAt,
    });
    const result: AskResponse = {
      answer: parsed.answer,
      mode,
      responseMode,
      contextScope,
      sessionId,
      model,
      modelReasoningEffort,
      retrieval: decision,
      saveRecommendation: parsed.saveRecommendation,
      threadPath,
      traceId: trace.traceId,
      rawModelOutput: parsed.rawModelOutput,
    };
    sendJson(response, 200, result);
  } catch (error) {
    if (!isCodexAuthError(error)) throw error;
    const mode = body.mode ?? "freeform";
    const responseMode = body.responseMode ?? (body.forceRetrieval || mode === "connect" ? "deep" : "fast");
    const contextScope = body.contextScope ?? (responseMode === "fast" ? "selection" : "page");
    const sessionId =
      body.sessionId ?? `session-${shortHash(`${prepared.context.source.url}:${prepared.context.capturedAt}`)}`;
    const model = body.model?.trim() || DEFAULT_CODEX_MODEL;
    const modelReasoningEffort = normalizeReasoningEffort(
      body.modelReasoningEffort ?? (responseMode === "fast" ? "low" : "xhigh"),
    );
    harness.writeTrace({
      action: "ask",
      context: prepared.context,
      question: body.question,
      mode,
      responseMode,
      contextScope,
      sessionId,
      model,
      modelReasoningEffort,
      error: "Codex 登录不可用",
      durationMs: Date.now() - startedAt,
    });
    sendJson(response, 503, {
      error: "Codex 登录不可用",
      detail:
        "Think Anytime 的 Chrome 捕获和本地 Bridge 已经连通，但本机 Codex CLI 当前凭据不可用。请重新执行 Codex 登录，或用有效 OPENAI_API_KEY 登录后再提问。",
    });
  } finally {
    prepared.cleanup();
  }
}

async function handleVidMarkTranslate(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<VidMarkTranslateRequest>(request);
  const prompt = buildVidMarkTranslatePrompt(body);
  const output = await runCodexPrompt(prompt, config, [], {
    model: DEFAULT_CODEX_MODEL,
    modelReasoningEffort: "low",
  });
  const result = parseVidMarkTranslateOutput(output.text, body.cues);
  sendJson(response, 200, result);
}

function normalizeReasoningEffort(value: string): TwyrModelReasoningEffort {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }
  return "low";
}

function isAuthenticated(request: IncomingMessage): boolean {
  return request.headers["x-twyr-token"] === config.token;
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;
  if (!origin || origin.startsWith("chrome-extension://")) {
    response.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "content-type,x-twyr-token");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(body, null, 2)}\n`);
}

function readJson<T>(request: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk: Buffer) => {
      raw += chunk.toString("utf8");
      if (raw.length > 15_000_000) {
        reject(new Error("请求体过大"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}") as T);
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}
