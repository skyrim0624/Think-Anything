# VidMark MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build VidMark inside Think Anytime so a YouTube video page can open a browser reading mode with video metadata, transcript data, Chinese translation, highlight clips, timestamp notes, and an Obsidian video card.

**Architecture:** VidMark is implemented as a focused subsystem inside the existing Think Anytime monorepo. Shared packages define the video data contracts; the Chrome extension detects video pages and renders the reader; the local Bridge translates transcripts, extracts highlights, and writes VidMark cards into the vault.

**Tech Stack:** TypeScript, React 19, Chrome Manifest V3, Node HTTP Bridge, Codex SDK/CLI, Obsidian Markdown vault, Node test runner with `tsx`.

---

## File Structure

- `packages/shared/src/vidmark.ts`
  - VidMark domain types and pure helpers for timestamps, transcript sorting, active cue lookup, and clip normalization.
- `packages/shared/src/vidmark.test.ts`
  - Unit tests for the shared VidMark helpers.
- `packages/shared/src/index.ts`
  - Re-export VidMark types and helpers.
- `packages/extension/src/vidmark/video-page.ts`
  - Detect supported video pages, starting with YouTube watch pages.
- `packages/extension/src/vidmark/video-page.test.ts`
  - Unit tests for YouTube and unsupported URL detection.
- `packages/extension/src/vidmark/youtube-transcript.ts`
  - Extract and normalize YouTube caption tracks when they are discoverable from the page.
- `packages/extension/src/vidmark/youtube-transcript.test.ts`
  - Unit tests for caption track parsing and timedtext XML normalization.
- `packages/extension/src/vidmark/reader.tsx`
  - VidMark reader UI: video summary, bilingual transcript, highlight list, notes view, and error states.
- `packages/extension/src/vidmark/reader-state.ts`
  - Reader state reducers for tab switching, cue selection, notes, and loading states.
- `packages/extension/src/vidmark/reader-state.test.ts`
  - Unit tests for reader state changes.
- `packages/extension/src/vidmark/entrypoint.ts`
  - Content-script entrypoint for opening and updating the VidMark reader.
- `packages/extension/src/content.ts`
  - Wire browser shortcut and runtime message to VidMark entrypoint.
- `packages/extension/src/messages.ts`
  - Add VidMark runtime messages.
- `packages/extension/src/api.ts`
  - Add Bridge client functions for VidMark translation, highlights, and card saving.
- `packages/bridge/src/vidmark.ts`
  - Bridge service for translation prompts, highlight prompts, response parsing, and card Markdown generation.
- `packages/bridge/src/vidmark.test.ts`
  - Unit tests for prompt construction, parsed output validation, and card Markdown.
- `packages/bridge/src/index.ts`
  - Add VidMark HTTP endpoints.
- `packages/bridge/src/vault.ts`
  - Add `50-VIDMARK/` vault structure and card writing method.
- `README.md`
  - Add VidMark usage notes after the feature is usable.
- `docs/vidmark/CHANGELOG.md`
  - Append one entry after each committed stage.

## Verification Commands

Use these commands during implementation:

```bash
npx tsx --test packages/shared/src/vidmark.test.ts
npx tsx --test packages/extension/src/vidmark/video-page.test.ts
npx tsx --test packages/extension/src/vidmark/youtube-transcript.test.ts
npx tsx --test packages/extension/src/vidmark/reader-state.test.ts
npx tsx --test packages/bridge/src/vidmark.test.ts
npm run check
npm run build
```

Expected successful test output includes `# fail 0`. Expected successful check/build output exits with code `0`.

## Task 1: Shared VidMark Data Model

**Files:**

