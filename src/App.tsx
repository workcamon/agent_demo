import React, { useEffect, useMemo, useRef, useState } from "react";
import type { Playlist, StoredStateV1, VideoItem } from "./lib/types";
import { newId } from "./lib/id";
import {
  addVideoToPlaylist,
  deletePlaylist,
  loadStoredState,
  moveVideo,
  removeVideoFromPlaylist,
  saveStoredState,
  updateVideoInPlaylist,
  upsertPlaylist
} from "./lib/storage";
import { formatTags, matchItem, parseTagsInput } from "./lib/search";
import { extractFirstUrl, fetchYouTubeOEmbed, normalizeYouTubeUrl } from "./lib/youtube";
import { formatDateTime } from "./lib/time";
import { Modal } from "./components/Modal";
import { decodeShareToState, encodeShareFromState, extractSharePayloadFromUrlOrHash } from "./lib/share";

type ModalState =
  | { type: "addVideo"; presetUrl?: string; presetTitle?: string; presetText?: string }
  | { type: "playlist"; mode: "create" | "rename"; playlistId?: string }
  | { type: "editTags"; playlistId: string; videoItemId: string }
  | { type: "move"; fromPlaylistId: string; videoItemId: string }
  | { type: "importExport" }
  | { type: "bookmarklet" }
  | { type: "shareLink" }
  | { type: "applyImport"; encoded: string }
  | null;

function pickDefaultPlaylistId(state: StoredStateV1) {
  const exists = state.playlists.some((p) => p.id === state.selectedPlaylistId);
  return exists ? state.selectedPlaylistId : state.playlists[0]!.id;
}

