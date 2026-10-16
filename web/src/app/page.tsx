"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, BookHeart, BookOpen, ChevronLeft, ChevronRight, FileText, Heart, Home, Library, LogOut, Mail, Menu, MoreHorizontal, Music2, Pencil, Plus, Search, Settings, ShieldCheck, Shuffle, Trash2, UserRound, X } from "lucide-react";
import { api, NamedItem, Notebook, Song } from "@/lib/api";
import { SongEditor } from "@/components/song-editor";
import { AddSongModal } from "@/components/add-song-modal";
import { SongViewer } from "@/components/song-viewer";

type View = "home" | "all" | "songs" | "favorites" | "trash" | "notebook" | "settings";
type User = { id: number; name: string; email: string };
type Dashboard = { counts: { notebooks: number; songs: number; favorites: number }; recent: Song[]; favorites: Song[] };
type Catalogues = { genres: NamedItem[]; composers: NamedItem[]; artists: NamedItem[]; lyricists: NamedItem[]; tags: NamedItem[] };
const emptyCatalogues: Catalogues = { genres: [], composers: [], artists: [], lyricists: [], tags: [] };

export default function HomePage() {
  const [view, setView] = useState<View>("home");
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [allSongs, setAllSongs] = useState<Song[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>({ counts: { notebooks: 0, songs: 0, favorites: 0 }, recent: [], favorites: [] });
  const [catalogues, setCatalogues] = useState<Catalogues>(emptyCatalogues);
  const [selected, setSelected] = useState<Notebook | null>(null);
  const [editing, setEditing] = useState<Song | "new" | null>(null);
  const [viewing, setViewing] = useState<Song | null>(null);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [editingNotebook, setEditingNotebook] = useState<Notebook | null>(null);
  const [addingSong, setAddingSong] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [accountMenu, setAccountMenu] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [bookData, songData, dashData, catalogueData] = await Promise.all([api<Notebook[]>("/notebooks"), api<Song[]>("/songs"), api<Dashboard>("/dashboard"), api<Catalogues>("/catalogues")]);
      setNotebooks(bookData); setAllSongs(songData); setDashboard(dashData); setCatalogues(catalogueData); setError("");
      if (selected) setSelected(await api<Notebook>(`/notebooks/${selected.id}`));
    } catch { setError("API connect theih lo. Laravel server start rawh."); }
    finally { setLoading(false); }
  }, [selected]);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (!window.localStorage.getItem("hla_bu_token")) return setAuthenticated(false);
      try { setUser(await api<User>("/me")); setAuthenticated(true); await refresh(); }
      catch { window.localStorage.removeItem("hla_bu_token"); setAuthenticated(false); setLoading(false); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      if (!search.trim()) return setSearchResults([]);
      try { setSearchResults(await api<Song[]>(`/songs?q=${encodeURIComponent(search.trim())}`)); } catch {}
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function openNotebook(book: Notebook) {
    setLoading(true); setSidebar(false);
    try { setSelected(await api<Notebook>(`/notebooks/${book.id}`)); setView("notebook"); }
    finally { setLoading(false); }
  }
  async function createNotebook() {
    if (!newTitle.trim()) return;
    const book = await api<Notebook>("/notebooks", { method: "POST", body: JSON.stringify({ title: newTitle.trim() }) });
    setNewTitle(""); setShowNewNotebook(false); await refresh(); await openNotebook(book);
  }
  async function toggleFavorite(song: Song) {
    await api(`/songs/${song.id}`, { method: "PATCH", body: JSON.stringify({ is_favorite: !song.is_favorite, revision: song.revision }) }); await refresh();
  }
  async function trashSong(song: Song) {
    if (!window.confirm(`Move “${song.title}” to trash?`)) return;
    await api(`/songs/${song.id}`, { method: "DELETE" }); await refresh();
  }
  async function editSong(song: Song) {
    const book = await api<Notebook>(`/notebooks/${song.notebook_id}`);
    setSelected(book); setViewing(null); setEditing(song);
  }
  function startAddingSong() {
    if (!notebooks.length) return setShowNewNotebook(true);
    setAddingSong(true);
  }

  const favoriteSongs = useMemo(() => dashboard.favorites, [dashboard]);
  const pageTitle = view === "home" ? "Good evening" : view === "all" ? "All notebooks" : view === "songs" ? "All songs" : view === "favorites" ? "Favourites" : view === "trash" ? "Trash" : view === "settings" ? "Settings" : selected?.title ?? "Notebook";

  function openSettings() { setView("settings"); setSidebar(false); setAccountMenu(false); }
  async function signOut() {
    setSigningOut(true);
    try { await api("/logout", { method: "POST" }); } catch {}
    finally { window.localStorage.removeItem("hla_bu_token"); setUser(null); setAuthenticated(false); setShowSignOut(false); setSigningOut(false); }
  }

  if (authenticated === null) return <div className="splash"><span className="brand-mark"><Music2 size={22} /></span><p>Opening your notebook…</p></div>;
  if (!authenticated) return <LoginView onLogin={async (email, password) => {
    const result = await api<{ token: string; user: User }>("/login", { method: "POST", body: JSON.stringify({ email, password }) });
    window.localStorage.setItem("hla_bu_token", result.token); setUser(result.user); setAuthenticated(true); setLoading(true); await refresh();
  }} />;

  return <main className="app-shell">
    <aside className={`sidebar ${sidebar ? "open" : ""}`}>
      <div className="brand"><span className="brand-mark"><Music2 size={19} /></span><span>Gunendra Song Notebook</span><button className="mobile-close" onClick={() => setSidebar(false)}><X size={20} /></button></div>
      <nav className="main-nav">
        <NavItem icon={<Home size={18} />} label="Home" active={view === "home"} onClick={() => { setView("home"); setSidebar(false); }} />
        <NavItem icon={<Music2 size={18} />} label="All songs" active={view === "songs"} count={dashboard.counts.songs} onClick={() => { setView("songs"); setSidebar(false); }} />
        <NavItem icon={<Library size={18} />} label="All notebooks" active={view === "all"} count={dashboard.counts.notebooks} onClick={() => { setView("all"); setSidebar(false); }} />
        <NavItem icon={<Heart size={18} />} label="Favourites" active={view === "favorites"} count={dashboard.counts.favorites} onClick={() => { setView("favorites"); setSidebar(false); }} />
      </nav>
      <div className="nav-section-head"><span>YOUR NOTEBOOKS</span><button onClick={() => setShowNewNotebook(true)} aria-label="New notebook"><Plus size={16} /></button></div>
      <nav className="notebook-nav">{notebooks.map((book) => <NavItem key={book.id} icon={<span className="book-dot" style={{ background: book.cover_color }} />} label={book.title} active={view === "notebook" && selected?.id === book.id} onClick={() => openNotebook(book)} />)}</nav>
      <nav className="bottom-nav"><NavItem icon={<Trash2 size={18} />} label="Trash" active={view === "trash"} onClick={() => { setView("trash"); setSidebar(false); }} /><NavItem icon={<Settings size={18} />} label="Settings" active={view === "settings"} onClick={openSettings} /></nav>
      <div className="owner-card-wrap">
        {accountMenu && <div className="account-menu"><button onClick={openSettings}><Settings size={15} /> Settings</button><button className="sign-out-item" onClick={() => { setAccountMenu(false); setShowSignOut(true); }}><LogOut size={15} /> Sign out</button></div>}
        <div className="owner-card"><span className="avatar">{initials(user?.name)}</span><div><strong>{user?.name ?? "Account"}</strong><small>{user?.email ?? "Private library"}</small></div><button aria-label="Open account menu" title="Account menu" aria-expanded={accountMenu} onClick={() => setAccountMenu((open) => !open)}><MoreHorizontal size={18} /></button></div>
      </div>
    </aside>
    {sidebar && <button className="sidebar-scrim" onClick={() => setSidebar(false)} aria-label="Close menu" />}

    <section className="workspace">
      <header className="topbar"><button className="menu-button" onClick={() => setSidebar(true)}><Menu size={21} /></button><div className={`search-box ${search ? "searching" : ""}`}><Search size={18} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search songs, lyrics, composers…" /><kbd>⌘ K</kbd></div><button className="button primary" onClick={startAddingSong}><Plus size={17} />{notebooks.length ? "Add song" : "New notebook"}</button></header>
      {search && <SearchPanel results={searchResults} query={search} onOpen={(song) => { setViewing(song); setSearch(""); }} />}
      <div className="content">
        <div className="page-heading"><div><p className="eyebrow">{view === "home" ? "GUNENDRA SONG NOTEBOOK" : view.toUpperCase()}</p><h1>{pageTitle}</h1>{view === "home" && <p>Pick up where you left off, or begin a new song.</p>}</div>{view === "notebook" && selected && <div className="page-heading-actions"><button className="button secondary" onClick={() => setEditingNotebook(selected)}><Pencil size={15} /> Edit notebook</button><button className="button primary" onClick={startAddingSong}><Plus size={17} /> Add song</button></div>}</div>
        {error && <div className="error-banner"><span>{error}</span><code>cd api && php artisan serve</code></div>}
        {loading ? <Loading /> : view === "home" ? <HomeView notebooks={notebooks} recent={dashboard.recent} onAll={() => setView("all")} onNotebook={openNotebook} onSong={setViewing} /> : view === "all" ? <NotebookGrid notebooks={notebooks} onOpen={openNotebook} add={() => setShowNewNotebook(true)} /> : view === "songs" ? <SongList songs={allSongs} empty="No songs yet." showNotebook onOpen={setViewing} onFavorite={toggleFavorite} onTrash={trashSong} /> : view === "favorites" ? <SongList songs={favoriteSongs} empty="No favourite songs yet." onOpen={setViewing} onFavorite={toggleFavorite} onTrash={trashSong} /> : view === "trash" ? <TrashView onChanged={refresh} /> : view === "settings" && user ? <SettingsView user={user} onUpdated={setUser} onSignOut={() => setShowSignOut(true)} /> : selected ? <NotebookView notebook={selected} onAdd={startAddingSong} onOpen={setViewing} onFavorite={toggleFavorite} onTrash={trashSong} /> : null}
      </div>
    </section>

    {viewing && <SongViewer song={viewing} onClose={() => setViewing(null)} onEdit={() => void editSong(viewing)} />}
    {editing && selected && <SongEditor song={editing === "new" ? null : editing} notebook={selected} catalogues={catalogues} onClose={() => setEditing(null)} onSaved={refresh} />}
    {addingSong && <AddSongModal notebooks={notebooks} catalogues={catalogues} initialNotebookId={view === "notebook" ? selected?.id : undefined} onClose={() => setAddingSong(false)} onSaved={async (song) => { setAddingSong(false); await refresh(); if (view === "notebook" && selected?.id !== song.notebook_id) await openNotebook(notebooks.find((book) => book.id === song.notebook_id) ?? notebooks[0]); }} />}
    {editingNotebook && <NotebookEditorModal notebook={editingNotebook} onClose={() => setEditingNotebook(null)} onSaved={async (book) => { setEditingNotebook(null); setSelected(book); await refresh(); }} />}
    {showNewNotebook && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowNewNotebook(false)}><form className="modal" onSubmit={(e) => { e.preventDefault(); void createNotebook(); }}><button className="modal-x" type="button" onClick={() => setShowNewNotebook(false)}><X size={19} /></button><span className="modal-icon"><BookOpen size={22} /></span><h2>New notebook</h2><p>Create a home for a collection of songs.</p><label>Notebook name<input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Lengzem Hlate" autoFocus /></label><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setShowNewNotebook(false)}>Cancel</button><button className="button primary" type="submit">Create notebook</button></div></form></div>}
    {showSignOut && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !signingOut && setShowSignOut(false)}><div className="modal sign-out-modal" role="dialog" aria-modal="true" aria-labelledby="sign-out-title"><button className="modal-x" type="button" disabled={signingOut} onClick={() => setShowSignOut(false)}><X size={19} /></button><span className="modal-icon"><LogOut size={21} /></span><h2 id="sign-out-title">Sign out?</h2><p>You’ll need to sign in again to open your private song library.</p><div className="modal-actions"><button className="button secondary" type="button" disabled={signingOut} onClick={() => setShowSignOut(false)}>Cancel</button><button className="button danger" type="button" disabled={signingOut} onClick={() => void signOut()}>{signingOut ? "Signing out…" : "Sign out"}</button></div></div></div>}
  </main>;
}

