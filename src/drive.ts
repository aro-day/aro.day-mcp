// Google Drive appDataFolder client. Reads/writes the single state file
// the web app syncs, using the SAME filename + API shape as the app's
// Drive adapter (src/state/adapters/drive.ts). The connector calls Google
// directly with the minted access token — task data never transits aro.day.

import { getDriveAccessToken } from "./auth.js";
import { DRIVE_API, DRIVE_UPLOAD, DRIVE_FILE_NAME } from "./config.js";
import type { TodoState } from "./state.js";

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getDriveAccessToken();
  return fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}

interface DriveFile { id: string; name: string }

async function findStateFileId(): Promise<string | null> {
  const q = encodeURIComponent(`name='${DRIVE_FILE_NAME}' and trashed=false`);
  const res = await driveFetch(
    `${DRIVE_API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name)&pageSize=1`,
  );
  if (!res.ok) throw new Error(`Drive list failed (HTTP ${res.status}).`);
  const list = (await res.json()) as { files?: DriveFile[] };
  return list.files?.[0]?.id ?? null;
}

async function createStateFile(body: string): Promise<void> {
  const meta = { name: DRIVE_FILE_NAME, parents: ["appDataFolder"] };
  const boundary = `aroday${Math.random().toString(36).slice(2)}`;
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await driveFetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipart,
  });
  if (!res.ok) throw new Error(`Drive create failed (HTTP ${res.status}).`);
}

async function updateStateFile(id: string, body: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!res.ok) throw new Error(`Drive update failed (HTTP ${res.status}).`);
}

// Load the current state from Drive. Returns null if no file exists yet
// (account hasn't synced from the app). Throws a clear error if the blob
// is encrypted/compressed (E2EE) — not yet supported by the connector.
export async function loadState(): Promise<TodoState | null> {
  const id = await findStateFileId();
  if (!id) return null;
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) throw new Error(`Drive read failed (HTTP ${res.status}).`);
  const raw = (await res.text()).trim();
  if (!raw.startsWith("{")) {
    throw new Error(
      "This account's Drive data is compressed or end-to-end encrypted, which the connector " +
      "doesn't support yet. Disable encryption in aro.day (Settings → Privacy) to use AI integration.",
    );
  }
  try {
    return JSON.parse(raw) as TodoState;
  } catch {
    throw new Error("Drive state file was not valid JSON.");
  }
}

// Persist state to Drive (create-or-update). Caller is responsible for
// having read fresh + stamped meta just before calling (read-mutate-write).
export async function saveState(state: TodoState): Promise<void> {
  const body = JSON.stringify(state);
  const id = await findStateFileId();
  if (id) await updateStateFile(id, body);
  else await createStateFile(body);
}
