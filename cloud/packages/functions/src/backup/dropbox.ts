/** Minimal Dropbox client for the v3-format backup, mirroring the v3 desktop provider's OAuth refresh flow. */

export interface DropboxCredentials { appKey: string; appSecret: string; refreshToken: string; }
type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export class DropboxError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Dropbox-API-Arg must be ASCII; escape any non-ASCII path characters as JSON \\u sequences. */
export const dropboxArg = (value: unknown) => JSON.stringify(value).replace(/[-￿]/gu, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

async function readError(response: { status: number; text(): Promise<string> }, action: string): Promise<never> {
  // Never echo request bodies or tokens; Dropbox error summaries are safe to log.
  const body = await response.text().catch(() => '');
  let summary = '';
  try { summary = String((JSON.parse(body) as { error_summary?: unknown; error?: unknown }).error_summary ?? (JSON.parse(body) as { error?: unknown }).error ?? ''); } catch { summary = body.slice(0, 120); }
  throw new DropboxError(`Dropbox ${action} failed (HTTP ${response.status}) ${summary}`.trim(), response.status);
}

export function createDropboxClient(credentials: DropboxCredentials, fetchImpl: FetchLike = fetch as unknown as FetchLike) {
  let accessToken: string | null = null;
  const token = async () => {
    if (accessToken) return accessToken;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: credentials.refreshToken, client_id: credentials.appKey, client_secret: credentials.appSecret }).toString();
    const response = await fetchImpl('https://api.dropboxapi.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!response.ok) await readError(response, 'token refresh');
    const parsed = JSON.parse(await response.text()) as { access_token?: unknown };
    if (typeof parsed.access_token !== 'string') throw new DropboxError('Dropbox token refresh returned no access token', response.status);
    accessToken = parsed.access_token;
    return accessToken;
  };
  const rpc = async <T>(endpoint: string, args: unknown, action: string): Promise<T> => {
    const response = await fetchImpl(`https://api.dropboxapi.com/2/${endpoint}`, { method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
    if (!response.ok) await readError(response, action);
    return JSON.parse(await response.text()) as T;
  };
  return {
    async upload(path: string, content: string): Promise<void> {
      const response = await fetchImpl('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/octet-stream', 'Dropbox-API-Arg': dropboxArg({ path, mode: 'overwrite', autorename: false, mute: true }) },
        body: new TextEncoder().encode(content),
      });
      if (!response.ok) await readError(response, `upload ${path}`);
    },
    /** File names in a folder; a missing folder is an empty list. */
    async listFileNames(path: string): Promise<string[]> {
      try {
        const names: string[] = [];
        let page = await rpc<{ entries: Array<{ '.tag': string; name: string }>; cursor: string; has_more: boolean }>('files/list_folder', { path, recursive: false }, `list ${path}`);
        for (;;) {
          names.push(...page.entries.filter((entry) => entry['.tag'] === 'file').map((entry) => entry.name));
          if (!page.has_more) return names;
          page = await rpc('files/list_folder/continue', { cursor: page.cursor }, `list ${path}`);
        }
      } catch (error) {
        if (error instanceof DropboxError && error.status === 409 && /not_found/u.test(error.message)) return [];
        throw error;
      }
    },
    async remove(path: string): Promise<void> { await rpc('files/delete_v2', { path }, `delete ${path}`); },
  };
}

export type DropboxClient = ReturnType<typeof createDropboxClient>;

export const DAILY_PREFIX = 'bini_blooms_backup_';

/** Daily snapshots named `bini_blooms_backup_YYYY-MM-DD.json` older than `keepDays` Taipei days (today counts as day 1). */
export function expiredDailyFiles(names: readonly string[], taipeiToday: string, keepDays: number): string[] {
  const cutoff = new Date(Date.parse(`${taipeiToday}T00:00:00Z`) - (keepDays - 1) * 86_400_000).toISOString().slice(0, 10);
  return names.filter((name) => {
    const match = new RegExp(`^${DAILY_PREFIX}(\\d{4}-\\d{2}-\\d{2})\\.json$`, 'u').exec(name);
    return Boolean(match && match[1]! < cutoff);
  });
}
