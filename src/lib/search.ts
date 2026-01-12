import type { VideoItem } from "./types";

function normalize(s: string) {
  return s.trim().toLowerCase();
}

export function parseTagsInput(input: string): string[] {
  const parts = input
    .split(/[,\n]/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.replace(/^#/, "").trim();
    if (!t) continue;
    const key = normalize(t);
    if (!out.some((x) => normalize(x) === key)) out.push(t);
  }
  return out;
}

export function formatTags(tags: string[]) {
  return tags.map((t) => (t.startsWith("#") ? t : `#${t}`));
}

export function matchItem(item: VideoItem, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;

  const tokens = q.split(/\s+/g).filter(Boolean);
  const tagTokens = tokens.filter((t) => t.startsWith("#")).map((t) => t.slice(1));
  const textTokens = tokens.filter((t) => !t.startsWith("#"));

  const title = normalize(item.title || item.sourceTitle || "");
  const url = normalize(item.url);
  const vid = normalize(item.videoId || "");
  const tags = item.tags.map((t) => normalize(t.replace(/^#/, "")));

  for (const tt of tagTokens) {
    if (!tags.includes(tt)) return false;
  }

  for (const t of textTokens) {
    if (title.includes(t) || url.includes(t) || vid.includes(t)) continue;
    return false;
  }

  return true;
}

