import type { Playlist, StoredStateV1, VideoItem } from "./types";
import { newId } from "./id";

const STORAGE_KEY = "ytpwa:data:v1";

function defaultState(): StoredStateV1 {
  const now = Date.now();
  const fav: Playlist = {
    id: newId("pl"),
    name: "즐겨찾기",
    createdAt: now,
    items: []
  };

  return {
    version: 1,
    selectedPlaylistId: fav.id,
    playlists: [fav]
  };
}

function isStoredStateV1(x: unknown): x is StoredStateV1 {
  if (!x || typeof x !== "object") return false;
  const any = x as StoredStateV1;
  return any.version === 1 && Array.isArray(any.playlists) && typeof any.selectedPlaylistId === "string";
}

export function loadStoredState(): StoredStateV1 {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed: unknown = JSON.parse(raw);
    if (!isStoredStateV1(parsed)) return defaultState();

    // 최소 정합성 보정
    if (parsed.playlists.length === 0) return defaultState();
    const exists = parsed.playlists.some((p) => p.id === parsed.selectedPlaylistId);
    if (!exists) parsed.selectedPlaylistId = parsed.playlists[0]!.id;
    return parsed;
  } catch {
    return defaultState();
  }
}

export function saveStoredState(state: StoredStateV1) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function upsertPlaylist(state: StoredStateV1, playlist: Playlist): StoredStateV1 {
  const idx = state.playlists.findIndex((p) => p.id === playlist.id);
  const playlists = [...state.playlists];
  if (idx >= 0) playlists[idx] = playlist;
  else playlists.unshift(playlist);
  return { ...state, playlists };
}

export function deletePlaylist(state: StoredStateV1, playlistId: string): StoredStateV1 {
  const playlists = state.playlists.filter((p) => p.id !== playlistId);
  if (playlists.length === 0) return defaultState();
  const selectedPlaylistId =
    state.selectedPlaylistId === playlistId ? playlists[0]!.id : state.selectedPlaylistId;
  return { ...state, playlists, selectedPlaylistId };
}

export function addVideoToPlaylist(
  state: StoredStateV1,
  playlistId: string,
  item: VideoItem
): StoredStateV1 {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl) return state;

  const normalizedUrl = item.url.trim();
  const videoKey = item.videoId || normalizedUrl;

  const exists = pl.items.some((v) => (v.videoId || v.url) === videoKey);
  if (exists) return state;

  const updated: Playlist = { ...pl, items: [item, ...pl.items] };
  return upsertPlaylist(state, updated);
}

export function removeVideoFromPlaylist(state: StoredStateV1, playlistId: string, videoItemId: string) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl) return state;
  const updated: Playlist = { ...pl, items: pl.items.filter((v) => v.id !== videoItemId) };
  return upsertPlaylist(state, updated);
}

export function updateVideoInPlaylist(
  state: StoredStateV1,
  playlistId: string,
  videoItemId: string,
  patch: Partial<VideoItem>
) {
  const pl = state.playlists.find((p) => p.id === playlistId);
  if (!pl) return state;
  const items = pl.items.map((v) => (v.id === videoItemId ? { ...v, ...patch } : v));
  return upsertPlaylist(state, { ...pl, items });
}

export function moveVideo(
  state: StoredStateV1,
  fromPlaylistId: string,
  toPlaylistId: string,
  videoItemId: string
): StoredStateV1 {
  if (fromPlaylistId === toPlaylistId) return state;
  const from = state.playlists.find((p) => p.id === fromPlaylistId);
  const to = state.playlists.find((p) => p.id === toPlaylistId);
  if (!from || !to) return state;

  const item = from.items.find((v) => v.id === videoItemId);
  if (!item) return state;

  let next = removeVideoFromPlaylist(state, fromPlaylistId, videoItemId);
  next = addVideoToPlaylist(next, toPlaylistId, item);
  return next;
}