function initials(name?: string) { return (name || "A").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }

function NotebookEditorModal({ notebook, onClose, onSaved }: { notebook: Notebook; onClose: () => void; onSaved: (notebook: Notebook) => Promise<void> }) {
  const [title, setTitle] = useState(notebook.title); const [description, setDescription] = useState(notebook.description ?? ""); const [coverColor, setCoverColor] = useState(notebook.cover_color);
  const [saving, setSaving] = useState(false); const [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!title.trim()) return;
    setSaving(true); setError("");
    try { const updated = await api<Notebook>(`/notebooks/${notebook.id}`, { method: "PATCH", body: JSON.stringify({ title: title.trim(), description: description.trim() || null, cover_color: coverColor }) }); await onSaved(updated); }
    catch (exception) { setError(exception instanceof Error ? exception.message : "Could not update notebook."); setSaving(false); }
  }
  return <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}><form className="modal notebook-edit-modal" onSubmit={(e) => void save(e)}><button className="modal-x" type="button" disabled={saving} onClick={onClose}><X size={19} /></button><span className="modal-icon" style={{ background: coverColor, color: "white" }}><BookOpen size={22} /></span><h2>Edit notebook</h2><p>Update this notebook’s name, description and cover colour.</p>{error && <div className="form-error">{error}</div>}<div className="notebook-edit-fields"><label>Notebook name<input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required autoFocus /></label><label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="What belongs in this notebook?" /></label><label>Cover colour<span className="color-field"><input type="color" value={coverColor} onChange={(e) => setCoverColor(e.target.value)} /><code>{coverColor.toUpperCase()}</code></span></label></div><div className="modal-actions"><button className="button secondary" type="button" disabled={saving} onClick={onClose}>Cancel</button><button className="button primary" disabled={saving || !title.trim()}>{saving ? "Saving…" : "Save changes"}</button></div></form></div>;
}

