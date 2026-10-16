export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "/api";

export type NamedItem = { id: number; name: string; color?: string | null };
export type Song = {
  id: number; notebook_id: number; song_number: number | null; title: string;
  content_json: Record<string, unknown> | null; content_text: string | null;
  notes: string | null; is_favorite: boolean; revision: number; updated_at: string;
  notebook?: Pick<Notebook, "id" | "title" | "cover_color">;
  genres?: NamedItem[]; composers?: NamedItem[]; artists?: NamedItem[]; lyricists?: NamedItem[]; tags?: NamedItem[];
};
export type Notebook = {
  id: number; title: string; description: string | null; cover_color: string;
  is_favorite: boolean; songs_count?: number; songs?: Song[]; updated_at: string;
};

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window === "undefined" ? null : window.localStorage.getItem("hla_bu_token");
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init?.headers },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }
  return response.json();
}
