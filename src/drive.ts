// Google Drive appDataFolder client. Reads/writes the single state file
// the web app syncs, using the SAME filename + envelope shapes as the
// app's Drive adapter (src/state/adapters/drive.ts + src/state/sync-crypto.ts
// in the app repo). The connector calls Google directly with the minted
// access token — task data never transits aro.day.
//
// Envelope handling: the app may store the blob in three forms (plaintext
// legacy, compressed-only, or compressed-then-encrypted). loadState() picks
// the right decode path via classifyDriveBody, and saveState() re-wraps in
// the same form so a connector write doesn't downgrade a user's E2EE blob
// to plaintext. The envelope shape and (for E2EE) the per-user salt + the
// derived key are cached at module scope between load+save — matches the
// read-mutate-write pattern in store.ts.

import { getDriveAccessToken } from "./auth.js";
import { DRIVE_API, DRIVE_UPLOAD, DRIVE_FILE_NAME, E2EE_PASSPHRASE } from "./config.js";
import type { TodoState } from "./state.js";
import {
  classifyDriveBody, compressState, decompressState, deriveKey,
  encryptState, decryptState, saltFromBase64,
  type EncryptedEnvelope, type CompressedEnvelope, type DriveBodyKind,
} from "./sync-crypto.js";

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

// Remembered between load and save so re-wrap matches what we read. If a
// process calls saveState without ever calling loadState (unsupported in
// practice — store.ts always reads first), we default to compressed.
interface LastEnvelope {
  kind: DriveBodyKind;
  salt?: Uint8Array;     // only for "encrypted"
  key?: CryptoKey;       // only for "encrypted"
  schemaVersion?: number;
}
let lastEnvelope: LastEnvelope = { kind: "compressed" };

async function deriveKeyForEnvelope(envelope: EncryptedEnvelope): Promise<CryptoKey> {
  if (!E2EE_PASSPHRASE) {
    throw new Error(
      "This account's Drive data is end-to-end encrypted. Set ARODAY_E2EE_PASSPHRASE " +
      "in the MCP server's env (your aro.day Settings → Privacy passphrase) and try again. " +
      "The passphrase never leaves this machine.",
    );
  }
  const salt = saltFromBase64(envelope.salt);
  return deriveKey(E2EE_PASSPHRASE, salt);
}

// Load the current state from Drive. Returns null if no file exists yet
// (account hasn't synced from the app). Auto-decompresses or decrypts
// based on the envelope shape and caches the decode context so the next
// saveState re-wraps in the same form.
export async function loadState(): Promise<TodoState | null> {
  const id = await findStateFileId();
  if (!id) return null;
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(id)}?alt=media`);
  if (!res.ok) throw new Error(`Drive read failed (HTTP ${res.status}).`);
  const raw = (await res.text()).trim();
  const kind = classifyDriveBody(raw);

  if (kind === "empty") return null;
  if (kind === "invalid") throw new Error("Drive state file is not valid JSON.");

  let plaintext: string;
  if (kind === "plaintext") {
    lastEnvelope = { kind: "plaintext" };
    plaintext = raw;
  } else if (kind === "compressed") {
    const envelope = JSON.parse(raw) as CompressedEnvelope;
    plaintext = await decompressState(envelope);
    lastEnvelope = { kind: "compressed", schemaVersion: envelope.schemaVersion };
  } else {
    // encrypted
    const envelope = JSON.parse(raw) as EncryptedEnvelope;
    const key = await deriveKeyForEnvelope(envelope);
    try {
      plaintext = await decryptState(envelope, key);
    } catch (err) {
      if (err instanceof Error && err.message === "wrong_passphrase") {
        throw new Error(
          "Wrong ARODAY_E2EE_PASSPHRASE — couldn't decrypt your Drive data. " +
          "Check the passphrase you set in aro.day Settings → Privacy and update " +
          "the MCP server's env, then reconnect.",
        );
      }
      throw err;
    }
    lastEnvelope = {
      kind: "encrypted",
      salt: saltFromBase64(envelope.salt),
      key,
      schemaVersion: envelope.schemaVersion,
    };
  }

  try {
    return JSON.parse(plaintext) as TodoState;
  } catch {
    throw new Error("Drive state plaintext was not valid JSON.");
  }
}

// Persist state to Drive (create-or-update), re-wrapping in whatever
// envelope shape we last loaded. Falling back to compressed (the app's
// current default for non-E2EE users) when there was no prior load.
export async function saveState(state: TodoState): Promise<void> {
  const plaintext = JSON.stringify(state);
  const schemaVersion = state.schemaVersion;

  let body: string;
  if (lastEnvelope.kind === "encrypted" && lastEnvelope.salt && lastEnvelope.key) {
    body = JSON.stringify(await encryptState(plaintext, lastEnvelope.key, lastEnvelope.salt, schemaVersion));
  } else if (lastEnvelope.kind === "plaintext") {
    body = plaintext;
  } else {
    body = JSON.stringify(await compressState(plaintext, schemaVersion));
  }

  const id = await findStateFileId();
  if (id) await updateStateFile(id, body);
  else await createStateFile(body);
}
