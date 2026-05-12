import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadingContext, VisualAsset } from "@twyr/shared";
import type { BridgeConfig } from "./config.js";
import { shortHash, slugify, todayPathDate } from "./markdown.js";

export interface PreparedVisualAsset {
  id: string;
  type: VisualAsset["type"];
  label: string;
  path: string;
  vaultPath?: string;
  sourceUrl?: string;
  alt?: string;
  frameIndex?: number;
  frameCount?: number;
  sampleDelayMs?: number;
}

export interface PreparedVisualContext {
  context: ReadingContext;
  assets: PreparedVisualAsset[];
  cleanup: () => void;
}

const ASSET_DIRECTORY = "00-INBOX/assets";
const TEMP_ASSET_DIRECTORY = "90-SYSTEM/tmp";

export function prepareVisualContext(
  context: ReadingContext,
  config: BridgeConfig,
  options: { storageMode?: "persistent" | "ephemeral" } = {},
): PreparedVisualContext {
  const storageMode = options.storageMode ?? "persistent";
  const tempDirectory =
    storageMode === "ephemeral" ? createTempAssetDirectory(config, "think-anytime-visual-") : undefined;
  const assets: PreparedVisualAsset[] = [];
  const visualAssets = (context.visualAssets ?? []).map((asset, index) => {
    if (!asset.dataUrl) return stripDataUrl(asset);
    const persisted = persistVisualAsset(asset, index, context, config, storageMode, tempDirectory);
    assets.push(persisted);
    return {
      ...stripDataUrl(asset),
      ...(persisted.vaultPath ? { vaultPath: persisted.vaultPath } : {}),
      mimeType: asset.mimeType ?? "image/jpeg",
    };
  });

  return {
    context: {
      ...context,
      visualAssets,
    },
    assets,
    cleanup: () => {
      if (tempDirectory) {
        rmSync(tempDirectory, { recursive: true, force: true });
      }
    },
  };
}

function persistVisualAsset(
  asset: VisualAsset,
  index: number,
  context: ReadingContext,
  config: BridgeConfig,
  storageMode: "persistent" | "ephemeral",
  tempDirectory: string | undefined,
): PreparedVisualAsset {
  const parsed = parseDataUrl(asset.dataUrl);
  const extension = extensionFromMime(parsed.mimeType);
  const sourceSlug = slugify(context.source.title, "visual").slice(0, 36);
  const hash = shortHash(`${context.source.url}${asset.id}${asset.label}${asset.dataUrl?.slice(0, 200)}${Date.now()}`);
  const fileName = `${todayPathDate()}-${sourceSlug}-${index + 1}-${hash}.${extension}`;
  const vaultPath = storageMode === "persistent" ? `${ASSET_DIRECTORY}/${fileName}` : undefined;
  const fullPath = vaultPath ? join(config.vaultPath, vaultPath) : join(tempDirectory ?? config.vaultPath, fileName);
  if (vaultPath) {
    mkdirSync(join(config.vaultPath, ASSET_DIRECTORY), { recursive: true });
  } else if (tempDirectory) {
    mkdirSync(tempDirectory, { recursive: true });
  }
  writeFileSync(fullPath, parsed.buffer);
  return {
    id: asset.id,
    type: asset.type,
    label: asset.label,
    path: fullPath,
    vaultPath,
    sourceUrl: asset.sourceUrl,
    alt: asset.alt,
    frameIndex: asset.frameIndex,
    frameCount: asset.frameCount,
    sampleDelayMs: asset.sampleDelayMs,
  };
}

function createTempAssetDirectory(config: BridgeConfig, prefix: string): string {
  const root = join(config.vaultPath, TEMP_ASSET_DIRECTORY);
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, prefix));
}

function stripDataUrl(asset: VisualAsset): VisualAsset {
  const { dataUrl: _dataUrl, ...metadata } = asset;
  return metadata;
}

function parseDataUrl(dataUrl: string | undefined): { mimeType: string; buffer: Buffer } {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl ?? "");
  if (!match) throw new Error("视觉附件格式无效。");
  return {
    mimeType: match[1] || "image/jpeg",
    buffer: Buffer.from(match[2], "base64"),
  };
}

function extensionFromMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}
