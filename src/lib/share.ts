import pako from "pako";
import type { Playlist, StoredStateV1, VideoItem } from "./types";
import { newId } from "./id";

// 공유 링크에 넣을 때는 크기를 줄이기 위해 "공유용" 형태로 축약한다.
// (썸네일은 oEmbed로 재생성 가능하므로 기본은 제외)
export type ShareStateV1 = {
  v: 1;
  // playlists
  p: Array<{
    n: string; // name
    c: number; // createdAt
    i: Array<{
      u: string; // url
      y?: string; // videoId
      t?: string; // title
      g?: string[]; // tags
      a: number; // addedAt
      h?: string; // thumbnailUrl (옵션)
    }>;
  }>;
};

function toUtf8Bytes(s: string) {
  return new TextEncoder().encode(s);
}

function fromUtf8Bytes(bytes: Uint8Array) {
  return new TextDecoder().decode(bytes);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function fromBase64(b64: string) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlEncode(bytes: Uint8Array) {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(s: string) {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return fromBase64(padded);
}

export type ShareEncodeOptions = {
  includeThumbnails?: boolean;
  scope?: "all" | "selected";
};

export function encodeShareFromState(state: StoredStateV1, opts: ShareEncodeOptions = {}) {
  const includeThumbnails = Boolean(opts.includeThumbnails);
  const scope = opts.scope || "all";
  const playlists = scope === "selected"
    ? state.playlists.filter((p) => p.id === state.selectedPlaylistId)
    : state.playlists;

  const payload: ShareStateV1 = {
    v: 1,
    p: playlists.map((pl) => ({
      n: pl.name,
      c: pl.createdAt,
      i: pl.items.map((it) => ({
        u: it.url,
        y: it.videoId || undefined,
        t: it.title || it.sourceTitle || undefined,
        g: it.tags?.length ? it.tags : undefined,
        a: it.addedAt,
        h: includeThumbnails ? it.thumbnailUrl : undefined
      }))
    }))
  };

  const json = JSON.stringify(payload);
  const deflated = pako.deflateRaw(toUtf8Bytes(json));
  const data = base64UrlEncode(deflated);
  return `v1.${data}`;
}

export function decodeShareToState(encoded: string): StoredStateV1 {
  // encoded: v1.<data>
  const m = encoded.trim().match(/^v1\.(.+)$/);
  if (!m) throw new Error("unsupported");
  const data = m[1]!;

  const inflated = pako.inflateRaw(base64UrlDecode(data));
  const json = fromUtf8Bytes(inflated);
  const payload = JSON.parse(json) as ShareStateV1;
  if (!payload || payload.v !== 1 || !Array.isArray(payload.p)) throw new Error("invalid");

  // 충돌 방지를 위해 새 ID로 재생성하며 복원한다.
  const now = Date.now();
  const playlists: Playlist[] = payload.p.map((pl) => {
    const playlistId = newId("pl");
    const items: VideoItem[] = (pl.i || []).map((it) => ({
      id: newId("v"),
      url: it.u,
      videoId: it.y,
      title: it.t,
      thumbnailUrl: it.h,
      sourceTitle: undefined,
      tags: it.g || [],
      addedAt: it.a || now
    }));
    return {
      id: playlistId,
      name: pl.n || "가져온 목록",
      createdAt: pl.c || now,
      items
    };
  });

  const selectedPlaylistId = playlists[0]?.id || newId("pl");
  return { version: 1, playlists: playlists.length ? playlists : [], selectedPlaylistId };
}

export function extractSharePayloadFromUrlOrHash(input: string): string | undefined {
  const s = input.trim();
  if (!s) return undefined;

  // 1) 그냥 payload(v1.xxx)만 붙여넣은 경우
  if (/^v1\./.test(s)) return s;

  // 2) 전체 URL 붙여넣은 경우
  try {
    const u = new URL(s);
    // hash: #/import?d=...
    const hash = u.hash || "";
    const idx = hash.indexOf("?");
    if (idx !== -1) {
      const params = new URLSearchParams(hash.slice(idx + 1));
      const d = params.get("d");
      if (d) return d;
    }
    // query: ?d=...
    const d2 = u.searchParams.get("d");
    if (d2) return d2;
  } catch {
    // ignore
  }

  return undefined;
}

