"use client";

import { useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, FileText, Hash, Italic, List, ListOrdered, Mic2, Music2, Quote, Redo2, Save, StickyNote, Tag, Undo2, UserRound, X } from "lucide-react";
import { api, NamedItem, Notebook, Song } from "@/lib/api";

type Props = {
  song: Song | null; notebook: Notebook;
  catalogues: { genres: NamedItem[]; composers: NamedItem[]; artists: NamedItem[]; lyricists: NamedItem[]; tags: NamedItem[] };
  onClose: () => void; onSaved: () => void;
};
const emptyDoc = { type: "doc", content: [{ type: "paragraph" }] };
function Tool({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`tool-button ${active ? "active" : ""}`}>{children}</button>;
}

export function SongEditor({ song, notebook, catalogues, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(song?.title ?? "");
  const [notes, setNotes] = useState(song?.notes ?? "");
  const [genreIds, setGenreIds] = useState<number[]>(song?.genres?.map((x) => x.id) ?? []);
  const [composer, setComposer] = useState(song?.composers?.[0]?.name ?? "");
  const [artist, setArtist] = useState(song?.artists?.[0]?.name ?? "");
  const [revision, setRevision] = useState(song?.revision ?? 1);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const lastSaved = useRef("");
  const editor = useEditor({
    extensions: [StarterKit], content: song?.content_json ?? emptyDoc, immediatelyRender: false,
    editorProps: { attributes: { class: "song-prose" } },
    onUpdate: () => setStatus("idle"),
  });
  const payload = () => ({
    notebook_id: notebook.id, title: title.trim() || "Untitled song",
    notes,
    content_json: editor?.getJSON() ?? emptyDoc, genre_ids: genreIds,
    composer_name: composer.trim() || null, artist_name: artist.trim() || null,
    ...(song ? { revision } : {}),
  });
  async function save(close = false) {
    if (status === "saving") return;
    setStatus("saving");
    try {
      const saved = await api<Song>(song ? `/songs/${song.id}` : "/songs", { method: song ? "PATCH" : "POST", body: JSON.stringify(payload()) });
      setRevision(saved.revision);
      lastSaved.current = JSON.stringify({ ...payload(), revision: saved.revision }); setStatus("saved"); onSaved();
      if (close) onClose();
    } catch { setStatus("error"); }
  }
  useEffect(() => {
    if (!song || !editor || !title.trim()) return;
    const timer = window.setTimeout(() => {
      const current = JSON.stringify(payload());
      if (current !== lastSaved.current) void save(false);
    }, 1800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, notes, genreIds, composer, artist, editor?.getJSON()]);
  return <div className="editor-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <section className="editor-sheet">
      <header className="editor-header">
        <div className="editor-heading"><span className="modal-icon"><Music2 size={23} /></span><div><p className="eyebrow">EDIT SONG · {notebook.title}</p><h2>{title.trim() || "Untitled song"}</h2><p className={`save-state ${status}`}>{status === "saving" ? "Saving changes…" : status === "saved" ? "All changes saved" : status === "error" ? "Save failed — try again" : "Changes save automatically"}</p></div></div>
        <div className="editor-actions"><button className="button primary" onClick={() => save(true)} disabled={status === "saving"}><Save size={16} /> Save & close</button><button className="icon-button" aria-label="Close editor" onClick={onClose}><X size={20} /></button></div>
      </header>
      <div className="editor-scroll"><div className="editor-form-grid">
        <div className="editor-number-display"><span className="field-label"><Hash size={14} /> Number</span><strong>#{song?.song_number ?? "Auto"}</strong><small>Assigned automatically</small></div>
        <label><span className="field-label"><FileText size={14} /> Song title</span><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter song title" autoFocus /></label>
        <label><span className="field-label"><Tag size={14} /> Genre</span><select value={genreIds[0] ?? ""} onChange={(e) => setGenreIds(e.target.value ? [Number(e.target.value)] : [])}><option value="">None</option>{catalogues.genres.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label><span className="field-label"><UserRound size={14} /> Composer</span><input list="editor-composers" value={composer} onChange={(e) => setComposer(e.target.value)} placeholder="Type any composer name" /><datalist id="editor-composers">{catalogues.composers.map((item) => <option key={item.id} value={item.name} />)}</datalist></label>
        <label className="editor-field-wide"><span className="field-label"><Mic2 size={14} /> Song artist</span><input list="editor-artists" value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Type the singer or performing artist" /><datalist id="editor-artists">{catalogues.artists.map((item) => <option key={item.id} value={item.name} />)}</datalist></label>
        <div className="editor-field-wide"><span className="field-label"><Music2 size={14} /> Lyrics</span><div className="lyrics-editor"><div className="format-bar"><Tool active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}><Bold size={17} /></Tool><Tool active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}><Italic size={17} /></Tool><span className="tool-divider" /><Tool active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}><List size={17} /></Tool><Tool active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}><ListOrdered size={17} /></Tool><Tool active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}><Quote size={17} /></Tool><span className="tool-divider" /><Tool onClick={() => editor?.chain().focus().undo().run()}><Undo2 size={17} /></Tool><Tool onClick={() => editor?.chain().focus().redo().run()}><Redo2 size={17} /></Tool></div><EditorContent editor={editor} /></div></div>
        <label className="editor-field-wide"><span className="field-label"><StickyNote size={14} /> Private notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Key, tempo, practice notes…" /></label>
      </div></div>
    </section>
  </div>;
}