function SettingsView({ user, onUpdated, onSignOut }: { user: User; onUpdated: (user: User) => void; onSignOut: () => void }) {
  const [name, setName] = useState(user.name); const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState(""); const [newPassword, setNewPassword] = useState(""); const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false); const [savingPassword, setSavingPassword] = useState(false);
  const [profileMessage, setProfileMessage] = useState(""); const [passwordMessage, setPasswordMessage] = useState("");
  async function saveProfile(e: React.FormEvent) { e.preventDefault(); setSavingProfile(true); setProfileMessage(""); try { const updated = await api<User>("/me", { method: "PATCH", body: JSON.stringify({ name, email }) }); onUpdated(updated); setProfileMessage("Account details saved."); } catch (exception) { setProfileMessage(exception instanceof Error ? exception.message : "Could not save changes."); } finally { setSavingProfile(false); } }
  async function savePassword(e: React.FormEvent) { e.preventDefault(); setPasswordMessage(""); if (newPassword !== confirmPassword) return setPasswordMessage("The new passwords do not match."); setSavingPassword(true); try { await api<User>("/me", { method: "PATCH", body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setPasswordMessage("Password updated."); } catch (exception) { setPasswordMessage(exception instanceof Error ? exception.message : "Could not update password."); } finally { setSavingPassword(false); } }
  return <div className="settings-grid">
    <form className="settings-card" onSubmit={(e) => void saveProfile(e)}><div className="settings-card-head"><span><UserRound size={19} /></span><div><h2>Account details</h2><p>The name and email shown in your private library.</p></div></div><div className="settings-fields"><label>Name<input value={name} onChange={(e) => setName(e.target.value)} required maxLength={150} /></label><label>Email address<span className="input-with-icon"><Mail size={16} /><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={191} /></span></label></div>{profileMessage && <p className="settings-message">{profileMessage}</p>}<div className="settings-actions"><button className="button primary" disabled={savingProfile || !name.trim() || !email.trim()}>{savingProfile ? "Saving…" : "Save changes"}</button></div></form>
    <form className="settings-card" onSubmit={(e) => void savePassword(e)}><div className="settings-card-head"><span><ShieldCheck size={19} /></span><div><h2>Password</h2><p>Use at least 8 characters for your new password.</p></div></div><div className="settings-fields"><label>Current password<input type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label><label>New password<input type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={8} required /></label><label>Confirm new password<input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={8} required /></label></div>{passwordMessage && <p className="settings-message">{passwordMessage}</p>}<div className="settings-actions"><button className="button primary" disabled={savingPassword}>{savingPassword ? "Updating…" : "Update password"}</button></div></form>
    <section className="settings-card session-card"><div className="settings-card-head"><span><LogOut size={19} /></span><div><h2>Current session</h2><p>Sign out safely on this device.</p></div></div><button className="button danger outlined" onClick={onSignOut}><LogOut size={16} /> Sign out</button></section>
  </div>;
}

function NavItem({ icon, label, active, count, onClick }: { icon: React.ReactNode; label: string; active?: boolean; count?: number; onClick: () => void }) { return <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span>{count !== undefined && <em>{count}</em>}</button>; }
function HomeView({ notebooks, recent, onAll, onNotebook, onSong }: { notebooks: Notebook[]; recent: Song[]; onAll: () => void; onNotebook: (b: Notebook) => void; onSong: (s: Song) => void }) { return <><section className="section"><div className="section-title"><div><h2>Your notebooks</h2><p>{notebooks.length} collections · {notebooks.reduce((n, b) => n + (b.songs_count ?? 0), 0)} songs</p></div><button onClick={onAll}>View all <ChevronRight size={15} /></button></div><NotebookGrid notebooks={notebooks.slice(0, 4)} onOpen={onNotebook} /></section><section className="section recent-section"><div className="section-title"><div><h2>Recently edited</h2><p>Continue writing and refining your songs.</p></div></div><div className="recent-cards">{recent.slice(0, 4).map((song) => <button className="recent-card" key={song.id} onClick={() => onSong(song)}><span className="song-number">{song.song_number ?? "—"}</span><div><strong>{song.title}</strong><small>{song.artists?.[0]?.name || song.notebook?.title || "Unknown artist"} · {relativeTime(song.updated_at)}</small><p>{song.content_text || "No lyrics yet"}</p></div><FileText size={18} /></button>)}</div></section></>; }
function NotebookGrid({ notebooks, onOpen, add }: { notebooks: Notebook[]; onOpen: (b: Notebook) => void; add?: () => void }) { return <div className="notebook-grid">{notebooks.map((book) => <button key={book.id} className="notebook-card" onClick={() => onOpen(book)}><span className="notebook-cover" style={{ "--cover": book.cover_color } as React.CSSProperties}><span className="cover-line" /><BookHeart size={24} /><small>PERSONAL COLLECTION</small><strong>{book.title}</strong></span><span className="notebook-meta"><strong>{book.title}</strong><small>{book.songs_count ?? 0} songs</small></span></button>)}{add && <button className="add-notebook-card" onClick={add}><Plus size={25} /><strong>New notebook</strong><small>Start a new collection</small></button>}</div>; }
function NotebookView({ notebook, onAdd, onOpen, onFavorite, onTrash }: { notebook: Notebook; onAdd: () => void; onOpen: (s: Song) => void; onFavorite: (s: Song) => void; onTrash: (s: Song) => void }) { if (!notebook.songs?.length) return <><div className="notebook-hero"><span className="mini-cover" style={{ background: notebook.cover_color }}><Music2 /></span><div><p>{notebook.description || "A personal collection of songs."}</p><small>0 songs</small></div></div><div className="empty-state"><Music2 size={30} /><h3>This notebook has no songs yet.</h3><p>Add your first song in a few simple steps.</p><button className="button primary" onClick={onAdd}><Plus size={17} /> Add first song</button></div></>; return <><div className="notebook-hero"><span className="mini-cover" style={{ background: notebook.cover_color }}><Music2 /></span><div><p>{notebook.description || "A personal collection of songs."}</p><small>{notebook.songs.length} songs</small></div></div><SongList songs={notebook.songs} empty="This notebook has no songs yet." onOpen={onOpen} onFavorite={onFavorite} onTrash={onTrash} /></>; }
function SongList({ songs, empty, showNotebook = false, onOpen, onFavorite, onTrash }: { songs: Song[]; empty: string; showNotebook?: boolean; onOpen: (s: Song) => void; onFavorite: (s: Song) => void; onTrash: (s: Song) => void }) {
  const pageSize = 10;
  const songKey = songs.map((song) => song.id).join(",");
  const [shuffle, setShuffle] = useState<{ songKey: string; ids: number[] } | null>(null);
  const [pagination, setPagination] = useState<{ songKey: string; page: number } | null>(null);
  const shuffled = shuffle?.songKey === songKey ? shuffle : null;
  const displayedSongs = useMemo(() => {
    if (!shuffled) return songs;
    const byId = new Map(songs.map((song) => [song.id, song]));
    return shuffled.ids.flatMap((id) => {
      const song = byId.get(id);
      return song ? [song] : [];
    });
  }, [songs, shuffled]);
  const pageCount = Math.max(1, Math.ceil(displayedSongs.length / pageSize));
  const currentPage = pagination?.songKey === songKey ? Math.min(pagination.page, pageCount) : 1;
  const pageStart = (currentPage - 1) * pageSize;
  const pageSongs = displayedSongs.slice(pageStart, pageStart + pageSize);

  function goToPage(page: number) {
    setPagination({ songKey, page: Math.min(Math.max(page, 1), pageCount) });
  }

  function shuffleSongs() {
    const ids = songs.map((song) => song.id);
    const currentIds = displayedSongs.map((song) => song.id);
    for (let index = ids.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [ids[index], ids[randomIndex]] = [ids[randomIndex], ids[index]];
    }
    if (ids.length > 1 && ids.every((id, index) => id === currentIds[index])) {
      ids.push(ids.shift() as number);
    }
    setShuffle({ songKey, ids });
    setPagination({ songKey, page: 1 });
  }

  if (!songs.length) return <div className="empty-state"><Music2 size={30} /><h3>{empty}</h3><p>Add a song to begin writing.</p></div>;
  return <div className="song-list">
    <div className="song-list-tools">
      <span>{pageStart + 1}–{Math.min(pageStart + pageSize, songs.length)} of {songs.length} {songs.length === 1 ? "song" : "songs"}{shuffled ? " · Shuffled" : ""}</span>
      <div>
        {shuffled && <button className="song-order-reset" onClick={() => { setShuffle(null); setPagination({ songKey, page: 1 }); }}>Original order</button>}
        <button className="button secondary shuffle-button" onClick={shuffleSongs}><Shuffle size={15} />{shuffled ? "Shuffle again" : "Shuffle"}</button>
      </div>
    </div>
    <div className="song-table"><div className="song-table-head"><span>#</span><span>Title</span><span>Artist</span><span>Genre</span><span>Updated</span><span /></div>{pageSongs.map((song) => {
      const composer = song.composers?.map((item) => item.name).join(", ") || "Composer unknown";
      const subtitle = showNotebook ? `${song.notebook?.title || "Notebook unknown"} · ${composer}` : composer;
      return <div className="song-row" key={song.id} onClick={() => onOpen(song)}><span>{song.song_number ?? "—"}</span><span><strong>{song.title}</strong><small title={subtitle}>{subtitle}</small></span><span className="song-artist">{song.artists?.map((x) => x.name).join(", ") || "—"}</span><span>{song.genres?.[0]?.name || "—"}</span><span>{relativeTime(song.updated_at)}</span><span className="row-actions"><button onClick={(e) => { e.stopPropagation(); void onFavorite(song); }} aria-label="Favourite"><Heart size={17} fill={song.is_favorite ? "currentColor" : "none"} /></button><button onClick={(e) => { e.stopPropagation(); void onTrash(song); }} aria-label="Move to trash"><Trash2 size={17} /></button></span></div>;
    })}</div>
    {pageCount > 1 && <nav className="song-pagination" aria-label="Song list pages">
      <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1}><ChevronLeft size={15} /> Previous</button>
      <span aria-live="polite">Page <strong>{currentPage}</strong> of {pageCount}</span>
      <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === pageCount}>Next <ChevronRight size={15} /></button>
    </nav>}
  </div>;
}
function SearchPanel({ results, query, onOpen }: { results: Song[]; query: string; onOpen: (s: Song) => void }) { return <div className="search-panel"><p>{results.length ? `${results.length} results for “${query}”` : `No results for “${query}”`}</p>{results.map((song) => <button key={song.id} onClick={() => onOpen(song)}><Search size={16} /><span><strong>{song.title}</strong><small>{song.notebook?.title}</small></span><ChevronRight size={16} /></button>)}</div>; }
function TrashView({ onChanged }: { onChanged: () => void }) { const [items, setItems] = useState<{ notebooks: Notebook[]; songs: Song[] }>({ notebooks: [], songs: [] }); useEffect(() => { api<typeof items>("/trash").then(setItems); }, []); async function restore(type: "notebook" | "song", id: number) { await api("/trash/restore", { method: "POST", body: JSON.stringify({ type, id }) }); setItems(await api("/trash")); onChanged(); } const total = items.notebooks.length + items.songs.length; return <div className="trash-list">{!total ? <div className="empty-state"><Archive size={30} /><h3>Trash is empty</h3><p>Deleted notebooks and songs will appear here.</p></div> : <>{items.notebooks.map((x) => <div key={`n${x.id}`}><BookOpen size={18} /><span><strong>{x.title}</strong><small>Notebook</small></span><button onClick={() => restore("notebook", x.id)}>Restore</button></div>)}{items.songs.map((x) => <div key={`s${x.id}`}><Music2 size={18} /><span><strong>{x.title}</strong><small>Song</small></span><button onClick={() => restore("song", x.id)}>Restore</button></div>)}</>}</div>; }
function Loading() { return <div className="loading"><span /><span /><span /></div>; }
function relativeTime(value: string) { const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000); return days < 1 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`; }

function LoginView({ onLogin }: { onLogin: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState("owner@example.com"); const [password, setPassword] = useState("change-me"); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <main className="login-page"><section className="login-intro"><div className="login-brand"><span className="brand-mark"><Music2 size={20} /></span> Gunendra Song Notebook</div><div><p className="eyebrow">GUNENDRA SONG NOTEBOOK</p><h1>Every song has<br />a place to belong.</h1><p>Write, organise and preserve your songs in one calm, private notebook.</p></div><blockquote>“Music is the shorthand of emotion.”<small>— Leo Tolstoy</small></blockquote></section><section className="login-form-wrap"><form className="login-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(""); try { await onLogin(email, password); } catch { setError("Email emaw password emaw a dik lo."); setBusy(false); } }}><span className="login-note"><BookOpen size={23} /></span><h2>Welcome back</h2><p>Sign in to open Gunendra Song Notebook.</p>{error && <div className="login-error">{error}</div>}<label>Email address<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="button primary" disabled={busy}>{busy ? "Opening…" : "Open notebook"}</button><small className="demo-hint">Demo: owner@example.com · change-me</small></form></section></main>;
}
