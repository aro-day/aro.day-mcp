// Runtime configuration for the aroday-mcp connector.
//
// PRIVACY: this connector talks to the aro.day Worker ONLY to (a) redeem a
// pairing code for a session token and (b) mint a short-lived, Pro-gated
// Google Drive access token. Your TASK DATA never goes to aro.day's
// servers — it is read from / written to your own Google Drive
// appDataFolder directly. See ../README.md and
// docs/mcp/connecting-the-repos.md in the app repo.

import { homedir } from "node:os";
import { join } from "node:path";

// Override for local development against a dev Worker.
export const BASE_URL = process.env.ARODAY_BASE_URL?.replace(/\/$/, "") || "https://aro.day";

// E2EE passphrase for accounts that enabled Drive encryption (aro.day
// Settings → Privacy). Read once at module load. Stdio MCP has no
// interactive prompt path; the user puts this in the MCP server's env
// block in their AI client's config. The passphrase never leaves the
// local process — it derives a key in-memory via PBKDF2 and is used
// only for AES-GCM decrypt/encrypt of the Drive envelope.
export const E2EE_PASSPHRASE = process.env.ARODAY_E2EE_PASSPHRASE || "";

// Where the session JWT is cached (per-user, 0600). Mirrors the web app's
// aroday_session cookie but stored on disk for the headless client.
export const CONFIG_DIR = process.env.ARODAY_CONFIG_DIR || join(homedir(), ".config", "aroday");
export const SESSION_FILE = join(CONFIG_DIR, "session.json");

// Drive appDataFolder filename — MUST match the web app's Drive adapter
// (src/state/adapters/drive.ts → DRIVE_FILE_NAME). Versioned so a schema
// jump can ship a new file without clobbering the old one.
export const DRIVE_FILE_NAME = "aroday-state-v1.json";

// Worker endpoints (contract: docs/mcp/connecting-the-repos.md).
export const ENDPOINTS = {
  pairRedeem: `${BASE_URL}/api/mcp/pair/redeem`,
  driveToken: `${BASE_URL}/api/sync/drive/token`,
} as const;

// Google Drive REST surface (called directly with the minted access token).
export const DRIVE_API = "https://www.googleapis.com/drive/v3";
export const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
