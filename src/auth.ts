// Auth: redeem a pairing code for a session JWT, persist it, and mint
// short-lived Google Drive access tokens through the aro.day Worker's
// Pro-gated broker. The Google refresh token NEVER reaches this client —
// it stays encrypted in the Worker's KV (see app repo worker-sync-drive.ts).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { CONFIG_DIR, SESSION_FILE, ENDPOINTS } from "./config.js";

interface SessionData { session: string; clientId: string; sub?: string }

export function readSession(): SessionData | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, "utf8")) as SessionData;
  } catch {
    return null;
  }
}

function writeSession(data: SessionData): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  // 0600 — the session JWT is a bearer credential; keep it user-only.
  writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export function requireSession(): SessionData {
  const s = readSession();
  if (!s?.session) {
    throw new Error(
      "Not signed in. In aro.day open Settings → AI integration → Connect an AI client, " +
      "then run:  aroday-mcp login --code <CODE>",
    );
  }
  return s;
}

// Exchange a one-time pairing code (shown in the app) for a durable
// session JWT. Single-use server-side.
export async function redeemPairingCode(code: string, clientName = "aroday-mcp"): Promise<SessionData> {
  const res = await fetch(ENDPOINTS.pairRedeem, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: code.trim().toUpperCase(), clientName }),
  });
  if (res.status === 401) throw new Error("That code is invalid or expired. Generate a fresh one in the app.");
  if (!res.ok) throw new Error(`Pairing failed (HTTP ${res.status}). Try again.`);
  const data = (await res.json()) as SessionData;
  if (!data?.session) throw new Error("Pairing response missing a session token.");
  writeSession(data);
  return data;
}

// --- Drive access-token broker (Pro-gated) -------------------------------
// Cache the minted token until ~60s before expiry to avoid a round-trip per
// Drive call without ever holding a stale token.
let cachedToken: { value: string; expiresAtMs: number } | null = null;

export async function getDriveAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAtMs - 60_000) return cachedToken.value;
  const { session } = requireSession();
  const res = await fetch(ENDPOINTS.driveToken, {
    method: "POST",
    headers: { Authorization: `Bearer ${session}` },
  });
  if (res.status === 402 || res.status === 403) {
    throw new Error(
      "AI integration is a Pro feature. Upgrade in aro.day (Settings → AI integration) to connect a client.",
    );
  }
  if (res.status === 401) {
    throw new Error("Session expired. Re-pair: aroday-mcp login --code <CODE>");
  }
  if (res.status === 412) {
    throw new Error("Google Drive isn't connected for this account. Sign in to Drive in aro.day first.");
  }
  if (!res.ok) throw new Error(`Could not mint a Drive token (HTTP ${res.status}).`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  if (!data?.access_token) throw new Error("Drive token response was empty.");
  cachedToken = {
    value: data.access_token,
    expiresAtMs: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}