function safeText(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function buildBookmarklet(appUrl: string) {
  const base = appUrl.replace(/\/+$/, "");
  const js =
    `javascript:(()=>{` +
    `const u=location.href;` +
    `window.open('${base}/#/?add=1&url='+encodeURIComponent(u),'_blank','noopener,noreferrer');` +
    `})();`;
  return js;
}

function parseHashQuery(): URLSearchParams {
  const hash = window.location.hash || "";
  const idx = hash.indexOf("?");
  if (idx === -1) return new URLSearchParams();
  return new URLSearchParams(hash.slice(idx + 1));
}

function parseHashPath(): { path: string; query: URLSearchParams } {
  // expected: #/something?x=1
  const hash = window.location.hash || "";
  const noHash = hash.startsWith("#") ? hash.slice(1) : hash;
  const qIdx = noHash.indexOf("?");
  const path = (qIdx === -1 ? noHash : noHash.slice(0, qIdx)) || "/";
  const query = new URLSearchParams(qIdx === -1 ? "" : noHash.slice(qIdx + 1));
  return { path, query };
}

function getBasePath() {
  // 정적 호스팅에서 서브패스(/myapp/)로 배포되는 경우를 고려
  const p = window.location.pathname;
  if (p.endsWith("/")) return p;
  if (p.endsWith(".html")) return p.replace(/[^/]+$/, "");
  return p + "/";
}

export function App() {
  const [state, setState] = useState<StoredStateV1>(() => {
    const s = loadStoredState();
    return { ...s, selectedPlaylistId: pickDefaultPlaylistId(s) };
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [modal, setModal] = useState<ModalState>(null);
  const [status, setStatus] = useState<string>("");

  const selectedPlaylist = useMemo(() => {
    return state.playlists.find((p) => p.id === state.selectedPlaylistId) || state.playlists[0]!;
  }, [state.playlists, state.selectedPlaylistId]);

  const filteredItems = useMemo(() => {
    const items = selectedPlaylist.items;
    if (!searchQuery.trim()) return items;
    return items.filter((it) => matchItem(it, searchQuery));
  }, [selectedPlaylist.items, searchQuery]);

  useEffect(() => {
    saveStoredState(state);
  }, [state]);

  // /share (Web Share Target) → hash 기반 add로 변환
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.pathname === "/share") {
      const sharedUrl = url.searchParams.get("url") || extractFirstUrl(url.searchParams.get("text") || "") || "";
      const title = url.searchParams.get("title") || "";
      const text = url.searchParams.get("text") || "";
      const hq = new URLSearchParams();
      hq.set("add", "1");
      if (sharedUrl) hq.set("url", sharedUrl);
      if (title) hq.set("title", title);
      if (text) hq.set("text", text);
      window.history.replaceState({}, "", getBasePath() + "#/?".concat(hq.toString()));
    }
  }, []);

  // deep link: #/?add=1&url=...
  useEffect(() => {
    function handleHash() {
      const { path, query } = parseHashPath();

      // 1) 공유 링크 import: #/import?d=...
      if (path === "/import") {
        const d = query.get("d") || "";
        if (d) {
          setModal({ type: "applyImport", encoded: d });
          // 다시 열려도 반복 실행되지 않도록 d 제거
          query.delete("d");
          const rest = query.toString();
          window.history.replaceState({}, "", getBasePath() + (rest ? `#/import?${rest}` : "#/import"));
          return;
        }
      }

      // 2) add flow: #/?add=1&url=...
      const add = query.get("add");
      const url = query.get("url") || "";
      if (add === "1" && url) {
        const title = query.get("title") || undefined;
        const text = query.get("text") || undefined;
        setModal({ type: "addVideo", presetUrl: url, presetTitle: title, presetText: text });
        // 동일 해시 반복 호출 방지: add=0으로 치환
        query.set("add", "0");
        const rest = query.toString();
        window.history.replaceState({}, "", getBasePath() + (rest ? `#/?${rest}` : "#/"));
      }
    }
    handleHash();
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  function selectPlaylist(playlistId: string) {
    setState((s) => ({ ...s, selectedPlaylistId: playlistId }));
  }

  function onCreatePlaylist(name: string) {
    const now = Date.now();
    const pl: Playlist = { id: newId("pl"), name: name.trim() || "새 목록", createdAt: now, items: [] };
    setState((s) => ({ ...upsertPlaylist(s, pl), selectedPlaylistId: pl.id }));
  }

  function onRenamePlaylist(playlistId: string, name: string) {
    setState((s) => {
      const pl = s.playlists.find((p) => p.id === playlistId);
      if (!pl) return s;
      return upsertPlaylist(s, { ...pl, name: name.trim() || pl.name });
    });
  }

  function onDeletePlaylist(playlistId: string) {
    const pl = state.playlists.find((p) => p.id === playlistId);
    const ok = window.confirm(`"${pl?.name ?? "목록"}"을(를) 삭제할까요?\n(안의 영상들도 함께 삭제됩니다)`);
    if (!ok) return;
    setState((s) => deletePlaylist(s, playlistId));
  }

  async function onAddVideo(args: { playlistId: string; url: string; tags: string[]; sourceTitle?: string }) {
    setStatus("영상 정보를 불러오는 중…");
    try {
      const normalized = normalizeYouTubeUrl(args.url);
      const meta = await fetchYouTubeOEmbed(normalized.url);
      const item: VideoItem = {
        id: newId("v"),
        url: normalized.url,
        videoId: normalized.videoId,
        title: meta.title,
        thumbnailUrl: meta.thumbnailUrl,
        sourceTitle: args.sourceTitle,
        tags: args.tags,
        addedAt: Date.now()
      };
      setState((s) => addVideoToPlaylist(s, args.playlistId, item));
      setStatus("추가 완료");
      setTimeout(() => setStatus(""), 1000);
    } catch {
      setStatus("추가 실패(네트워크/주소를 확인해주세요)");
      setTimeout(() => setStatus(""), 1600);
    }
  }

  function exportJson() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yt-playlists-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("클립보드에 복사했어요");
      setTimeout(() => setStatus(""), 1000);
    } catch {
      setStatus("복사 실패(브라우저 권한)");
      setTimeout(() => setStatus(""), 1300);
    }
  }

  function importJson(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = safeText(reader.result);
        const parsed = JSON.parse(raw) as StoredStateV1;
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.playlists)) throw new Error("invalid");
        const fixed: StoredStateV1 = {
          version: 1,
          playlists: parsed.playlists,
          selectedPlaylistId: parsed.selectedPlaylistId || (parsed.playlists[0]?.id ?? "")
        };
        fixed.selectedPlaylistId = pickDefaultPlaylistId(fixed);
        setState(fixed);
        setStatus("가져오기 완료");
        setTimeout(() => setStatus(""), 1000);
      } catch {
        setStatus("가져오기 실패(JSON 형식 확인)");
        setTimeout(() => setStatus(""), 1500);
      }
    };
    reader.readAsText(file);
  }

  const allTags = useMemo(() => {
    const map = new Map<string, number>();
    for (const pl of state.playlists) {
      for (const it of pl.items) {
        for (const t of it.tags) {
          const key = t.replace(/^#/, "").trim();
          if (!key) continue;
          map.set(key, (map.get(key) || 0) + 1);
        }
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 18);
  }, [state.playlists]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="brand">
            <img src="/icon.svg" alt="" />
            <div style={{ minWidth: 0 }}>
              <div className="brand-title">YouTube 재생목록 매니저</div>
              <div className="brand-sub">즐겨찾기 + 태그 검색 (PWA)</div>
            </div>
          </div>
          <div className="sidebar-actions">
            <button className="btn small primary" onClick={() => setModal({ type: "addVideo" })} title="영상 추가">
              + 영상
            </button>
            <button className="btn small" onClick={() => setModal({ type: "playlist", mode: "create" })} title="목록 추가">
              + 목록
            </button>
          </div>
        </div>

        <div className="panel playlists">
          {state.playlists.map((pl) => (
            <div
              key={pl.id}
              className={"playlist-row" + (pl.id === selectedPlaylist.id ? " active" : "")}
              onClick={() => selectPlaylist(pl.id)}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {pl.name}
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {pl.items.length}개
                </div>
              </div>
              <span className="pill" title="아이템 개수">
                {pl.items.length}
              </span>
              <div className="row-actions">
                <button
                  className="btn small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setModal({ type: "playlist", mode: "rename", playlistId: pl.id });
                  }}
                >
                  이름
                </button>
                <button
                  className="btn small danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePlaylist(pl.id);
                  }}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
          <div className="help" style={{ padding: "10px 10px 2px" }}>
            - 모바일: 설치 후 유튜브 앱/브라우저에서 “공유 → 이 앱”으로 바로 추가 가능해요.
            <br />- 데스크톱: “북마클릿”을 만들면 유튜브 재생 중 버튼처럼 쓸 수 있어요.
          </div>
          <div style={{ display: "flex", gap: 8, padding: 10 }}>
            <button className="btn small primary" onClick={() => setModal({ type: "shareLink" })}>
              링크 공유
            </button>
            <button className="btn small" onClick={() => setModal({ type: "bookmarklet" })}>
              북마클릿
            </button>
            <button className="btn small" onClick={() => setModal({ type: "importExport" })}>
              가져오기/내보내기
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        <div className="toolbar">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 850, letterSpacing: "-0.02em", fontSize: 18 }}>{selectedPlaylist.name}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {status ? status : "검색 예: 3분 요약  #개발  #음악"}
            </div>
          </div>
          <input
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="검색 (단어 또는 #태그)"
          />
          <button className="btn primary" onClick={() => setModal({ type: "addVideo" })}>
            + 영상 추가
          </button>
        </div>

        {allTags.length ? (
          <div style={{ marginBottom: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {allTags.map(([tag, count]) => (
              <span
                key={tag}
                className="tag"
                title={`${count}개`}
                onClick={() => {
                  const token = `#${tag}`;
                  setSearchQuery((q) => (q.includes(token) ? q : (q.trim() ? `${q.trim()} ${token}` : token)));
                }}
              >
                #{tag} <span className="muted">({count})</span>
              </span>
            ))}
          </div>
        ) : null}

        {filteredItems.length === 0 ? (
          <div className="panel" style={{ padding: 16 }}>
            <div style={{ fontWeight: 750, marginBottom: 6 }}>아직 저장한 영상이 없어요</div>
            <div className="help">
              - 유튜브 영상 URL을 붙여넣거나
              <br />- 모바일에서 “공유 → 이 앱”으로 추가하거나
              <br />- 데스크톱에서는 북마클릿으로 “재생 중 추가”처럼 쓸 수 있어요.
            </div>
          </div>
        ) : (
          <div className="grid">
            {filteredItems.map((it) => (
              <VideoCard
                key={it.id}
                item={it}
                onClickTag={(tag) => {
                  const token = `#${tag.replace(/^#/, "")}`;
                  setSearchQuery((q) => (q.includes(token) ? q : (q.trim() ? `${q.trim()} ${token}` : token)));
                }}
                onEditTags={() => setModal({ type: "editTags", playlistId: selectedPlaylist.id, videoItemId: it.id })}
                onMove={() => setModal({ type: "move", fromPlaylistId: selectedPlaylist.id, videoItemId: it.id })}
                onRemove={() => setState((s) => removeVideoFromPlaylist(s, selectedPlaylist.id, it.id))}
              />
            ))}
          </div>
        )}
      </main>

      {modal?.type === "playlist" ? (
        <PlaylistModal
          mode={modal.mode}
          playlist={modal.playlistId ? state.playlists.find((p) => p.id === modal.playlistId) : undefined}
          onClose={() => setModal(null)}
          onSubmit={(name) => {
            if (modal.mode === "create") onCreatePlaylist(name);
            else if (modal.playlistId) onRenamePlaylist(modal.playlistId, name);
            setModal(null);
          }}
        />
      ) : null}

      {modal?.type === "addVideo" ? (
        <AddVideoModal
          playlists={state.playlists}
          defaultPlaylistId={selectedPlaylist.id}
          presetUrl={modal.presetUrl}
          presetTitle={modal.presetTitle}
          presetText={modal.presetText}
          onClose={() => setModal(null)}
          onSubmit={async (payload) => {
            await onAddVideo(payload);
            setModal(null);
          }}
        />
      ) : null}

      {modal?.type === "editTags" ? (
        <EditTagsModal
          playlist={state.playlists.find((p) => p.id === modal.playlistId)!}
          videoItemId={modal.videoItemId}
          onClose={() => setModal(null)}
          onSubmit={(tags) => {
            setState((s) => updateVideoInPlaylist(s, modal.playlistId, modal.videoItemId, { tags }));
            setModal(null);
          }}
        />
      ) : null}

      {modal?.type === "move" ? (
        <MoveModal
          playlists={state.playlists}
          fromPlaylistId={modal.fromPlaylistId}
          onClose={() => setModal(null)}
          onSubmit={(toPlaylistId) => {
            setState((s) => moveVideo(s, modal.fromPlaylistId, toPlaylistId, modal.videoItemId));
            setModal(null);
          }}
        />
      ) : null}

      {modal?.type === "importExport" ? (
        <ImportExportModal
          state={state}
          onClose={() => setModal(null)}
          onExport={exportJson}
          onImport={importJson}
          onCopy={() => copyToClipboard(JSON.stringify(state, null, 2))}
        />
      ) : null}

      {modal?.type === "bookmarklet" ? <BookmarkletModal onClose={() => setModal(null)} /> : null}

      {modal?.type === "shareLink" ? (
        <ShareLinkModal
          state={state}
          selectedPlaylistId={selectedPlaylist.id}
          onClose={() => setModal(null)}
          onCopy={copyToClipboard}
          onOpenImport={(encoded) => setModal({ type: "applyImport", encoded })}
        />
      ) : null}

      {modal?.type === "applyImport" ? (
        <ApplyImportModal
          encoded={modal.encoded}
          onClose={() => setModal(null)}
          onApply={(mode, imported) => {
            if (mode === "replace") {
              const fixed: StoredStateV1 = {
                version: 1,
                playlists: imported.playlists.length ? imported.playlists : state.playlists,
                selectedPlaylistId: imported.playlists[0]?.id || state.selectedPlaylistId
              };
              fixed.selectedPlaylistId = pickDefaultPlaylistId(fixed);
              setState(fixed);
              setStatus("가져오기 완료(덮어쓰기)");
              setTimeout(() => setStatus(""), 1200);
              return;
            }

            // merge: 이름 충돌 시 "(가져옴)" suffix
            const existingNames = new Set(state.playlists.map((p) => p.name.trim().toLowerCase()));
            const merged = imported.playlists.map((p) => {
              const base = p.name || "가져온 목록";
              let name = base;
              let k = name.trim().toLowerCase();
              if (existingNames.has(k)) {
                let i = 2;
                while (existingNames.has(`${k} (${i})`)) i++;
                name = `${base} (${i})`;
                k = name.trim().toLowerCase();
              }
              existingNames.add(k);
              return { ...p, name };
            });

            const next: StoredStateV1 = {
              version: 1,
              playlists: [...state.playlists, ...merged],
              selectedPlaylistId: state.selectedPlaylistId
            };
            next.selectedPlaylistId = pickDefaultPlaylistId(next);
            setState(next);
            setStatus("가져오기 완료(병합)");
            setTimeout(() => setStatus(""), 1200);
          }}
        />
      ) : null}
    </div>
  );
}

