import { NextRequest } from "next/server";
import { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getDb, isAuthorized, issueToken, passwordHash, plainText, SqlExecutor, tokenHash, verifyPassword, withTransaction } from "@/lib/server/database";

type Context = { params: Promise<{ path: string[] }> };
type JsonObject = Record<string, unknown>;
type DbSong = RowDataPacket & { id: number; notebook_id: number; content_json: unknown; is_favorite: number };
type DbNotebook = RowDataPacket & { id: number; is_favorite: number };
type SqlValue = string | number | boolean | Date | Buffer | null;

function json(data: unknown, status = 200) { return Response.json(data, { status }); }
function error(message: string, status = 422, errors?: Record<string, string[]>) { return json({ message, ...(errors ? { errors } : {}) }, status); }
function numberId(value: string | null | undefined) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }
function parseJson(value: unknown) { if (typeof value !== "string") return value; try { return JSON.parse(value); } catch { return null; } }
function duplicateError(exception: unknown) { return (exception as { code?: string }).code === "ER_DUP_ENTRY"; }
function sqlValue(value: unknown): SqlValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value instanceof Date || Buffer.isBuffer(value)) return value;
  return null;
}

async function named(executor: SqlExecutor, table: string, songId: number) {
  const singular = table === "genres" ? "genre" : table === "composers" ? "composer" : table === "artists" ? "artist" : table === "lyricists" ? "lyricist" : "tag";
  const [rows] = await executor.execute<RowDataPacket[]>(`SELECT m.id, m.name${table === "tags" ? ", m.color" : ""} FROM ${table} m JOIN song_${singular} p ON p.${singular}_id = m.id WHERE p.song_id = ? ORDER BY m.name`, [songId]);
  return rows;
}

async function songRow(executor: SqlExecutor, row: DbSong | undefined, includeVersions = false) {
  if (!row) return null;
  const [[notebookRows], genres, composers, artists, lyricists, tags] = await Promise.all([
    executor.execute<RowDataPacket[]>("SELECT id, title, cover_color FROM notebooks WHERE id = ?", [row.notebook_id]),
    named(executor, "genres", row.id), named(executor, "composers", row.id),
    named(executor, "artists", row.id), named(executor, "lyricists", row.id), named(executor, "tags", row.id),
  ]);
  let versions: RowDataPacket[] | undefined;
  if (includeVersions) [versions] = await executor.execute<RowDataPacket[]>("SELECT * FROM song_versions WHERE song_id = ? ORDER BY version_number DESC", [row.id]);
  return { ...row, content_json: parseJson(row.content_json), is_favorite: Boolean(row.is_favorite), notebook: notebookRows[0], genres, composers, artists, lyricists, tags, ...(versions ? { versions } : {}) };
}

async function getSong(executor: SqlExecutor, id: number, includeDeleted = false, includeVersions = false) {
  const [rows] = await executor.execute<DbSong[]>(`SELECT * FROM songs WHERE id = ?${includeDeleted ? "" : " AND deleted_at IS NULL"}`, [id]);
  return songRow(executor, rows[0], includeVersions);
}

async function songList(executor: SqlExecutor, where = "s.deleted_at IS NULL", values: SqlValue[] = []) {
  const [rows] = await executor.execute<DbSong[]>(`SELECT s.* FROM songs s WHERE ${where} ORDER BY s.sort_order, s.song_number, s.id`, values);
  return Promise.all(rows.map((row) => songRow(executor, row)));
}

async function notebookRow(executor: SqlExecutor, row: DbNotebook, includeSongs = false) {
  return { ...row, is_favorite: Boolean(row.is_favorite), ...(includeSongs ? { songs: await songList(executor, "s.notebook_id = ? AND s.deleted_at IS NULL", [row.id]) } : {}) };
}

