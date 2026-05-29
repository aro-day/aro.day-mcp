#!/usr/bin/env node
// aroday-mcp CLI.
//   aroday-mcp connect               connect via the browser (recommended)
//   aroday-mcp login --code <CODE>   connect with a one-time code (no browser)
//   aroday-mcp                       start the MCP server (stdio) for your AI client
//
// All output goes to stderr — stdout is reserved for the MCP protocol.

import { redeemPairingCode } from "./auth.js";
import { connect } from "./connect.js";
import { serve } from "./server.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === "connect") {
    await connect();
    return;
  }

  if (cmd === "login") {
    const idx = argv.indexOf("--code");
    const code = idx >= 0 ? argv[idx + 1] : argv[1];
    if (!code) {
      console.error("Usage: aroday-mcp login --code <CODE>\n(Get a code in aro.day → Settings → AI integration → Connect an AI client.)");
      process.exit(1);
    }
    const data = await redeemPairingCode(code);
    console.error(`✓ Connected (client ${data.clientId}). Add aroday-mcp to your AI client and start asking it about your tasks.`);
    return;
  }

  if (!cmd || cmd === "serve") {
    await serve();
    return;
  }

  console.error(`Unknown command: ${cmd}\nUsage:\n  aroday-mcp connect               connect via the browser (recommended)\n  aroday-mcp login --code <CODE>   connect with a one-time code\n  aroday-mcp                       start the MCP server (stdio)`);
  process.exit(1);
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