function VideoCard(props: {
  item: VideoItem;
  onEditTags: () => void;
  onMove: () => void;
  onRemove: () => void;
  onClickTag: (tag: string) => void;
}) {
  const { item } = props;
  const title = item.title || item.sourceTitle || "(제목 없음)";
  const displayTags = formatTags(item.tags);

  return (
    <div className="card">
      <div className="thumb">
        {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : <span className="muted">No image</span>}
      </div>
      <div className="card-body">
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <a className="title" href={item.url} target="_blank" rel="noreferrer noopener">
              {title}
            </a>
            <div className="meta">
              <span className="pill">{formatDateTime(item.addedAt)}</span>
              {item.videoId ? <span className="pill">ID: {item.videoId}</span> : null}
            </div>
          </div>
          <div className="row-actions">
            <button className="btn small" onClick={props.onEditTags}>
              태그
            </button>
            <button className="btn small" onClick={props.onMove}>
              이동
            </button>
            <button className="btn small danger" onClick={props.onRemove}>
              삭제
            </button>
          </div>
        </div>

        {displayTags.length ? (
          <div className="tags">
            {displayTags.map((t) => (
              <span key={t} className="tag" onClick={() => props.onClickTag(t)}>
                {t}
              </span>
            ))}
          </div>
        ) : (
          <div className="help" style={{ marginTop: 10 }}>
            태그가 없어요. <span className="kbd">태그</span> 버튼으로 추가하면 검색이 쉬워져요.
          </div>
        )}
      </div>
    </div>
  );
}