- Create: `packages/shared/src/vidmark.ts`
- Create: `packages/shared/src/vidmark.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/vidmark.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  findActiveCue,
  formatVidMarkTimestamp,
  normalizeVidMarkClip,
  sortVidMarkCues,
  type VidMarkTranscriptCue,
} from "./vidmark.js";

const cues: VidMarkTranscriptCue[] = [
  { id: "late", startMs: 3200, endMs: 4100, text: "late cue" },
  { id: "early", startMs: 1000, endMs: 1800, text: "early cue" },
];

test("sortVidMarkCues returns cues ordered by start time without mutating input", () => {
  const sorted = sortVidMarkCues(cues);

  assert.deepEqual(sorted.map((cue) => cue.id), ["early", "late"]);
  assert.deepEqual(cues.map((cue) => cue.id), ["late", "early"]);
});

test("formatVidMarkTimestamp formats hours, minutes, seconds", () => {
  assert.equal(formatVidMarkTimestamp(65000), "01:05");
  assert.equal(formatVidMarkTimestamp(3661000), "1:01:01");
});

test("findActiveCue returns the cue covering the current time", () => {
  const sorted = sortVidMarkCues(cues);

  assert.equal(findActiveCue(sorted, 1200)?.id, "early");
  assert.equal(findActiveCue(sorted, 2500), undefined);
});

test("normalizeVidMarkClip clamps clip boundaries to available cues", () => {
  const clip = normalizeVidMarkClip({
    id: "clip-1",
    title: "Key idea",
    type: "insight",
    summary: "The speaker names the important idea.",
    startMs: 0,
    endMs: 10_000,
    cueIds: ["early", "late"],
  }, sortVidMarkCues(cues));

  assert.equal(clip.startMs, 1000);
  assert.equal(clip.endMs, 4100);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx tsx --test packages/shared/src/vidmark.test.ts
```

Expected: FAIL because `packages/shared/src/vidmark.ts` does not exist.

- [ ] **Step 3: Add the shared implementation**

Create `packages/shared/src/vidmark.ts`:

```ts
export type VidMarkPlatform = "youtube" | "x" | "generic";
export type VidMarkTranscriptSource = "official" | "auto" | "manual" | "whisper";
export type VidMarkClipType = "insight" | "case" | "method" | "quote" | "dispute" | "action";

export interface VidMarkVideoMetadata {
  platform: VidMarkPlatform;
  url: string;
  canonicalUrl: string;
  videoId?: string;
  title: string;
  author?: string;
  sourcePageTitle?: string;
  sourcePageUrl?: string;
  capturedAt: string;
  currentTimeMs?: number;
}

export interface VidMarkTranscriptCue {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  translatedText?: string;
  language?: string;
  source?: VidMarkTranscriptSource;
}

export interface VidMarkClip {
  id: string;
  title: string;
  type: VidMarkClipType;
  summary: string;
  startMs: number;
  endMs: number;
  cueIds: string[];
}

export interface VidMarkNote {
  id: string;
  cueId?: string;
  clipId?: string;
  videoTimeMs: number;
  originalText?: string;
  translatedText?: string;
  note: string;
  createdAt: string;
}

export function sortVidMarkCues(cues: VidMarkTranscriptCue[]): VidMarkTranscriptCue[] {
  return [...cues].sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
}

export function formatVidMarkTimestamp(timeMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function findActiveCue(cues: VidMarkTranscriptCue[], timeMs: number): VidMarkTranscriptCue | undefined {
  return cues.find((cue) => cue.startMs <= timeMs && timeMs < cue.endMs);
}

export function normalizeVidMarkClip(clip: VidMarkClip, cues: VidMarkTranscriptCue[]): VidMarkClip {
  const cueMap = new Map(cues.map((cue) => [cue.id, cue]));
  const linkedCues = clip.cueIds.map((id) => cueMap.get(id)).filter((cue): cue is VidMarkTranscriptCue => Boolean(cue));
  if (!linkedCues.length) return clip;
  return {
    ...clip,
    startMs: Math.min(...linkedCues.map((cue) => cue.startMs)),
    endMs: Math.max(...linkedCues.map((cue) => cue.endMs)),
  };
}
```

Modify `packages/shared/src/index.ts`:

```ts
export * from "./vidmark.js";
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx tsx --test packages/shared/src/vidmark.test.ts
```

Expected: PASS with `# fail 0`.

- [ ] **Step 5: Type-check shared package**

Run:

