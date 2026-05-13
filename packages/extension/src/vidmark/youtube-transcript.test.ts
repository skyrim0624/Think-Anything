import assert from "node:assert/strict";
import test from "node:test";
import { extractCaptionTracksFromPlayerResponse, parseYouTubeTimedText } from "./youtube-transcript.js";

test("extractCaptionTracksFromPlayerResponse reads caption track metadata", () => {
  const response = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: "https://example.com/timedtext",
            languageCode: "en",
            name: { simpleText: "English" },
            kind: "asr",
          },
        ],
      },
    },
  };

  const tracks = extractCaptionTracksFromPlayerResponse(response);

  assert.equal(tracks[0]?.language, "en");
  assert.equal(tracks[0]?.label, "English");
  assert.equal(tracks[0]?.kind, "auto");
  assert.equal(tracks[0]?.url, "https://example.com/timedtext");
});

test("parseYouTubeTimedText converts XML text nodes into transcript cues", () => {
  const cues = parseYouTubeTimedText(
    '<transcript><text start="1.2" dur="2.4">hello &amp; world</text></transcript>',
    "en",
  );

  assert.equal(cues[0]?.id, "cue-0001");
  assert.equal(cues[0]?.startMs, 1200);
  assert.equal(cues[0]?.endMs, 3600);
  assert.equal(cues[0]?.text, "hello & world");
  assert.equal(cues[0]?.language, "en");
  assert.equal(cues[0]?.source, "official");
});