function PlaylistModal(props: {
  mode: "create" | "rename";
  playlist?: Playlist;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(props.playlist?.name || "");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <Modal
      title={props.mode === "create" ? "새 재생목록 만들기" : "재생목록 이름 바꾸기"}
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            취소
          </button>
          <button className="btn primary" onClick={() => props.onSubmit(name)}>
            저장
          </button>
        </>
      }
    >
      <div className="help">목록 이름을 입력하세요.</div>
      <input ref={inputRef} className="input" value={name} onChange={(e) => setName(e.target.value)} />
    </Modal>
  );
}

function AddVideoModal(props: {
  playlists: Playlist[];
  defaultPlaylistId: string;
  presetUrl?: string;
  presetTitle?: string;
  presetText?: string;
  onClose: () => void;
  onSubmit: (payload: { playlistId: string; url: string; tags: string[]; sourceTitle?: string }) => Promise<void>;
}) {
  const [playlistId, setPlaylistId] = useState(props.defaultPlaylistId);
  const [url, setUrl] = useState(props.presetUrl || "");
  const [tagsRaw, setTagsRaw] = useState("");
  const [busy, setBusy] = useState(false);

  const inferredTitle = props.presetTitle || "";
  const inferredUrl = props.presetUrl || extractFirstUrl(props.presetText || "") || "";

  useEffect(() => {
    if (!url && inferredUrl) setUrl(inferredUrl);
  }, [inferredUrl, url]);

  return (
    <Modal
      title="영상 추가"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose} disabled={busy}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={busy || !url.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await props.onSubmit({
                  playlistId,
                  url,
                  tags: parseTagsInput(tagsRaw),
                  sourceTitle: inferredTitle || undefined
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "추가 중…" : "추가"}
          </button>
        </>
      }
    >
      <div className="two">
        <div>
          <div className="help">저장할 재생목록</div>
          <select className="input" value={playlistId} onChange={(e) => setPlaylistId(e.target.value)}>
            {props.playlists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="help">
            태그 (쉼표로 구분) 예: <span className="kbd">개발, react, 요약</span>
          </div>
          <input className="input" value={tagsRaw} onChange={(e) => setTagsRaw(e.target.value)} placeholder="#태그도 가능" />
        </div>
      </div>
      <div className="help">유튜브 URL을 붙여넣어 주세요.</div>
      <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
      {inferredTitle ? (
        <div className="help">
          공유로 넘어온 제목: <span className="kbd">{inferredTitle}</span>
        </div>
      ) : null}
    </Modal>
  );
}

function EditTagsModal(props: {
  playlist: Playlist;
  videoItemId: string;
  onClose: () => void;
  onSubmit: (tags: string[]) => void;
}) {
  const item = props.playlist.items.find((v) => v.id === props.videoItemId)!;
  const [raw, setRaw] = useState(item.tags.join(", "));

  return (
    <Modal
      title="태그 편집"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            취소
          </button>
          <button className="btn primary" onClick={() => props.onSubmit(parseTagsInput(raw))}>
            저장
          </button>
        </>
      }
    >
      <div className="help">쉼표로 구분해서 입력하세요. 태그는 검색에서 <span className="kbd">#태그</span>로 사용할 수 있어요.</div>
      <input className="input" value={raw} onChange={(e) => setRaw(e.target.value)} />
    </Modal>
  );
}

