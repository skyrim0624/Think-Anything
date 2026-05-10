import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReadingContext, VisualAsset } from "@twyr/shared";
import type { BridgeConfig } from "./config.js";
import { shortHash, slugify, todayPathDate } from "./markdown.js";

export interface PreparedVisualAsset {
  id: string;
  type: VisualAsset["type"];
  label: string;
  path: string;
  vaultPath: string;
  sourceUrl?: string;
  alt?: string;
}

export interface PreparedVisualContext {
  context: ReadingContext;
  assets: PreparedVisualAsset[];
}

const ASSET_DIRECTORY = "00-INBOX/assets";

export function prepareVisualContext(context: ReadingContext, config: BridgeConfig): PreparedVisualContext {
  const assets: PreparedVisualAsset[] = [];
  const visualAssets = (context.visualAssets ?? []).map((asset, index) => {
    if (!asset.dataUrl) return stripDataUrl(asset);
    const persisted = persistVisualAsset(asset, index, context, config);
    assets.push(persisted);
    return {
      ...stripDataUrl(asset),
      vaultPath: persisted.vaultPath,
      mimeType: asset.mimeType ?? "image/jpeg",
    };
  });

  return {
    context: {
      ...context,
      visualAssets,
    },
    assets,
  };
}

function persistVisualAsset(
  asset: VisualAsset,
  index: number,
  context: ReadingContext,
  config: BridgeConfig,
): PreparedVisualAsset {
  const parsed = parseDataUrl(asset.dataUrl);
  const extension = extensionFromMime(parsed.mimeType);
  const sourceSlug = slugify(context.source.title, "visual").slice(0, 36);
  const hash = shortHash(`${context.source.url}${asset.id}${asset.label}${asset.dataUrl?.slice(0, 200)}${Date.now()}`);
  const fileName = `${todayPathDate()}-${sourceSlug}-${index + 1}-${hash}.${extension}`;
  const vaultPath = `${ASSET_DIRECTORY}/${fileName}`;
  const fullPath = join(config.vaultPath, vaultPath);
  mkdirSync(join(config.vaultPath, ASSET_DIRECTORY), { recursive: true });
  writeFileSync(fullPath, parsed.buffer);
  return {
    id: asset.id,
    type: asset.type,
    label: asset.label,
    path: fullPath,
    vaultPath,
    sourceUrl: asset.sourceUrl,
    alt: asset.alt,
  };
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
