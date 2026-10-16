"use client";

import { Hash, Mic2, Music2, Pencil, StickyNote, Tag, UserRound, X } from "lucide-react";
import { Song } from "@/lib/api";

type Props = { song: Song; onClose: () => void; onEdit: () => void };

function documentText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { type?: string; text?: string; content?: unknown[] };
  if (value.type === "text") return value.text ?? "";
  if (value.type === "hardBreak") return "\n";
  const text = (value.content ?? []).map(documentText).join("");
  return ["paragraph", "heading", "blockquote", "listItem"].includes(value.type ?? "") ? `${text}\n` : text;
}

export function SongViewer({ song, onClose, onEdit }: Props) {
  const lyrics = documentText(song.content_json).trim() || song.content_text?.trim() || "No lyrics added yet.";
  const artists = song.artists?.map((item) => item.name).join(", ") || "Unknown artist";
  const composers = song.composers?.map((item) => item.name).join(", ") || "Unknown composer";

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <article className="song-viewer">
      <header className="song-viewer-header">
        <div className="song-viewer-heading"><span className="modal-icon"><Music2 size={23} /></span><div><p className="eyebrow">SONG DETAILS</p><h2>{song.title}</h2><p>{song.notebook?.title ?? "Song notebook"}</p></div></div>
        <div className="song-viewer-actions"><button className="button primary" onClick={onEdit}><Pencil size={15} /> Edit song</button><button className="icon-button" aria-label="Close song" onClick={onClose}><X size={20} /></button></div>
      </header>
      <div className="song-viewer-body">
        <div className="song-facts">
          <span><Hash size={14} /><small>Number</small><strong>{song.song_number ?? "—"}</strong></span>
          <span><Mic2 size={14} /><small>Artist</small><strong>{artists}</strong></span>
          <span><UserRound size={14} /><small>Composer</small><strong>{composers}</strong></span>
          <span><Tag size={14} /><small>Genre</small><strong>{song.genres?.[0]?.name ?? "—"}</strong></span>
        </div>
        <section className="lyrics-preview"><div><Music2 size={14} /><span>Lyrics</span></div><p>{lyrics}</p></section>
        {song.notes && <section className="song-notes"><StickyNote size={15} /><div><strong>Private notes</strong><p>{song.notes}</p></div></section>}
      </div>
    </article>
  </div>;
}
