// Browser-approve connect flow (`aroday-mcp connect`).
//
// Replaces the copy-a-code-into-the-terminal step: we open the user's
// browser to aro.day, they approve (they're already signed in), and the
// app hands a one-time pairing code straight back to a loopback server
// running on this machine — which redeems it for the session JWT. The
// user never sees or types a code.
//
// Security (RFC 8252 native-app loopback):
//   - The redirect target is a loopback URL THIS process constructs from a
//     port it owns — http://127.0.0.1:<port>/callback. We pass only the
//     integer port to the app (?aroday-connect=<port>), never a full
//     redirect_uri, so the app cannot be tricked into sending the code to
//     an attacker origin.
//   - A `cstate` nonce binds the browser leg to this process; a callback
//     whose state doesn't match is rejected.
//   - The pairing code is single-use + short-TTL server-side (the existing
//     /api/mcp/pair contract), so even if it leaked it is near-useless.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { BASE_URL } from "./config.js";
import { redeemPairingCode } from "./auth.js";

// Loopback only ever binds to localhost. We let the OS pick a free port
// (listen on 0) so two `connect` runs don't collide.
const LOOPBACK_HOST = "127.0.0.1";
// If the browser leg never returns (user closed the tab, never approved),
// don't hang the terminal forever.
const CONNECT_TIMEOUT_MS = 5 * 60_000;

function openBrowser(url: string): void {
  // Best-effort per-platform open. We also print the URL so a headless /
  // SSH session (where no browser command works) can still proceed.
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "cmd"
      : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true });
    child.on("error", () => { /* no browser available — printed URL is the fallback */ });
    child.unref();
  } catch { /* ignore — fall back to the printed URL */ }
}

function htmlPage(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
    `<body style="font-family:ui-monospace,Menlo,monospace;background:#0e1310;color:#e6ebe2;` +
    `display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">` +
    `<div><div style="font-size:20px;font-weight:600">aro<span style="color:#5ef07a">.</span>day</div>` +
    `<p style="color:#a3ada1;margin-top:12px">${body}</p></div>`;
}

export async function connect(clientName = "aroday-mcp"): Promise<void> {
  const nonce = randomBytes(16).toString("hex");

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      err ? reject(err) : resolve();
    };

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
      if (url.pathname !== "/callback") { res.writeHead(404).end(); return; }

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400, { "content-type": "text/html" })
          .end(htmlPage("Connect failed", "Couldn't connect. Return to your terminal and try again."));
        finish(new Error(`aro.day reported: ${error}`));
        return;
      }
      // Reject a callback that doesn't carry our nonce — it isn't ours.
      if (!code || state !== nonce) {
        res.writeHead(400, { "content-type": "text/html" })
          .end(htmlPage("Connect failed", "This connect link is invalid or expired. Re-run aroday-mcp connect."));
        finish(new Error("Connect callback missing/invalid code."));
        return;
      }

      // Redeem on this machine — the session JWT never transits the browser.
      redeemPairingCode(code, clientName).then(
        () => {
          res.writeHead(200, { "content-type": "text/html" })
            .end(htmlPage("Connected", "Connected to aro.day. You can close this tab and return to your terminal."));
          finish();
        },
        (err: unknown) => {
          res.writeHead(500, { "content-type": "text/html" })
            .end(htmlPage("Connect failed", "Couldn't finish connecting. Return to your terminal for details."));
          finish(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });

    const timer = setTimeout(
      () => finish(new Error("Timed out waiting for browser approval. Re-run aroday-mcp connect.")),
      CONNECT_TIMEOUT_MS,
    );

    server.on("error", (err) => finish(err));
    server.listen(0, LOOPBACK_HOST, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      if (!port) { finish(new Error("Could not open a local port for the connect flow.")); return; }
      const approveUrl = `${BASE_URL}/?aroday-connect=${port}&cstate=${nonce}`;
      console.error("Opening your browser to approve the connection…");
      console.error(`If it doesn't open, visit:\n  ${approveUrl}\n`);
      openBrowser(approveUrl);
    });
  });

  console.error("✓ Connected. Add aroday-mcp to your AI client and start asking it about your tasks.");
}