```bash
npm run build -w @twyr/shared
```

Expected: exit code `0`.

- [ ] **Step 6: Update changelog and commit**

Append to `docs/vidmark/CHANGELOG.md`:

```md
## [2026-05-13] 字幕数据模型

- [进展]: 新增 VidMark 视频、字幕、片段和笔记数据模型。
- [进展]: 新增时间戳格式化、字幕排序、当前字幕查找和片段归一化测试。
```

Commit and push:

```bash
git add packages/shared/src/vidmark.ts packages/shared/src/vidmark.test.ts packages/shared/src/index.ts docs/vidmark/CHANGELOG.md
git commit -m "feat: add VidMark transcript model"
git push origin main
```

## Task 2: YouTube Video Page Detection

**Files:**

- Create: `packages/extension/src/vidmark/video-page.ts`
- Create: `packages/extension/src/vidmark/video-page.test.ts`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Write failing tests**

Create `packages/extension/src/vidmark/video-page.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { detectVidMarkVideoPage } from "./video-page.js";

test("detectVidMarkVideoPage recognizes YouTube watch URLs", () => {
  const result = detectVidMarkVideoPage({
    url: "https://www.youtube.com/watch?v=abc123XYZ",
    title: "Demo Video - YouTube",
    capturedAt: "2026-05-13T00:00:00.000Z",
  });

  assert.equal(result?.platform, "youtube");
  assert.equal(result?.videoId, "abc123XYZ");
  assert.equal(result?.canonicalUrl, "https://www.youtube.com/watch?v=abc123XYZ");
});

test("detectVidMarkVideoPage recognizes youtu.be short URLs", () => {
  const result = detectVidMarkVideoPage({
    url: "https://youtu.be/abc123XYZ?t=40",
    title: "Short Video",
    capturedAt: "2026-05-13T00:00:00.000Z",
  });

  assert.equal(result?.platform, "youtube");
  assert.equal(result?.videoId, "abc123XYZ");
  assert.equal(result?.canonicalUrl, "https://www.youtube.com/watch?v=abc123XYZ");
});

test("detectVidMarkVideoPage returns undefined for unsupported pages", () => {
  const result = detectVidMarkVideoPage({
    url: "https://example.com/article",
    title: "Article",
    capturedAt: "2026-05-13T00:00:00.000Z",
  });

  assert.equal(result, undefined);
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx tsx --test packages/extension/src/vidmark/video-page.test.ts
```

Expected: FAIL because `video-page.ts` does not exist.

- [ ] **Step 3: Implement detection**

Create `packages/extension/src/vidmark/video-page.ts`:

```ts
import type { VidMarkVideoMetadata } from "@twyr/shared";

export interface VidMarkPageSnapshot {
  url: string;
  title: string;
  author?: string;
  capturedAt: string;
  currentTimeMs?: number;
}

export function detectVidMarkVideoPage(snapshot: VidMarkPageSnapshot): VidMarkVideoMetadata | undefined {
  const url = new URL(snapshot.url);
  const youtubeId = getYouTubeVideoId(url);
  if (!youtubeId) return undefined;
  return {
    platform: "youtube",
    url: snapshot.url,
    canonicalUrl: `https://www.youtube.com/watch?v=${youtubeId}`,
    videoId: youtubeId,
    title: cleanupYouTubeTitle(snapshot.title),
    author: snapshot.author,
    sourcePageTitle: snapshot.title,
    sourcePageUrl: snapshot.url,
    capturedAt: snapshot.capturedAt,
    currentTimeMs: snapshot.currentTimeMs,
  };
}

function getYouTubeVideoId(url: URL): string | undefined {
  if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0];
  if (!url.hostname.endsWith("youtube.com")) return undefined;
  if (url.pathname !== "/watch") return undefined;
  return url.searchParams.get("v") || undefined;
}

function cleanupYouTubeTitle(title: string): string {
  return title.replace(/\s+-\s+YouTube$/i, "").trim() || "Untitled YouTube Video";
}
```

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx tsx --test packages/extension/src/vidmark/video-page.test.ts
```