async function syncRelations(executor: SqlExecutor, songId: number, body: JsonObject) {
  const relations = { genre_ids: "genre", composer_ids: "composer", artist_ids: "artist", lyricist_ids: "lyricist", tag_ids: "tag" } as const;
  for (const [key, singular] of Object.entries(relations)) {
    const nameKey = `${singular}_name`;
    const customName = typeof body[nameKey] === "string" ? body[nameKey].trim().slice(0, singular === "genre" ? 100 : 200) : "";
    if (!Array.isArray(body[key]) && !(nameKey in body)) continue;
    await executor.execute(`DELETE FROM song_${singular} WHERE song_id = ?`, [songId]);
    if (Array.isArray(body[key])) for (const relationId of body[key] as unknown[]) if (Number.isInteger(relationId)) await executor.execute(`INSERT IGNORE INTO song_${singular} (song_id, ${singular}_id) VALUES (?, ?)`, [songId, Number(relationId)]);
    if (customName) {
      const table = singular === "genre" ? "genres" : `${singular}s`;
      await executor.execute(`INSERT IGNORE INTO ${table} (name) VALUES (?)`, [customName]);
      const [rows] = await executor.execute<RowDataPacket[]>(`SELECT id FROM ${table} WHERE name = ?`, [customName]);
      if (rows[0]) await executor.execute(`INSERT IGNORE INTO song_${singular} (song_id, ${singular}_id) VALUES (?, ?)`, [songId, rows[0].id]);
    }
  }
}

function songPayloadErrors(body: JsonObject, creating: boolean) {
  const errors: Record<string, string[]> = {};
  if (creating && (!Number.isInteger(body.notebook_id) || Number(body.notebook_id) < 1)) errors.notebook_id = ["A valid notebook is required."];
  if ((creating || "title" in body) && (typeof body.title !== "string" || !body.title.trim())) errors.title = ["The title field is required."];
  if (body.song_number !== null && body.song_number !== undefined && (!Number.isInteger(body.song_number) || Number(body.song_number) < 1)) errors.song_number = ["Song number must be a positive integer."];
  return errors;
}

async function loginAllowed(executor: SqlExecutor, key: string) {
  const currentTime = Date.now();
  const [rows] = await executor.execute<RowDataPacket[]>("SELECT attempts, window_started_at FROM login_attempts WHERE attempt_key = ?", [key]);
  const record = rows[0];
  if (!record || currentTime - Number(record.window_started_at) > 60_000) {
    await executor.execute("INSERT INTO login_attempts (attempt_key, attempts, window_started_at) VALUES (?, 1, ?) ON DUPLICATE KEY UPDATE attempts = 1, window_started_at = ?", [key, currentTime, currentTime]);
    return true;
  }
  await executor.execute("UPDATE login_attempts SET attempts = attempts + 1 WHERE attempt_key = ?", [key]);
  return Number(record.attempts) < 5;
}

async function handleAuth(request: NextRequest, executor: Pool, resource: string) {
  if (resource === "login" && request.method === "POST") {
    const body = await request.json() as JsonObject;
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : "";
    const attemptKey = `${email}|${request.headers.get("x-forwarded-for") ?? "local"}`;
    if (!await loginAllowed(executor, attemptKey)) return error("Too many login attempts. Try again in one minute.", 429);
    const [rows] = await executor.execute<RowDataPacket[]>("SELECT id, name, email, password_hash FROM owner WHERE email = ?", [email]);
    const owner = rows[0];
    if (!owner || typeof body.password !== "string" || !verifyPassword(body.password, owner.password_hash)) return error("Email or password is incorrect.", 422, { email: ["Email or password is incorrect."] });
    await executor.execute("DELETE FROM login_attempts WHERE attempt_key = ?", [attemptKey]);
    return json({ token: await issueToken(executor), user: { id: owner.id, name: owner.name, email: owner.email } });
  }
  return null;
}

