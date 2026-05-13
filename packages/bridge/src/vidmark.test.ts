import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVidMarkCardMarkdown,
  buildVidMarkHighlightsPrompt,
  buildVidMarkStudyGuidePrompt,
  buildVidMarkTranslatePrompt,
  parseVidMarkHighlightsOutput,
  parseVidMarkStudyGuideOutput,
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
  assert.match(prompt, /时间切片/);
  assert.match(prompt, /先通读全部字幕/);
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

test("buildVidMarkStudyGuidePrompt asks for a learning workspace, not only clips", () => {
  const prompt = buildVidMarkStudyGuidePrompt({
    video: request.video,
    cues: request.cues,
    clips: [
      {
        id: "clip-1",
        title: "Key idea",
        type: "insight",
        summary: "The key idea appears here.",
        startMs: 1000,
        endMs: 4600,
        cueIds: ["cue-0001", "cue-0002"],
      },
    ],
  });

  assert.match(prompt, /学习导演/);
  assert.match(prompt, /quickPreview/);
  assert.match(prompt, /suggestedQuestions/);
  assert.match(prompt, /memorableQuotes/);
  assert.match(prompt, /glossary/);
});

test("parseVidMarkStudyGuideOutput keeps usable learning guide fields", () => {
  const response = parseVidMarkStudyGuideOutput(
    JSON.stringify({
      guide: {
        quickPreview: "这段视频解释了一个关键判断。",
        learningPath: [
          { clipId: "clip-1", why: "先看这里建立主线。", question: "这个判断成立的前提是什么？" },
        ],
        keyTakeaways: ["把问题转成可验证假设。"],
        suggestedQuestions: [{ id: "q1", question: "我如何把它用到自己的项目？", cueIds: ["cue-0001"] }],
        memorableQuotes: [
          { id: "quote-1", text: "this is important", translatedText: "这很重要", reason: "可作为复述入口。", cueId: "cue-0002" },
        ],
        glossary: [{ term: "hypothesis", explanation: "可被验证或推翻的判断。" }],
      },
    }),
    request.cues,
  );

  assert.equal(response.guide.quickPreview, "这段视频解释了一个关键判断。");
  assert.equal(response.guide.learningPath[0]?.clipId, "clip-1");
  assert.equal(response.guide.suggestedQuestions[0]?.cueIds?.[0], "cue-0001");
  assert.equal(response.guide.memorableQuotes[0]?.cueId, "cue-0002");
  assert.equal(response.guide.glossary[0]?.term, "hypothesis");
});

test("buildVidMarkCardMarkdown includes source, clips, bilingual excerpts, and notes", () => {
  const markdown = buildVidMarkCardMarkdown({
    video: request.video,
    cues: [
      {
        ...request.cues[0]!,
        translatedText: "你好，世界",
      },
    ],
    clips: [
      {
        id: "clip-1",
        title: "Key idea",
        type: "insight",
        summary: "The key idea appears here.",
        startMs: 1000,
        endMs: 2400,
        cueIds: ["cue-0001"],
      },
    ],
    notes: [
      {
        id: "note-1",
        cueId: "cue-0001",
        videoTimeMs: 1000,
        originalText: "hello world",
        translatedText: "你好，世界",
        note: "这句适合做开头。",
        createdAt: "2026-05-13T01:00:00.000Z",
      },
    ],
    guide: {
      quickPreview: "这段视频解释了一个关键判断。",
      learningPath: [{ clipId: "clip-1", why: "先看这里建立主线。", question: "这个判断成立的前提是什么？" }],
      keyTakeaways: ["把问题转成可验证假设。"],
      suggestedQuestions: [{ id: "q1", question: "我如何把它用到自己的项目？", cueIds: ["cue-0001"] }],
      memorableQuotes: [{ id: "quote-1", text: "hello world", translatedText: "你好，世界", reason: "可作为复述入口。", cueId: "cue-0001" }],
      glossary: [{ term: "hypothesis", explanation: "可被验证或推翻的判断。" }],
    },
  });

  assert.match(markdown, /type: vidmark-video/);
  assert.match(markdown, /sourceUrl: "https:\/\/www\.youtube\.com\/watch\?v=abc123XYZ"/);
  assert.match(markdown, /## 高能片段/);
  assert.match(markdown, /Key idea/);
  assert.match(markdown, /hello world/);
  assert.match(markdown, /你好，世界/);
  assert.match(markdown, /这句适合做开头。/);
  assert.match(markdown, /## 学习导览/);
  assert.match(markdown, /这段视频解释了一个关键判断。/);
});
