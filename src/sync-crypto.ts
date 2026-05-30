// Sync envelope crypto — read/write the same Drive blob format the
// aro.day web app produces (src/state/sync-crypto.ts in the app).
//
// Three envelope shapes can land on Drive:
//   • { enc: true, v:1, salt, iv, ct, schemaVersion? }   E2EE on
//   • { gz:  true, v:1, data, schemaVersion? }           compressed (default)
//   • { schemaVersion, tasks, groups, ... }              legacy plaintext
//
// This file mirrors the app's algorithm constants + envelope shapes
// byte-for-byte so round-trips are stable. Uses globalThis.crypto
// (Web Crypto, available in Node 18+) and CompressionStream /
// DecompressionStream (also Node 18+) — no third-party crypto dep.

const PBKDF2_ITERATIONS = 600_000;
const IV_BYTES = 12;
const KEY_BITS = 256;

export interface EncryptedEnvelope {
  v: 1;
  enc: true;
  salt: string;        // base64 random per-user salt (stable across saves)
  iv: string;          // base64 random per-encryption IV (NEVER reuse)
  ct: string;          // base64 ciphertext + GCM auth tag
  schemaVersion?: number;
}

export interface CompressedEnvelope {
  v: 1;
  gz: true;
  data: string;        // base64(gzip(JSON.stringify(state)))
  schemaVersion?: number;
}

export type DriveBodyKind = "encrypted" | "compressed" | "plaintext" | "empty" | "invalid";

// ---- base64 helpers (chunked to avoid call-stack limit on big bodies) ----

function b64encode(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x2000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

// ---- gzip via Web Streams (CompressionStream / DecompressionStream) ----

async function gzipEncode(plaintext: string): Promise<Uint8Array> {
  const stream = new Blob([new TextEncoder().encode(plaintext)])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

async function gzipDecode(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const buf = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(buf);
}

// ---- compressed envelope (non-E2EE default) ----

export async function compressState(plaintext: string, schemaVersion?: number): Promise<CompressedEnvelope> {
  const compressed = await gzipEncode(plaintext);
  return { v: 1, gz: true, data: b64encode(compressed), schemaVersion };
}

export async function decompressState(envelope: CompressedEnvelope): Promise<string> {
  if (!envelope || envelope.v !== 1 || !envelope.gz) {
    throw new Error("decompress: not a compressed envelope");
  }
  return gzipDecode(b64decode(envelope.data));
}

// ---- encrypted envelope (E2EE on) ----

export async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptState(
  plaintext: string,
  key: CryptoKey,
  salt: Uint8Array,
  schemaVersion?: number,
): Promise<EncryptedEnvelope> {
  // Compress BEFORE encrypt — AES-GCM ciphertext is indistinguishable
  // from random and won't compress at all. Matches the app's pipeline.
  const compressed = await gzipEncode(plaintext);
  const iv = randomBytes(IV_BYTES);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, compressed as BufferSource),
  );
  return { v: 1, enc: true, salt: b64encode(salt), iv: b64encode(iv), ct: b64encode(ct), schemaVersion };
}

export async function decryptState(envelope: EncryptedEnvelope, key: CryptoKey): Promise<string> {
  if (!envelope || envelope.v !== 1 || !envelope.enc) {
    throw new Error("decrypt: not an encrypted envelope");
  }
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(envelope.iv) as BufferSource },
      key,
      b64decode(envelope.ct) as BufferSource,
    );
  } catch (err) {
    // WebCrypto OperationError carries no message — normalise so the
    // CLI can show a single clear "wrong passphrase" hint.
    const e = new Error("wrong_passphrase");
    (e as Error & { cause?: unknown }).cause = err;
    throw e;
  }
  return gzipDecode(new Uint8Array(plain));
}

// ---- discriminator: pick the decode path at JSON-parse time ----

export function classifyDriveBody(body: string): DriveBodyKind {
  if (!body) return "empty";
  const trimmed = body.trim();
  if (!trimmed || trimmed === "{}") return "empty";
  let parsed: unknown;
  try { parsed = JSON.parse(trimmed); } catch { return "invalid"; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "invalid";
  const obj = parsed as Record<string, unknown>;
  if (obj.enc === true && obj.v === 1 && typeof obj.ct === "string") return "encrypted";
  if (obj.gz  === true && obj.v === 1 && typeof obj.data === "string") return "compressed";
  return "plaintext";
}

export function saltFromBase64(s: string): Uint8Array { return b64decode(s); }
