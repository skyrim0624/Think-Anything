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

  assert.deepEqual(
    sorted.map((cue) => cue.id),
    ["early", "late"],
  );
  assert.deepEqual(
    cues.map((cue) => cue.id),
    ["late", "early"],
  );
});

test("formatVidMarkTimestamp formats hours, minutes, seconds", () => {
  assert.equal(formatVidMarkTimestamp(65_000), "01:05");
  assert.equal(formatVidMarkTimestamp(3_661_000), "1:01:01");
});

test("findActiveCue returns the cue covering the current time", () => {
  const sorted = sortVidMarkCues(cues);

  assert.equal(findActiveCue(sorted, 1200)?.id, "early");
  assert.equal(findActiveCue(sorted, 2500), undefined);
});

test("normalizeVidMarkClip clamps clip boundaries to available cues", () => {
  const clip = normalizeVidMarkClip(
    {
      id: "clip-1",
      title: "Key idea",
      type: "insight",
      summary: "The speaker names the important idea.",
      startMs: 0,
      endMs: 10_000,
      cueIds: ["early", "late"],
    },
    sortVidMarkCues(cues),
  );

  assert.equal(clip.startMs, 1000);
  assert.equal(clip.endMs, 4100);
});
