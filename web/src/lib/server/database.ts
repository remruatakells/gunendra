import "server-only";

import mysql, { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

export type SqlExecutor = Pool | PoolConnection;

const databaseName = process.env.MYSQL_DATABASE ?? "hla_bu";
if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) throw new Error("MYSQL_DATABASE may contain only letters, numbers, and underscores.");

const connectionOptions = {
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
};

const schema = [
  `CREATE TABLE IF NOT EXISTS owner (
    id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(150) NOT NULL, email VARCHAR(191) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME(3) NOT NULL, created_at DATETIME(3) NOT NULL, INDEX sessions_expires_at (expires_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    attempt_key VARCHAR(255) PRIMARY KEY, attempts INT UNSIGNED NOT NULL, window_started_at BIGINT UNSIGNED NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS notebooks (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, title VARCHAR(200) NOT NULL, description TEXT NULL,
    cover_color VARCHAR(20) NOT NULL DEFAULT '#9A5B45', cover_image VARCHAR(500) NULL,
    sort_order INT UNSIGNED NOT NULL DEFAULT 0, is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, deleted_at DATETIME(3) NULL,
    INDEX notebooks_sort_order (sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS songs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, notebook_id BIGINT UNSIGNED NOT NULL,
    song_number INT UNSIGNED NULL, title VARCHAR(255) NOT NULL, content_json JSON NULL,
    content_text LONGTEXT NULL, notes TEXT NULL, sort_order INT UNSIGNED NOT NULL DEFAULT 0,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE, revision INT UNSIGNED NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, deleted_at DATETIME(3) NULL,
    active_song_number INT GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN song_number ELSE NULL END) STORED,
    CONSTRAINT songs_notebook_fk FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE RESTRICT,
    UNIQUE KEY songs_active_number_unique (notebook_id, active_song_number),
    INDEX songs_notebook_order (notebook_id, sort_order), INDEX songs_favorite (is_favorite),
    FULLTEXT INDEX songs_fulltext (title, content_text)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS song_versions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, song_id BIGINT UNSIGNED NOT NULL,
    version_number INT UNSIGNED NOT NULL, title VARCHAR(255) NOT NULL, content_json JSON NULL,
    notes TEXT NULL, created_at DATETIME(3) NOT NULL,
    CONSTRAINT versions_song_fk FOREIGN KEY (song_id) REFERENCES songs(id) ON DELETE CASCADE,
    UNIQUE KEY versions_song_number_unique (song_id, version_number)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS genres (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, description TEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS composers (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200) NOT NULL UNIQUE, biography TEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS artists (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200) NOT NULL UNIQUE, biography TEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS lyricists (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(200) NOT NULL UNIQUE, biography TEXT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tags (id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL UNIQUE, color VARCHAR(20) NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS song_genre (song_id BIGINT UNSIGNED NOT NULL, genre_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(song_id, genre_id), FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE, FOREIGN KEY(genre_id) REFERENCES genres(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS song_composer (song_id BIGINT UNSIGNED NOT NULL, composer_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(song_id, composer_id), FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE, FOREIGN KEY(composer_id) REFERENCES composers(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS song_artist (song_id BIGINT UNSIGNED NOT NULL, artist_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(song_id, artist_id), FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE, FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS song_lyricist (song_id BIGINT UNSIGNED NOT NULL, lyricist_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(song_id, lyricist_id), FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE, FOREIGN KEY(lyricist_id) REFERENCES lyricists(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS song_tag (song_id BIGINT UNSIGNED NOT NULL, tag_id BIGINT UNSIGNED NOT NULL, PRIMARY KEY(song_id, tag_id), FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE, FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE CASCADE) ENGINE=InnoDB`,
];