async function handleNotebook(request: NextRequest, executor: Pool, id: number | null) {
  if (request.method === "GET" && !id) {
    const [rows] = await executor.query<DbNotebook[]>("SELECT n.*, (SELECT COUNT(*) FROM songs s WHERE s.notebook_id = n.id AND s.deleted_at IS NULL) songs_count FROM notebooks n WHERE n.deleted_at IS NULL ORDER BY n.sort_order, n.updated_at DESC");
    return json(await Promise.all(rows.map((row) => notebookRow(executor, row))));
  }
  if (request.method === "POST") {
    const body = await request.json() as JsonObject;
    if (typeof body.title !== "string" || !body.title.trim()) return error("The title field is required.", 422, { title: ["The title field is required."] });
    const [orderRows] = await executor.query<RowDataPacket[]>("SELECT COALESCE(MAX(sort_order), 0) + 1 next_order FROM notebooks");
    const timestamp = new Date();
    const [result] = await executor.execute<ResultSetHeader>("INSERT INTO notebooks (title, description, cover_color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)", [body.title.trim(), sqlValue(body.description), typeof body.cover_color === "string" ? body.cover_color : "#9A5B45", Number(orderRows[0].next_order), timestamp, timestamp]);
    const [rows] = await executor.execute<DbNotebook[]>("SELECT n.*, 0 songs_count FROM notebooks n WHERE id = ?", [result.insertId]);
    return json(await notebookRow(executor, rows[0]), 201);
  }
  if (!id) return error("Notebook not found.", 404);
  const [rows] = await executor.execute<DbNotebook[]>("SELECT * FROM notebooks WHERE id = ? AND deleted_at IS NULL", [id]);
  const notebook = rows[0];
  if (!notebook) return error("Notebook not found.", 404);
  if (request.method === "GET") return json(await notebookRow(executor, notebook, true));
  if (request.method === "PATCH") {
    const body = await request.json() as JsonObject;
    await executor.execute("UPDATE notebooks SET title=?, description=?, cover_color=?, is_favorite=?, sort_order=?, updated_at=? WHERE id=?", [sqlValue(body.title ?? notebook.title), sqlValue(body.description ?? notebook.description), sqlValue(body.cover_color ?? notebook.cover_color), body.is_favorite === undefined ? Number(notebook.is_favorite) : Number(Boolean(body.is_favorite)), Number(body.sort_order ?? notebook.sort_order), new Date(), id]);
    const [updatedRows] = await executor.execute<DbNotebook[]>("SELECT * FROM notebooks WHERE id = ?", [id]);
    return json(await notebookRow(executor, updatedRows[0], true));
  }
  if (request.method === "DELETE") {
    await withTransaction(async (connection) => { const timestamp = new Date(); await connection.execute("UPDATE songs SET deleted_at=? WHERE notebook_id=? AND deleted_at IS NULL", [timestamp, id]); await connection.execute("UPDATE notebooks SET deleted_at=? WHERE id=?", [timestamp, id]); });
    return json({ message: "Notebook moved to trash." });
  }
  return error("Method not allowed.", 405);
}

