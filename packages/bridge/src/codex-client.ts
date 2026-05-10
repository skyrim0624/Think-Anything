import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { Codex } from "@openai/codex-sdk";
import type { BridgeConfig } from "./config.js";

export interface CodexRunOutput {
  text: string;
  runtime: "sdk" | "cli";
}

export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexAuthError";
  }
}

export function isCodexCliAvailable(config: BridgeConfig): boolean {
  return existsSync(config.codexCommand);
}

export async function isCodexSdkAvailable(): Promise<boolean> {
  try {
    return typeof Codex === "function";
  } catch {
    return false;
  }
}

export async function runCodexPrompt(prompt: string, config: BridgeConfig): Promise<CodexRunOutput> {
  try {
    const codex = new Codex({
      codexPathOverride: config.codexCommand,
    });
    const thread = codex.startThread({
      workingDirectory: config.vaultPath,
      sandboxMode: "read-only",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
      webSearchMode: "disabled",
    });
    const result = await thread.run(prompt);
    return {
      runtime: "sdk",
      text: normalizeCodexResult(result),
    };
  } catch (error) {
    if (isCodexAuthError(error) && !isCodexCliAvailable(config)) {
      throw error;
    }
    if (!isCodexCliAvailable(config)) {
      throw new Error(`Codex SDK 调用失败，且找不到 CLI 兜底：${sanitizeCodexError(String(error))}`);
    }
    return {
      runtime: "cli",
      text: await runCodexCli(prompt, config),
    };
  }
}

function normalizeCodexResult(result: unknown): string {
  if (typeof result === "string") return result;
  if (!result || typeof result !== "object") return String(result ?? "");
  const record = result as Record<string, unknown>;
  for (const key of ["finalResponse", "final_response", "text", "output", "response"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return JSON.stringify(result, null, 2);
}

function runCodexCli(prompt: string, config: BridgeConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      config.codexCommand,
      [
        "exec",
        "--json",
        "--cd",
        config.vaultPath,
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          PATH: buildChildPath(config.codexCommand, process.env.PATH),
        },
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        const message = sanitizeCodexError(stderr || `codex exec exited with code ${code}`);
        reject(isAuthErrorMessage(message) ? new CodexAuthError(message) : new Error(message));
        return;
      }
      resolve(extractCliFinalAnswer(stdout) || stdout.trim());
    });
    child.stdin.end(prompt);
  });
}

function extractCliFinalAnswer(stdout: string): string {
  const answers: string[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const message = event.message;
      if (typeof event.final_response === "string") answers.push(event.final_response);
      if (typeof event.response === "string") answers.push(event.response);
      if (typeof message === "string") answers.push(message);
      if (message && typeof message === "object") {
        const content = (message as Record<string, unknown>).content;
        if (typeof content === "string") answers.push(content);
      }
    } catch {
      continue;
    }
  }
  return answers.at(-1) ?? "";
}

function buildChildPath(commandPath: string, currentPath: string | undefined): string {
  const segments = new Set<string>();
  const commandDir = commandPath.split("/").slice(0, -1).join("/");
  if (commandDir) segments.add(commandDir);
  for (const part of (currentPath ?? "").split(":")) {
    if (part) segments.add(part);
  }
  return Array.from(segments).join(":");
}

export function isCodexAuthError(error: unknown): boolean {
  if (error instanceof CodexAuthError) return true;
  return isAuthErrorMessage(error instanceof Error ? error.message : String(error));
}

function isAuthErrorMessage(message: string): boolean {
  return /401 Unauthorized|Incorrect API key|未授权|unauthorized/i.test(message);
}

function sanitizeCodexError(message: string): string {
  return message
    .replace(/Incorrect API key provided:[^\n.]+/gi, "Codex/OpenAI 凭据无效")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-…")
    .replace(/eyJ[A-Za-z0-9._-]+/g, "token-…")
    .slice(0, 1800);
}