export function passwordHash(password: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${pbkdf2Sync(password, salt, 310_000, 32, "sha256").toString("hex")}`;
}

async function createPool(): Promise<Pool> {
  const pool = mysql.createPool({ ...connectionOptions, database: databaseName, connectionLimit: 10, timezone: "Z", supportBigNumbers: true, bigNumberStrings: false });
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== "ER_BAD_DB_ERROR" || process.env.MYSQL_AUTO_CREATE_DATABASE === "false") throw error;
    const admin = await mysql.createConnection(connectionOptions);
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await admin.end();
  }
  for (const statement of schema) await pool.query(statement);
  await seed(pool);
  return pool;
}

const globalDatabase = globalThis as typeof globalThis & { hlaBuMySqlPool?: Promise<Pool> };

export function getDb(): Promise<Pool> {
  globalDatabase.hlaBuMySqlPool ??= createPool();
  return globalDatabase.hlaBuMySqlPool;
}

async function seed(executor: SqlExecutor): Promise<void> {
  const timestamp = new Date();
  await executor.execute("INSERT IGNORE INTO owner (id, name, email, password_hash, created_at, updated_at) VALUES (1, ?, ?, ?, ?, ?)", ["Gunendra", "owner@example.com", passwordHash("change-me"), timestamp, timestamp]);
  for (const name of ["Hla leng", "Pathian hla", "Lengzem", "Pop", "Rock", "Gospel", "Folk", "Classical", "Jazz", "R&B", "Hip-Hop", "Country", "Electronic"]) await executor.execute("INSERT IGNORE INTO genres (name) VALUES (?)", [name]);
  await executor.execute("INSERT IGNORE INTO composers (name) VALUES (?)", ["Gunendra"]);
  await executor.execute("INSERT IGNORE INTO lyricists (name) VALUES (?)", ["Traditional"]);
  await executor.execute("INSERT IGNORE INTO tags (name, color) VALUES (?, ?)", ["Favourite", "#C46A4A"]);
  const [countRows] = await executor.query<RowDataPacket[]>("SELECT COUNT(*) count FROM notebooks");
  if (Number(countRows[0].count)) return;

  const [first] = await executor.execute<ResultSetHeader>("INSERT INTO notebooks (title, description, cover_color, sort_order, is_favorite, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)", ["Ka Hla Bu", "Ka duh zawng hla leh ka ziak khawmna.", "#9A5B45", timestamp, timestamp]);
  const [second] = await executor.execute<ResultSetHeader>("INSERT INTO notebooks (title, description, cover_color, sort_order, created_at, updated_at) VALUES (?, ?, ?, 2, ?, ?)", ["Pathian Hla", "Pathian fakna leh thlarau hla te.", "#527466", timestamp, timestamp]);
  const document = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Zan reiah thli a leng" }] }, { type: "paragraph", content: [{ type: "text", text: "Ka rilru hlaah a thang..." }] }] };
  const [song] = await executor.execute<ResultSetHeader>("INSERT INTO songs (notebook_id, song_number, title, content_json, content_text, notes, sort_order, is_favorite, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, 1, 1, ?, ?)", [first.insertId, "Zan Reiah", JSON.stringify(document), "Zan reiah thli a leng Ka rilru hlaah a thang...", "Key: G · Tempo: 72 BPM", timestamp, timestamp]);
  const [genreRows] = await executor.execute<RowDataPacket[]>("SELECT id FROM genres WHERE name = ?", ["Hla leng"]);
  const [composerRows] = await executor.execute<RowDataPacket[]>("SELECT id FROM composers WHERE name = ?", ["Gunendra"]);
  await executor.execute("INSERT INTO song_genre (song_id, genre_id) VALUES (?, ?)", [song.insertId, genreRows[0].id]);
  await executor.execute("INSERT INTO song_composer (song_id, composer_id) VALUES (?, ?)", [song.insertId, composerRows[0].id]);
  await executor.execute("INSERT INTO songs (notebook_id, song_number, title, content_json, content_text, sort_order, created_at, updated_at) VALUES (?, 12, ?, ?, ?, 1, ?, ?)", [second.insertId, "Engkim Siamtu", JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Engkim Siamtu, nangmah ka fak e." }] }] }), "Engkim Siamtu, nangmah ka fak e.", timestamp, timestamp]);
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) return false;
  const actual = pbkdf2Sync(password, salt, 310_000, 32, "sha256");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export async function issueToken(executor: SqlExecutor): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const createdAt = new Date();
  await executor.query("DELETE FROM sessions");
  await executor.execute("INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)", [tokenHash(token), new Date(createdAt.getTime() + 30 * 86_400_000), createdAt]);
  return token;
}

export async function isAuthorized(request: Request, executor: SqlExecutor): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const [rows] = await executor.execute<RowDataPacket[]>("SELECT expires_at FROM sessions WHERE token_hash = ?", [tokenHash(token)]);
  return Boolean(rows[0] && new Date(rows[0].expires_at) > new Date());
}

export async function withTransaction<T>(callback: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const pool = await getDb();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function plainText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const value = node as { text?: string; content?: unknown[] };
  return [value.text ?? "", ...(value.content ?? []).map(plainText)].join(" ").replace(/\s+/g, " ").trim();
}