Expected: PASS with `# fail 0`.

- [ ] **Step 5: Type-check extension**

Run:

```bash
npm run check -w @twyr/extension
```

Expected: exit code `0`.

- [ ] **Step 6: Update changelog and commit**

Append to `docs/vidmark/CHANGELOG.md`:

```md
## [2026-05-13] YouTube 页面识别

- [进展]: 新增 YouTube watch URL 和 youtu.be 短链接识别。
- [进展]: 输出统一 VidMark 视频元数据，为浏览器入口做准备。
```

Commit and push:

```bash
git add packages/extension/src/vidmark/video-page.ts packages/extension/src/vidmark/video-page.test.ts docs/vidmark/CHANGELOG.md
git commit -m "feat: add VidMark video entrypoint detection"
git push origin main
```

## Task 3: Browser Entrypoint Shell

**Files:**

- Create: `packages/extension/src/vidmark/entrypoint.ts`
- Modify: `packages/extension/src/content.ts`
- Modify: `packages/extension/src/messages.ts`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Add runtime message type**

Modify `packages/extension/src/messages.ts` by adding this union member:

```ts
| { type: "TWYR_OPEN_VIDMARK" }
```

- [ ] **Step 2: Add entrypoint shell**

Create `packages/extension/src/vidmark/entrypoint.ts`:

```ts
import { detectVidMarkVideoPage } from "./video-page.js";

const HOST_ID = "twyr-vidmark-host";

export function openVidMarkEntrypoint(): { ok: boolean; reason?: string } {
  const metadata = detectVidMarkVideoPage({
    url: location.href,
    title: document.title,
    capturedAt: new Date().toISOString(),
    currentTimeMs: getCurrentVideoTimeMs(),
  });

  const host = ensureHost();
  if (!metadata) {
    host.textContent = "VidMark 当前只支持 YouTube 视频页。";
    return { ok: false, reason: "unsupported-page" };
  }

  host.innerHTML = [
    `<strong>VidMark</strong>`,
    `<div>${escapeHtml(metadata.title)}</div>`,
    `<div>${escapeHtml(metadata.canonicalUrl)}</div>`,
    `<button type="button" data-vidmark-close>关闭</button>`,
  ].join("");
  host.querySelector("[data-vidmark-close]")?.addEventListener("click", () => host.remove());
  return { ok: true };
}

function ensureHost(): HTMLElement {
  const existing = document.getElementById(HOST_ID);
  if (existing) return existing;
  const host = document.createElement("section");
  host.id = HOST_ID;
  host.style.position = "fixed";
  host.style.inset = "80px 24px auto auto";
  host.style.zIndex = "2147483647";
  host.style.width = "360px";
  host.style.padding = "14px";
  host.style.border = "1px solid rgba(15, 118, 110, 0.25)";
  host.style.borderRadius = "10px";
  host.style.background = "#ffffff";
  host.style.color = "#111827";
  host.style.boxShadow = "0 18px 44px rgba(17, 24, 39, 0.18)";
  document.documentElement.append(host);
  return host;
}

function getCurrentVideoTimeMs(): number | undefined {
  const video = document.querySelector("video");
  if (!(video instanceof HTMLVideoElement)) return undefined;
  return Math.floor(video.currentTime * 1000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
```

- [ ] **Step 3: Wire content script**

Modify `packages/extension/src/content.ts`:

```ts
import { openVidMarkEntrypoint } from "./vidmark/entrypoint.js";
```

Handle the runtime message:

```ts
if (message.type === "TWYR_OPEN_VIDMARK") {
  sendResponse(openVidMarkEntrypoint());
  return true;
}
```

Add a keyboard shortcut inside the existing keydown listener:

```ts
if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && event.code === "KeyV") {
  if (event.target instanceof Element && isEditableElement(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  openVidMarkEntrypoint();
  return;
}
```

- [ ] **Step 4: Verify extension check and build**

Run:

```bash
npm run check -w @twyr/extension
npm run build -w @twyr/extension
```

Expected: both commands exit with code `0`.