async function handleSongs(request: NextRequest, executor: Pool, id: number | null) {
  if (request.method === "GET" && !id) {
    const term = request.nextUrl.searchParams.get("q")?.trim();
    const notebookId = numberId(request.nextUrl.searchParams.get("notebook_id"));
    if (term) {
      const like = `%${term}%`;
      const [rows] = await executor.execute<DbSong[]>(`SELECT DISTINCT s.* FROM songs s
        LEFT JOIN song_genre sg ON sg.song_id=s.id LEFT JOIN genres g ON g.id=sg.genre_id
        LEFT JOIN song_composer sc ON sc.song_id=s.id LEFT JOIN composers c ON c.id=sc.composer_id
        LEFT JOIN song_artist sa ON sa.song_id=s.id LEFT JOIN artists a ON a.id=sa.artist_id
        LEFT JOIN song_lyricist sl ON sl.song_id=s.id LEFT JOIN lyricists l ON l.id=sl.lyricist_id
        WHERE s.deleted_at IS NULL AND (s.title LIKE ? OR s.content_text LIKE ? OR s.notes LIKE ? OR CAST(s.song_number AS CHAR) = ? OR g.name LIKE ? OR c.name LIKE ? OR a.name LIKE ? OR l.name LIKE ?)
        ORDER BY s.updated_at DESC`, [like, like, like, term, like, like, like, like]);
      return json(await Promise.all(rows.map((row) => songRow(executor, row))));
    }
    return json(notebookId ? await songList(executor, "s.notebook_id = ? AND s.deleted_at IS NULL", [notebookId]) : await songList(executor));
  }
  if (request.method === "POST") {
    const body = await request.json() as JsonObject;
    const errors = songPayloadErrors(body, true);
    if (Object.keys(errors).length) return error("The given data was invalid.", 422, errors);
    const notebookId = Number(body.notebook_id);
    const [notebooks] = await executor.execute<RowDataPacket[]>("SELECT id FROM notebooks WHERE id=? AND deleted_at IS NULL", [notebookId]);
    if (!notebooks[0]) return error("Notebook not found.", 404);
    try {
      const songId = await withTransaction(async (connection) => {
        const [orderRows] = await connection.execute<RowDataPacket[]>("SELECT COALESCE(MAX(sort_order), 0) + 1 next_order, COALESCE(MAX(song_number), 0) + 1 next_number FROM songs WHERE notebook_id=?", [notebookId]);
        const document = body.content_json ?? null; const timestamp = new Date();
        const [result] = await connection.execute<ResultSetHeader>("INSERT INTO songs (notebook_id, song_number, title, content_json, content_text, notes, sort_order, is_favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [notebookId, body.song_number == null ? Number(orderRows[0].next_number) : Number(body.song_number), (body.title as string).trim(), document ? JSON.stringify(document) : null, plainText(document), sqlValue(body.notes), Number(orderRows[0].next_order), Number(Boolean(body.is_favorite)), timestamp, timestamp]);
        await syncRelations(connection, result.insertId, body);
        return result.insertId;
      });
      return json(await getSong(executor, songId), 201);
    } catch (exception) { return error(duplicateError(exception) ? "That song number is already used in this notebook." : "Could not create song.", 422); }
  }
  if (!id) return error("Song not found.", 404);
  const existing = await getSong(executor, id, false, true) as JsonObject | null;
  if (!existing) return error("Song not found.", 404);
  if (request.method === "GET") return json(existing);
  if (request.method === "PATCH") {
    const body = await request.json() as JsonObject;
    const errors = songPayloadErrors(body, false);
    if (Object.keys(errors).length) return error("The given data was invalid.", 422, errors);
    if (body.revision !== undefined && Number(body.revision) !== Number(existing.revision)) return json({ message: "This song was updated elsewhere.", song: existing }, 409);
    try {
      await withTransaction(async (connection) => {
        const [versionRows] = await connection.execute<RowDataPacket[]>("SELECT COALESCE(MAX(version_number), 0) + 1 next_version FROM song_versions WHERE song_id=?", [id]);
        await connection.execute("INSERT INTO song_versions (song_id, version_number, title, content_json, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, Number(versionRows[0].next_version), sqlValue(existing.title), existing.content_json ? JSON.stringify(existing.content_json) : null, sqlValue(existing.notes), new Date()]);
        const document = body.content_json ?? existing.content_json;
        await connection.execute("UPDATE songs SET notebook_id=?, song_number=?, title=?, content_json=?, content_text=?, notes=?, is_favorite=?, revision=revision+1, updated_at=? WHERE id=?", [Number(body.notebook_id ?? existing.notebook_id), body.song_number === undefined ? sqlValue(existing.song_number) : body.song_number == null ? null : Number(body.song_number), sqlValue(body.title ?? existing.title), document ? JSON.stringify(document) : null, plainText(document), body.notes === undefined ? sqlValue(existing.notes) : sqlValue(body.notes), body.is_favorite === undefined ? Number(existing.is_favorite) : Number(Boolean(body.is_favorite)), new Date(), id]);
        await syncRelations(connection, id, body);
      });
      return json(await getSong(executor, id));
    } catch (exception) { return error(duplicateError(exception) ? "That song number is already used in this notebook." : "Could not update song.", 422); }
  }
  if (request.method === "DELETE") { await executor.execute("UPDATE songs SET deleted_at=? WHERE id=?", [new Date(), id]); return json({ message: "Song moved to trash." }); }
  return error("Method not allowed.", 405);
}

async function handleTrash(request: NextRequest, executor: Pool, action: string | undefined) {
  if (request.method === "GET") {
    const [notebookRows] = await executor.query<DbNotebook[]>("SELECT * FROM notebooks WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
    const [songRows] = await executor.query<DbSong[]>("SELECT * FROM songs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC");
    return json({ notebooks: await Promise.all(notebookRows.map((row) => notebookRow(executor, row))), songs: await Promise.all(songRows.map((row) => songRow(executor, row))) });
  }
  if (action === "restore" && request.method === "POST") {
    const body = await request.json() as JsonObject; const restoreId = Number(body.id);
    if (!Number.isInteger(restoreId) || (body.type !== "notebook" && body.type !== "song")) return error("A valid trash item is required.");
    try {
      await withTransaction(async (connection) => {
        if (body.type === "notebook") { await connection.execute("UPDATE notebooks SET deleted_at=NULL WHERE id=?", [restoreId]); await connection.execute("UPDATE songs SET deleted_at=NULL WHERE notebook_id=?", [restoreId]); }
        else {
          const [rows] = await connection.execute<RowDataPacket[]>("SELECT notebook_id FROM songs WHERE id=?", [restoreId]);
          if (!rows[0]) throw new Error("NOT_FOUND");
          await connection.execute("UPDATE notebooks SET deleted_at=NULL WHERE id=?", [rows[0].notebook_id]); await connection.execute("UPDATE songs SET deleted_at=NULL WHERE id=?", [restoreId]);
        }
      });
      return json({ message: "Restored successfully." });
    } catch (exception) { if ((exception as Error).message === "NOT_FOUND") return error("Song not found.", 404); return error("This item conflicts with an existing song number and cannot be restored.", 409); }
  }
  return error("Route not found.", 404);
}

async function route(request: NextRequest, context: Context) {
  let executor: Pool;
  try { executor = await getDb(); }
  catch (exception) { console.error("MySQL connection failed", exception); return error("Database connection failed. Check the MYSQL_* environment variables.", 503); }
  const { path } = await context.params; const [resource, idPart] = path; const id = numberId(idPart);

  const authResponse = await handleAuth(request, executor, resource);
  if (authResponse) return authResponse;
  if (!await isAuthorized(request, executor)) return error("Unauthenticated.", 401);
  if (resource === "me" && request.method === "GET") { const [rows] = await executor.query<RowDataPacket[]>("SELECT id, name, email FROM owner WHERE id=1"); return json(rows[0]); }
  if (resource === "me" && request.method === "PATCH") {
    const body = await request.json() as JsonObject;
    const [rows] = await executor.query<RowDataPacket[]>("SELECT id, name, email, password_hash FROM owner WHERE id=1");
    const owner = rows[0];
    const name = typeof body.name === "string" ? body.name.trim() : owner.name;
    const email = typeof body.email === "string" ? body.email.toLowerCase().trim() : owner.email;
    const newPassword = typeof body.new_password === "string" ? body.new_password : "";
    if (!name) return error("Name is required.", 422, { name: ["Name is required."] });
    if (!/^\S+@\S+\.\S+$/.test(email)) return error("Enter a valid email address.", 422, { email: ["Enter a valid email address."] });
    if (newPassword && newPassword.length < 8) return error("The new password must be at least 8 characters.", 422, { new_password: ["The new password must be at least 8 characters."] });
    if (newPassword && (typeof body.current_password !== "string" || !verifyPassword(body.current_password, owner.password_hash))) return error("Your current password is incorrect.", 422, { current_password: ["Your current password is incorrect."] });
    try {
      await executor.execute("UPDATE owner SET name=?, email=?, password_hash=?, updated_at=? WHERE id=1", [name.slice(0, 150), email.slice(0, 191), newPassword ? passwordHash(newPassword) : owner.password_hash, new Date()]);
    } catch (exception) {
      if (duplicateError(exception)) return error("That email address is already in use.", 422, { email: ["That email address is already in use."] });
      throw exception;
    }
    return json({ id: owner.id, name: name.slice(0, 150), email: email.slice(0, 191) });
  }
  if (resource === "logout" && request.method === "POST") { const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); if (token) await executor.execute("DELETE FROM sessions WHERE token_hash=?", [tokenHash(token)]); return json({ message: "Logged out." }); }
  if (resource === "dashboard" && request.method === "GET") {
    const [[notebookRows], [songRows], [favoriteRows], [recentRows]] = await Promise.all([
      executor.query<RowDataPacket[]>("SELECT COUNT(*) count FROM notebooks WHERE deleted_at IS NULL"), executor.query<RowDataPacket[]>("SELECT COUNT(*) count FROM songs WHERE deleted_at IS NULL"),
      executor.query<RowDataPacket[]>("SELECT COUNT(*) count FROM songs WHERE deleted_at IS NULL AND is_favorite=1"), executor.query<DbSong[]>("SELECT * FROM songs WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT 6"),
    ]);
    return json({ counts: { notebooks: Number(notebookRows[0].count), songs: Number(songRows[0].count), favorites: Number(favoriteRows[0].count) }, recent: await Promise.all(recentRows.map((row) => songRow(executor, row))), favorites: await songList(executor, "s.deleted_at IS NULL AND s.is_favorite=1") });
  }
  if (resource === "catalogues" && request.method === "GET") {
    const result: Record<string, RowDataPacket[]> = {};
    for (const table of ["genres", "composers", "artists", "lyricists", "tags"]) [result[table]] = await executor.query<RowDataPacket[]>(`SELECT * FROM ${table} ORDER BY name`);
    return json(result);
  }
  if (resource === "notebooks") return handleNotebook(request, executor, id);
  if (resource === "songs") return handleSongs(request, executor, id);
  if (resource === "trash") return handleTrash(request, executor, idPart);
  return error("Route not found.", 404);
}

export const GET = route;
export const POST = route;
export const PATCH = route;
export const DELETE = route;
