import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVidMarkHighlightsPrompt,
  buildVidMarkTranslatePrompt,
  parseVidMarkHighlightsOutput,
  parseVidMarkTranslateOutput,
} from "./vidmark.js";

const request = {
  video: {
    platform: "youtube" as const,
    url: "https://www.youtube.com/watch?v=abc123XYZ",
    canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ",
    videoId: "abc123XYZ",
    title: "Demo Video",
    capturedAt: "2026-05-13T00:00:00.000Z",
  },
  targetLanguage: "zh-CN" as const,
  cues: [
    { id: "cue-0001", startMs: 1000, endMs: 2400, text: "hello world", language: "en", source: "official" as const },
    { id: "cue-0002", startMs: 2400, endMs: 4600, text: "this is important", language: "en", source: "official" as const },
  ],
};

test("buildVidMarkTranslatePrompt includes video title and timestamped cues", () => {
  const prompt = buildVidMarkTranslatePrompt(request);

  assert.match(prompt, /Demo Video/);
  assert.match(prompt, /cue-0001/);
  assert.match(prompt, /00:01/);
  assert.match(prompt, /hello world/);
});

test("parseVidMarkTranslateOutput merges translated text by cue id", () => {
  const response = parseVidMarkTranslateOutput(
    JSON.stringify({
      translations: [
        { id: "cue-0001", translatedText: "你好，世界" },
        { id: "cue-0002", translatedText: "这很重要" },
      ],
    }),
    request.cues,
  );

  assert.equal(response.cues[0]?.translatedText, "你好，世界");
  assert.equal(response.cues[1]?.translatedText, "这很重要");
});

test("parseVidMarkTranslateOutput rejects invalid JSON", () => {
  assert.throws(
    () => parseVidMarkTranslateOutput("not json", request.cues),
    /VidMark 翻译输出不是有效 JSON/,
  );
});

test("buildVidMarkHighlightsPrompt asks for all clip types", () => {
  const prompt = buildVidMarkHighlightsPrompt({ video: request.video, cues: request.cues });

  assert.match(prompt, /Demo Video/);
  assert.match(prompt, /insight/);
  assert.match(prompt, /case/);
  assert.match(prompt, /method/);
  assert.match(prompt, /quote/);
  assert.match(prompt, /dispute/);
  assert.match(prompt, /action/);
});

test("parseVidMarkHighlightsOutput normalizes clips to cue boundaries", () => {
  const response = parseVidMarkHighlightsOutput(
    JSON.stringify({
      clips: [
        {
          id: "clip-1",
          title: "Key idea",
          type: "insight",
          summary: "The speaker names the key idea.",
          startMs: 0,
          endMs: 99_000,
          cueIds: ["cue-0001", "cue-0002"],
        },
      ],
    }),
    request.cues,
  );

  assert.equal(response.clips[0]?.startMs, 1000);
  assert.equal(response.clips[0]?.endMs, 4600);
});

test("parseVidMarkHighlightsOutput ignores clips without matching cues", () => {
  const response = parseVidMarkHighlightsOutput(
    JSON.stringify({
      clips: [
        {
          id: "clip-missing",
          title: "Missing",
          type: "insight",
          summary: "No matching cue.",
          startMs: 0,
          endMs: 99_000,
          cueIds: ["missing"],
        },
      ],
    }),
    request.cues,
  );

  assert.deepEqual(response.clips, []);
});