- [ ] **Step 5: Update changelog and commit**

Append to `docs/vidmark/CHANGELOG.md`:

```md
## [2026-05-13] VidMark 浏览器入口

- [进展]: 新增 VidMark 内容脚本入口。
- [进展]: 支持在 YouTube 页面用快捷键打开基础 VidMark 面板。
```

Commit and push:

```bash
git add packages/extension/src/vidmark/entrypoint.ts packages/extension/src/content.ts packages/extension/src/messages.ts docs/vidmark/CHANGELOG.md
git commit -m "feat: add VidMark browser entrypoint"
git push origin main
```

## Task 4: YouTube Transcript Extraction

**Files:**

- Create: `packages/extension/src/vidmark/youtube-transcript.ts`
- Create: `packages/extension/src/vidmark/youtube-transcript.test.ts`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Write failing tests**

Create tests that cover two pure helpers:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { extractCaptionTracksFromPlayerResponse, parseYouTubeTimedText } from "./youtube-transcript.js";

test("extractCaptionTracksFromPlayerResponse reads caption track metadata", () => {
  const response = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl: "https://example.com/timedtext", languageCode: "en", name: { simpleText: "English" }, kind: "asr" },
        ],
      },
    },
  };

  const tracks = extractCaptionTracksFromPlayerResponse(response);

  assert.equal(tracks[0]?.language, "en");
  assert.equal(tracks[0]?.kind, "auto");
  assert.equal(tracks[0]?.url, "https://example.com/timedtext");
});

