export type YouTubeMeta = {
  title?: string;
  thumbnailUrl?: string;
};

export function extractFirstUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s]+/i);
  return m?.[0];
}

export function normalizeYouTubeUrl(input: string): { url: string; videoId?: string } {
  const trimmed = input.trim();
  let url: URL | undefined;
  try {
    url = new URL(trimmed);
  } catch {
    // URL이 아니면 그냥 문자열로 저장
    return { url: trimmed };
  }

  const host = url.hostname.replace(/^www\./, "");
  let videoId: string | undefined;

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (id) videoId = id;
  }

  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (url.pathname === "/watch") {
      const id = url.searchParams.get("v") || undefined;
      if (id) videoId = id;
    } else if (url.pathname.startsWith("/shorts/")) {
      const id = url.pathname.split("/")[2];
      if (id) videoId = id;
    } else if (url.pathname.startsWith("/embed/")) {
      const id = url.pathname.split("/")[2];
      if (id) videoId = id;
    }
  }

  // 불필요한 파라미터 정리(영상 재생과 무관한 것 일부 제거)
  const cleaned = new URL(url.toString());
  const keep = new Set(["v", "t", "start", "list", "index", "si"]);
  [...cleaned.searchParams.keys()].forEach((k) => {
    if (!keep.has(k)) cleaned.searchParams.delete(k);
  });

  return { url: cleaned.toString(), videoId };
}

export async function fetchYouTubeOEmbed(url: string, signal?: AbortSignal): Promise<YouTubeMeta> {
  // API 키 없이 제목/썸네일을 얻는 가장 간단한 방법
  const endpoint = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const resp = await fetch(endpoint, { signal });
  if (!resp.ok) return {};
  const json = (await resp.json()) as { title?: string; thumbnail_url?: string };
  return { title: json.title, thumbnailUrl: json.thumbnail_url };
}

