export type VideoItem = {
  id: string;
  url: string;
  videoId?: string;
  title?: string;
  thumbnailUrl?: string;
  sourceTitle?: string; // 공유(share target)에서 넘어온 제목 등
  tags: string[];
  addedAt: number;
};

export type Playlist = {
  id: string;
  name: string;
  createdAt: number;
  items: VideoItem[];
};

export type StoredStateV1 = {
  version: 1;
  selectedPlaylistId: string;
  playlists: Playlist[];
};

