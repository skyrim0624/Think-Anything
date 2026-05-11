import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadConfig } from "./config.js";
import { isCodexAuthError, isCodexCliAvailable, isCodexSdkAvailable, runCodexPrompt } from "./codex-client.js";
import { buildAskPrompt, parseModelAnswer } from "./prompt.js";
import { RetrievalService } from "./retrieval.js";
import { VaultService } from "./vault.js";
import { prepareVisualContext } from "./visual-assets.js";
import type {
  AskRequest,
  AskResponse,
  CaptureRequest,
  PromoteSourceRequest,
  RetrieveRequest,
} from "@twyr/shared";

const config = loadConfig();
const vault = new VaultService(config);
vault.ensureStructure();
const retrieval = new RetrievalService(config);
retrieval.refreshIndex(true);

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
    if (request.method === "POST" && url.pathname === "/api/capture") {
      const body = await readJson<CaptureRequest>(request);
      const prepared = prepareVisualContext(body.context, config);
      const result = vault.writeCard({ ...body, context: prepared.context });
      retrieval.refreshIndex(true);
      sendJson(response, 200, result);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/retrieve") {
      const body = await readJson<RetrieveRequest>(request);
      const decision = retrieval.decideAndSearch({
        context: body.context,
        query: body.query,
        force: body.force,
        limit: body.limit,
      });
      sendJson(response, 200, { retrieval: decision });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/promote-source") {
      const body = await readJson<PromoteSourceRequest>(request);
      const prepared = prepareVisualContext(body.context, config);
      const result = vault.promoteSource({ ...body, context: prepared.context });
      retrieval.refreshIndex(true);
      sendJson(response, 200, result);
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
    codexSdkAvailable: await isCodexSdkAvailable(),
    codexCliPath: isCodexCliAvailable(config) ? config.codexCommand : undefined,
    message: "Think Anytime Bridge 可用。",
  });
}

async function handleAsk(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson<AskRequest>(request);
  const prepared = prepareVisualContext(body.context, config);
  const mode = body.mode ?? "freeform";
  const decision = retrieval.decideAndSearch({
    context: prepared.context,
    query: body.question,
    mode,
    force: body.forceRetrieval,
  });
  const prompt = buildAskPrompt({
    context: prepared.context,
    question: body.question,
    mode,
    retrieval: decision,
    conversation: body.conversation,
  });
  let output: Awaited<ReturnType<typeof runCodexPrompt>>;
  try {
    output = await runCodexPrompt(prompt, config, prepared.assets);
  } catch (error) {
    if (isCodexAuthError(error)) {
      sendJson(response, 503, {
        error: "Codex 登录不可用",
        detail:
          "Think Anytime 的 Chrome 捕获和本地 Bridge 已经连通，但本机 Codex CLI 当前凭据不可用。请重新执行 Codex 登录，或用有效 OPENAI_API_KEY 登录后再提问。",
      });
      return;
    }
    throw error;
  }
  const parsed = parseModelAnswer(output.text);
  const threadPath = vault.appendThread({
    context: prepared.context,
    question: body.question,
    answer: parsed.answer,
    retrieval: decision,
    recommendation: parsed.saveRecommendation,
  });
  retrieval.refreshIndex(true);
  const result: AskResponse = {
    answer: parsed.answer,
    mode,
    retrieval: decision,
    saveRecommendation: parsed.saveRecommendation,
    threadPath,
    rawModelOutput: parsed.rawModelOutput,
  };
  sendJson(response, 200, result);
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
