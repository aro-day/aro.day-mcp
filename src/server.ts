// MCP server over stdio. NOTE: stdout is the MCP protocol channel — all
// human/diagnostic output MUST go to stderr (console.error), never stdout.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

export async function serve(): Promise<void> {
  const server = new McpServer({ name: "aroday-mcp", version: "0.1.0" });
  registerTools(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[aroday-mcp] connected — your AI client can now read and update your tasks.");
}
