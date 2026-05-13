import assert from "node:assert/strict";
import test from "node:test";
import {
  addVidMarkNote,
  createVidMarkReaderState,
  selectVidMarkCue,
  setVidMarkTab,
} from "./reader-state.js";

const video = {
  platform: "youtube" as const,
  url: "https://www.youtube.com/watch?v=abc123XYZ",
  canonicalUrl: "https://www.youtube.com/watch?v=abc123XYZ",
  videoId: "abc123XYZ",
  title: "Demo Video",
  capturedAt: "2026-05-13T00:00:00.000Z",
};

const cues = [
  { id: "cue-0001", startMs: 1000, endMs: 2200, text: "hello", translatedText: "你好" },
  { id: "cue-0002", startMs: 2200, endMs: 4200, text: "world", translatedText: "世界" },
];

test("setVidMarkTab switches the active reader tab", () => {
  const state = createVidMarkReaderState({ video, cues });

  const next = setVidMarkTab(state, "notes");

  assert.equal(next.activeTab, "notes");
  assert.equal(state.activeTab, "study");
});

test("createVidMarkReaderState starts from the learning view", () => {
  const state = createVidMarkReaderState({ video, cues });

  assert.equal(state.activeTab, "study");
});

test("selectVidMarkCue stores the selected cue id and timestamp", () => {
  const state = createVidMarkReaderState({ video, cues });

  const next = selectVidMarkCue(state, "cue-0002");

  assert.equal(next.selectedCueId, "cue-0002");
  assert.equal(next.currentTimeMs, 2200);
});

test("addVidMarkNote keeps cue binding and timestamp", () => {
  const state = selectVidMarkCue(createVidMarkReaderState({ video, cues }), "cue-0001");

  const next = addVidMarkNote(state, "这句值得收藏", "2026-05-13T01:00:00.000Z");

  assert.equal(next.notes.length, 1);
  assert.equal(next.notes[0]?.cueId, "cue-0001");
  assert.equal(next.notes[0]?.videoTimeMs, 1000);
  assert.equal(next.notes[0]?.originalText, "hello");
  assert.equal(next.notes[0]?.translatedText, "你好");
});