function MoveModal(props: {
  playlists: Playlist[];
  fromPlaylistId: string;
  onClose: () => void;
  onSubmit: (toPlaylistId: string) => void;
}) {
  const [toId, setToId] = useState(
    props.playlists.find((p) => p.id !== props.fromPlaylistId)?.id || props.fromPlaylistId
  );

  return (
    <Modal
      title="다른 재생목록으로 이동"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            취소
          </button>
          <button className="btn primary" onClick={() => props.onSubmit(toId)} disabled={!toId || toId === props.fromPlaylistId}>
            이동
          </button>
        </>
      }
    >
      <div className="help">이동할 대상 재생목록을 선택하세요.</div>
      <select className="input" value={toId} onChange={(e) => setToId(e.target.value)}>
        {props.playlists
          .filter((p) => p.id !== props.fromPlaylistId)
          .map((pl) => (
            <option key={pl.id} value={pl.id}>
              {pl.name}
            </option>
          ))}
      </select>
      <div className="help">
        (참고) 같은 영상이 이미 대상 목록에 있으면 중복 추가를 막기 위해 이동이 일부 생략될 수 있어요.
      </div>
    </Modal>
  );
}

function ImportExportModal(props: {
  state: StoredStateV1;
  onClose: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
  onCopy: () => void;
}) {
  return (
    <Modal
      title="가져오기 / 내보내기"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            닫기
          </button>
        </>
      }
    >
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>내보내기</div>
        <div className="help">JSON 파일로 백업하거나, 클립보드로 복사할 수 있어요.</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button className="btn small primary" onClick={props.onExport}>
            JSON 다운로드
          </button>
          <button className="btn small" onClick={props.onCopy}>
            JSON 복사
          </button>
        </div>
      </div>
      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>가져오기</div>
        <div className="help">이전에 내보낸 JSON을 선택하면 현재 데이터를 그 내용으로 교체합니다.</div>
        <input
          className="input"
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) props.onImport(f);
            e.currentTarget.value = "";
          }}
        />
      </div>
      <div className="help">
        현재 목록 수: <span className="kbd">{props.state.playlists.length}</span>
      </div>
    </Modal>
  );
}

