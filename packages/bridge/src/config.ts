import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  DEFAULT_AGENT_MEMORY_PATH,
  DEFAULT_BRIDGE_URL,
  DEFAULT_VAULT_PATH,
} from "@twyr/shared";

export interface BridgeConfig {
  host: string;
  port: number;
  bridgeUrl: string;
  token: string;
  vaultPath: string;
  agentMemoryPath: string;
  codexCommand: string;
  configPath: string;
}

interface PersistedConfig {
  token?: string;
  vaultPath?: string;
  agentMemoryPath?: string;
  codexCommand?: string;
  port?: number;
}

const CONFIG_PATH = join(homedir(), ".twyr", "config.json");

export function loadConfig(): BridgeConfig {
  const persisted = readPersistedConfig();
  const port = Number(process.env.TWYR_PORT ?? persisted.port ?? 47321);
  const host = process.env.TWYR_HOST ?? "127.0.0.1";
  const token = process.env.TWYR_BRIDGE_TOKEN ?? persisted.token ?? createToken();
  const vaultPath = process.env.TWYR_VAULT_PATH ?? persisted.vaultPath ?? DEFAULT_VAULT_PATH;
  const agentMemoryPath =
    process.env.TWYR_AGENT_MEMORY_PATH ?? persisted.agentMemoryPath ?? DEFAULT_AGENT_MEMORY_PATH;
  const codexCommand =
    process.env.TWYR_CODEX_COMMAND ?? persisted.codexCommand ?? "/Users/andreas/.bun/bin/codex";

  if (!persisted.token && !process.env.TWYR_BRIDGE_TOKEN) {
    persistConfig({
      ...persisted,
      token,
      vaultPath,
      agentMemoryPath,
      codexCommand,
      port,
    });
  }

  return {
    host,
    port,
    bridgeUrl: DEFAULT_BRIDGE_URL.replace(":47321", `:${port}`),
    token,
    vaultPath,
    agentMemoryPath,
    codexCommand,
    configPath: CONFIG_PATH,
  };
}

function readPersistedConfig(): PersistedConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PersistedConfig;
  } catch {
    return {};
  }
}

function persistConfig(config: PersistedConfig): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function createToken(): string {
  return `twyr_${randomBytes(24).toString("hex")}`;
}
