"use client";

import { FormEvent, useState } from "react";
import { BookOpen, FileText, Mic2, Music2, Tag, UserRound, X } from "lucide-react";
import { api, NamedItem, Notebook, Song } from "@/lib/api";

type Props = {
  notebooks: Notebook[];
  catalogues: { genres: NamedItem[]; composers: NamedItem[]; artists: NamedItem[] };
  initialNotebookId?: number;
  onClose: () => void;
  onSaved: (song: Song) => void | Promise<void>;
};

const internationalGenres = ["Pop", "Rock", "Gospel", "Folk", "Classical", "Jazz", "R&B", "Hip-Hop", "Country", "Electronic"];

function lyricsDocument(lyrics: string) {
  const lines = lyrics.replace(/\r\n/g, "\n").split("\n");
  return {
    type: "doc",
    content: lines.map((line) => ({
      type: "paragraph",
      ...(line ? { content: [{ type: "text", text: line }] } : {}),
    })),
  };
}

export function AddSongModal({ notebooks, catalogues, initialNotebookId, onClose, onSaved }: Props) {
  const [notebookId, setNotebookId] = useState(initialNotebookId ?? notebooks[0]?.id ?? 0);
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [genre, setGenre] = useState("");
  const [composer, setComposer] = useState("");
  const [artist, setArtist] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const genreOptions = Array.from(new Set([...catalogues.genres.map((item) => item.name), ...internationalGenres])).sort();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || !notebookId || saving) return;
    setSaving(true);
    setError("");
    try {
      const song = await api<Song>("/songs", {
        method: "POST",
        body: JSON.stringify({
          notebook_id: notebookId,
          title: title.trim(),
          content_json: lyricsDocument(lyrics),
          genre_name: genre.trim() || null,
          composer_name: composer.trim() || null,
          artist_name: artist.trim() || null,
        }),
      });
      await onSaved(song);
    } catch (exception) {
      setError(exception instanceof Error ? exception.message : "Song save theih lo. Try again rawh.");
      setSaving(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !saving && onClose()}>
    <form className="modal add-song-modal" onSubmit={submit}>
      <button className="modal-x" type="button" aria-label="Close" disabled={saving} onClick={onClose}><X size={19} /></button>
      <header className="add-song-heading">
        <span className="modal-icon"><Music2 size={23} /></span>
        <div><p className="eyebrow">NEW ENTRY</p><h2>Add a song</h2><p>Capture the song details and lyrics in one place.</p></div>
      </header>

      {error && <div className="form-error" role="alert">{error}</div>}

      <div className="song-form-grid">
        <label className="field-wide"><span className="field-label"><BookOpen size={14} /> Notebook</span>
          <select value={notebookId} onChange={(event) => setNotebookId(Number(event.target.value))} aria-label="Notebook">
            {notebooks.map((notebook) => <option key={notebook.id} value={notebook.id}>{notebook.title}</option>)}
          </select>
        </label>
        <label className="field-wide"><span className="field-label"><FileText size={14} /> Song title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Enter song title" autoFocus required />
        </label>
        <label><span className="field-label"><Tag size={14} /> Genre <em>Optional</em></span>
          <input list="song-genres" value={genre} onChange={(event) => setGenre(event.target.value)} placeholder="e.g. Gospel, Pop, Folk" />
          <datalist id="song-genres">{genreOptions.map((name) => <option key={name} value={name} />)}</datalist>
        </label>
        <label><span className="field-label"><UserRound size={14} /> Composer <em>Optional</em></span>
          <input list="song-composers" value={composer} onChange={(event) => setComposer(event.target.value)} placeholder="Type any composer name" />
          <datalist id="song-composers">{catalogues.composers.map((item) => <option key={item.id} value={item.name} />)}</datalist>
        </label>
        <label className="field-wide"><span className="field-label"><Mic2 size={14} /> Song artist <em>Optional</em></span>
          <input list="song-artists" value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Type the singer or performing artist" />
          <datalist id="song-artists">{catalogues.artists.map((item) => <option key={item.id} value={item.name} />)}</datalist>
        </label>
        <label className="field-wide"><span className="field-label"><Music2 size={14} /> Lyrics <em>Optional</em></span>
          <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} placeholder="Type or paste the lyrics here…" />
        </label>
      </div>

      <div className="modal-actions">
        <button className="button secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button>
        <button className="button primary" type="submit" disabled={saving || !title.trim()}>{saving ? "Adding…" : "Add song"}</button>
      </div>
    </form>
  </div>;
}
