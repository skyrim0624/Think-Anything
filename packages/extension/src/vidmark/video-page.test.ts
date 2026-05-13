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
  assert.equal(result?.title, "Demo Video");
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