function BookmarkletModal(props: { onClose: () => void }) {
  const [appUrl, setAppUrl] = useState(() => window.location.origin);
  const bookmarklet = useMemo(() => buildBookmarklet(appUrl), [appUrl]);

  return (
    <Modal
      title="데스크톱용 ‘재생 중 추가’ (북마클릿)"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            닫기
          </button>
        </>
      }
    >
      <div className="help">
        브라우저 확장 없이 “유튜브 재생 중 버튼” 느낌을 내려면 **북마클릿**이 가장 현실적인 방법이에요.
        <br />
        1) 앱이 배포된 주소를 넣고
        <br />
        2) 아래 텍스트를 북마크 URL로 저장한 뒤
        <br />
        3) 유튜브 재생 중 그 북마크를 누르면, 이 앱이 새 탭으로 열리면서 URL이 자동 채워집니다.
      </div>

      <div className="help">앱 주소(배포 URL)</div>
      <input className="input" value={appUrl} onChange={(e) => setAppUrl(e.target.value)} />

      <div className="help">북마클릿 (복사해서 북마크 URL에 붙여넣기)</div>
      <textarea className="input" value={bookmarklet} readOnly rows={4} />
    </Modal>
  );
}

function ShareLinkModal(props: {
  state: StoredStateV1;
  selectedPlaylistId: string;
  onClose: () => void;
  onCopy: (text: string) => Promise<void>;
  onOpenImport: (encoded: string) => void;
}) {
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [includeThumbnails, setIncludeThumbnails] = useState(false);
  const [paste, setPaste] = useState("");

  const encoded = useMemo(() => {
    return encodeShareFromState(
      { ...props.state, selectedPlaylistId: props.selectedPlaylistId },
      { scope, includeThumbnails }
    );
  }, [props.state, props.selectedPlaylistId, scope, includeThumbnails]);

  const link = useMemo(() => {
    const base = window.location.origin + getBasePath();
    return `${base}#/import?d=${encodeURIComponent(encoded)}`;
  }, [encoded]);

  const approxLen = link.length;
  const maybeTooLong = approxLen > 6000;

  return (
    <Modal
      title="링크로 공유하기"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            닫기
          </button>
          <button className="btn primary" onClick={() => props.onCopy(link)}>
            링크 복사
          </button>
        </>
      }
    >
      <div className="help">
        이 링크에는 재생목록/태그/영상 정보가 **압축되어 그대로 포함**됩니다. 길어지면 메신저에서 잘릴 수 있어요.
        <br />
        현재 길이: <span className="kbd">{approxLen}</span>{" "}
        {maybeTooLong ? <span className="muted">(권장: JSON 내보내기 사용)</span> : null}
      </div>

      <div className="two">
        <div>
          <div className="help">공유 범위</div>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as "all" | "selected")}>
            <option value="all">전체 재생목록</option>
            <option value="selected">현재 재생목록만</option>
          </select>
        </div>
        <div>
          <div className="help">옵션</div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 0" }}>
            <input
              type="checkbox"
              checked={includeThumbnails}
              onChange={(e) => setIncludeThumbnails(e.target.checked)}
            />
            <span>썸네일까지 포함(링크가 더 길어질 수 있음)</span>
          </label>
        </div>
      </div>

      <div className="help">공유 링크</div>
      <textarea className="input" value={link} readOnly rows={3} />

      <div className="panel" style={{ padding: 12 }}>
        <div style={{ fontWeight: 800, marginBottom: 6 }}>받은 링크/페이로드로 가져오기</div>
        <div className="help">
          상대가 준 링크 전체를 붙여넣어도 되고, <span className="kbd">v1.xxxxxx</span> 형태의 페이로드만 붙여넣어도 됩니다.
        </div>
        <input className="input" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="여기에 붙여넣기" />
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button
            className="btn small primary"
            onClick={() => {
              const extracted = extractSharePayloadFromUrlOrHash(paste);
              if (!extracted) return;
              props.onOpenImport(extracted);
            }}
            disabled={!paste.trim()}
          >
            가져오기 미리보기
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ApplyImportModal(props: {
  encoded: string;
  onClose: () => void;
  onApply: (mode: "replace" | "merge", imported: StoredStateV1) => void;
}) {
  const [error, setError] = useState<string>("");
  const [imported, setImported] = useState<StoredStateV1 | null>(null);

  useEffect(() => {
    try {
      const decoded = decodeShareToState(props.encoded);
      if (!decoded.playlists.length) throw new Error("empty");
      setImported(decoded);
      setError("");
    } catch {
      setImported(null);
      setError("링크 데이터를 해석할 수 없어요(손상/버전 불일치).");
    }
  }, [props.encoded]);

  return (
    <Modal
      title="링크 가져오기"
      onClose={props.onClose}
      footer={
        <>
          <button className="btn" onClick={props.onClose}>
            취소
          </button>
          <button className="btn" disabled={!imported} onClick={() => imported && props.onApply("merge", imported)}>
            병합
          </button>
          <button className="btn primary" disabled={!imported} onClick={() => imported && props.onApply("replace", imported)}>
            덮어쓰기
          </button>
        </>
      }
    >
      {error ? <div className="help">{error}</div> : null}
      {imported ? (
        <div className="panel" style={{ padding: 12 }}>
          <div style={{ fontWeight: 850, marginBottom: 6 }}>가져올 내용</div>
          <div className="help">
            재생목록: <span className="kbd">{imported.playlists.length}</span>
            <br />
            영상 합계:{" "}
            <span className="kbd">
              {imported.playlists.reduce((sum, p) => sum + p.items.length, 0)}
            </span>
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
            {imported.playlists.slice(0, 6).map((p) => (
              <div key={p.id} className="playlist-row" style={{ cursor: "default" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.name}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {p.items.length}개
                  </div>
                </div>
              </div>
            ))}
            {imported.playlists.length > 6 ? <div className="help">…외 {imported.playlists.length - 6}개</div> : null}
          </div>
        </div>
      ) : null}
      <div className="help">
        - <span className="kbd">병합</span>: 현재 데이터는 유지하고, 가져온 재생목록을 추가합니다.
        <br />- <span className="kbd">덮어쓰기</span>: 현재 데이터를 가져온 내용으로 교체합니다.
      </div>
    </Modal>
  );
}