test("parseYouTubeTimedText converts XML text nodes into transcript cues", () => {
  const cues = parseYouTubeTimedText(`<transcript><text start="1.2" dur="2.4">hello &amp; world</text></transcript>`, "en");

  assert.equal(cues[0]?.startMs, 1200);
  assert.equal(cues[0]?.endMs, 3600);
  assert.equal(cues[0]?.text, "hello & world");
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
npx tsx --test packages/extension/src/vidmark/youtube-transcript.test.ts
```

Expected: FAIL because `youtube-transcript.ts` does not exist.

- [ ] **Step 3: Implement pure extraction helpers**

Implement:

- `extractCaptionTracksFromPlayerResponse(value: unknown)`
- `parseYouTubeTimedText(xml: string, language: string)`

The parser should use `DOMParser` in browser contexts and a small XML entity decoder in tests. It must return `VidMarkTranscriptCue[]` with stable cue IDs like `cue-0001`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx tsx --test packages/extension/src/vidmark/youtube-transcript.test.ts
npm run check -w @twyr/extension
```

Expected: tests pass with `# fail 0`; type-check exits with code `0`.

- [ ] **Step 5: Update changelog and commit**

Commit and push:

```bash
git add packages/extension/src/vidmark/youtube-transcript.ts packages/extension/src/vidmark/youtube-transcript.test.ts docs/vidmark/CHANGELOG.md
git commit -m "feat: extract YouTube transcript for VidMark"
git push origin main
```

## Task 5: Bridge Translation API

**Files:**

- Modify: `packages/shared/src/vidmark.ts`
- Create: `packages/bridge/src/vidmark.ts`
- Create: `packages/bridge/src/vidmark.test.ts`
- Modify: `packages/bridge/src/index.ts`
- Modify: `packages/extension/src/api.ts`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Add request and response types**

Add to `packages/shared/src/vidmark.ts`:

```ts
export interface VidMarkTranslateRequest {
  video: VidMarkVideoMetadata;
  cues: VidMarkTranscriptCue[];
  targetLanguage: "zh-CN";
}

export interface VidMarkTranslateResponse {
  cues: VidMarkTranscriptCue[];
}
```

- [ ] **Step 2: Write bridge tests**

Create `packages/bridge/src/vidmark.test.ts` covering:

- Prompt includes video title and transcript timestamps.
- Parsed JSON returns translated cue text by ID.
- Invalid JSON throws a clear error.

- [ ] **Step 3: Implement bridge service**

Create `packages/bridge/src/vidmark.ts` with:

- `buildVidMarkTranslatePrompt(request: VidMarkTranslateRequest): string`
- `parseVidMarkTranslateOutput(output: string, cues: VidMarkTranscriptCue[]): VidMarkTranslateResponse`

- [ ] **Step 4: Add HTTP endpoint**

Modify `packages/bridge/src/index.ts`:

```ts
if (request.method === "POST" && url.pathname === "/api/vidmark/translate") {
  await handleVidMarkTranslate(request, response);
  return;
}
```

The handler reads `VidMarkTranslateRequest`, runs Codex with the prompt, parses output, and returns `VidMarkTranslateResponse`.

- [ ] **Step 5: Add extension client**

Modify `packages/extension/src/api.ts`:

```ts
export async function translateVidMarkTranscript(
  settings: ExtensionSettings,
  body: VidMarkTranslateRequest,
): Promise<VidMarkTranslateResponse> {
  return request<VidMarkTranslateResponse>(settings, "/api/vidmark/translate", "POST", body);
}
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npx tsx --test packages/bridge/src/vidmark.test.ts
npm run check
```

Expected: tests pass with `# fail 0`; type-check exits with code `0`.

Commit and push:

```bash
git add packages/shared/src/vidmark.ts packages/bridge/src/vidmark.ts packages/bridge/src/vidmark.test.ts packages/bridge/src/index.ts packages/extension/src/api.ts docs/vidmark/CHANGELOG.md
git commit -m "feat: translate VidMark transcript blocks"
git push origin main
```

## Task 6: Reader State and UI

**Files:**

- Create: `packages/extension/src/vidmark/reader-state.ts`
- Create: `packages/extension/src/vidmark/reader-state.test.ts`
- Create: `packages/extension/src/vidmark/reader.tsx`
- Modify: `packages/extension/src/vidmark/entrypoint.ts`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Test reader state**

Create tests for:

- switching tabs between `transcript`, `clips`, and `notes`;
- selecting a cue updates `selectedCueId`;
- adding a note preserves timestamp and cue binding.

- [ ] **Step 2: Implement state helpers**

Create:

- `createVidMarkReaderState`
- `selectVidMarkCue`
- `addVidMarkNote`
- `setVidMarkTab`

- [ ] **Step 3: Render reader UI**

Create `reader.tsx` with a compact layout:

- Header: title, platform, close button.
- Tabs: 字幕, 高能, 笔记.
- Transcript rows: timestamp, original text, translated text.
- Notes list: timestamp and note text.

- [ ] **Step 4: Wire entrypoint to React**

Update `entrypoint.ts` to mount the React reader instead of static HTML.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx tsx --test packages/extension/src/vidmark/reader-state.test.ts
npm run check -w @twyr/extension
npm run build -w @twyr/extension
```

Expected: tests pass with `# fail 0`; check and build exit with code `0`.

Commit and push:

```bash
git add packages/extension/src/vidmark/reader-state.ts packages/extension/src/vidmark/reader-state.test.ts packages/extension/src/vidmark/reader.tsx packages/extension/src/vidmark/entrypoint.ts docs/vidmark/CHANGELOG.md
git commit -m "feat: add VidMark reader panel"
git push origin main
```

## Task 7: Highlight Clips

**Files:**

- Modify: `packages/shared/src/vidmark.ts`
- Modify: `packages/bridge/src/vidmark.ts`
- Modify: `packages/bridge/src/vidmark.test.ts`
- Modify: `packages/extension/src/vidmark/reader.tsx`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Add highlight request and response types**

Add:

```ts
export interface VidMarkHighlightsRequest {
  video: VidMarkVideoMetadata;
  cues: VidMarkTranscriptCue[];
}

export interface VidMarkHighlightsResponse {
  clips: VidMarkClip[];
}
```

- [ ] **Step 2: Add bridge prompt and parser tests**

Tests must verify:

- the prompt asks for insight, case, method, quote, dispute, and action clips;
- parsed clips are normalized to cue boundaries;
- clips without matching cues are ignored.

- [ ] **Step 3: Implement highlight generation helpers**

Add:

- `buildVidMarkHighlightsPrompt`
- `parseVidMarkHighlightsOutput`

- [ ] **Step 4: Add clips tab rendering**

Render each clip with type, title, summary, and timestamp range. Clicking a clip should call the same seek callback used by transcript rows.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx tsx --test packages/bridge/src/vidmark.test.ts
npm run check
```

Expected: tests pass with `# fail 0`; type-check exits with code `0`.

Commit and push:

```bash
git add packages/shared/src/vidmark.ts packages/bridge/src/vidmark.ts packages/bridge/src/vidmark.test.ts packages/extension/src/vidmark/reader.tsx docs/vidmark/CHANGELOG.md
git commit -m "feat: generate VidMark highlight clips"
git push origin main
```

## Task 8: Obsidian VidMark Cards

**Files:**

- Modify: `packages/shared/src/vidmark.ts`
- Modify: `packages/bridge/src/vidmark.ts`
- Modify: `packages/bridge/src/vidmark.test.ts`
- Modify: `packages/bridge/src/vault.ts`
- Modify: `packages/bridge/src/index.ts`
- Modify: `packages/extension/src/api.ts`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Add save request and response types**

Add:

```ts
export interface VidMarkSaveCardRequest {
  video: VidMarkVideoMetadata;
  cues: VidMarkTranscriptCue[];
  clips: VidMarkClip[];
  notes: VidMarkNote[];
}

export interface VidMarkSaveCardResponse {
  path: string;
  indexPath: string;
}
```

- [ ] **Step 2: Test Markdown generation**

Tests must verify the card includes:

- frontmatter `type: vidmark-video`;
- source URL;
- high-energy clips;
- timestamped bilingual excerpts;
- user notes.

- [ ] **Step 3: Implement vault writer**

Add to `VaultService`:

- `ensureVidMarkStructure()`
- `writeVidMarkCard(request: VidMarkSaveCardRequest): VidMarkSaveCardResponse`

The card path should be under `50-VIDMARK/videos/`.

- [ ] **Step 4: Add save endpoint and client**

Add `/api/vidmark/save-card` in Bridge and `saveVidMarkCard` in extension API.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx tsx --test packages/bridge/src/vidmark.test.ts
npm run check
```

Expected: tests pass with `# fail 0`; type-check exits with code `0`.

Commit and push:

```bash
git add packages/shared/src/vidmark.ts packages/bridge/src/vidmark.ts packages/bridge/src/vidmark.test.ts packages/bridge/src/vault.ts packages/bridge/src/index.ts packages/extension/src/api.ts docs/vidmark/CHANGELOG.md
git commit -m "feat: save VidMark video cards"
git push origin main
```

## Task 9: MVP Documentation

**Files:**

- Modify: `README.md`
- Modify: `docs/vidmark/CHANGELOG.md`

- [ ] **Step 1: Add README section**

Document:

- what VidMark does;
- supported pages;
- shortcut;
- Bridge requirement;
- Obsidian output path;
- current X-video limitation.

- [ ] **Step 2: Add MVP verification checklist**

Add to `docs/vidmark/CHANGELOG.md`:

```md
## [2026-05-13] MVP 文档与验证

- [进展]: README 新增 VidMark 使用说明。
- [验证]: 完整运行 `npm run check` 和 `npm run build`。
```

- [ ] **Step 3: Verify full repo**

Run:

```bash
npm run check
npm run build
```

Expected: both commands exit with code `0`.

- [ ] **Step 4: Commit and push**

```bash
git add README.md docs/vidmark/CHANGELOG.md
git commit -m "docs: document VidMark MVP"
git push origin main
```

## Self-Review

- Spec coverage: Tasks cover video detection, data model, YouTube transcript extraction, translation, highlight clips, reader UI, Obsidian card writing, documentation, and changelog updates.
- Scope control: X video support is intentionally not part of the first executable MVP path; the model and capture boundaries leave room for it.
- Type consistency: Shared request and response types are defined before Bridge and extension API usage.
- Verification: Every implementation task has a test or check command and a commit/push step.
