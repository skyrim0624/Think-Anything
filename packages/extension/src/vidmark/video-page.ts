import type { VidMarkVideoMetadata } from "@twyr/shared";

export interface VidMarkPageSnapshot {
  url: string;
  title: string;
  author?: string;
  capturedAt: string;
  currentTimeMs?: number;
}

export function detectVidMarkVideoPage(snapshot: VidMarkPageSnapshot): VidMarkVideoMetadata | undefined {
  let url: URL;
  try {
    url = new URL(snapshot.url);
  } catch {
    return undefined;
  }

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
  if (url.hostname === "youtu.be") {
    return url.pathname.split("/").filter(Boolean)[0];
  }
  if (!url.hostname.endsWith("youtube.com")) return undefined;
  if (url.pathname !== "/watch") return undefined;
  return url.searchParams.get("v") || undefined;
}

function cleanupYouTubeTitle(title: string): string {
  return title.replace(/\s+-\s+YouTube$/i, "").trim() || "Untitled YouTube Video";
}
