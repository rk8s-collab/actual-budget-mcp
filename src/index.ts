#!/usr/bin/env node
import './core/log-redirect.js';
import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as api from '@actual-app/api';
import { loadConfig } from './core/config.js';
import { ActualClient } from './core/actual-client.js';
import { collectTools } from './core/tool-registry.js';
import { createServer } from './core/server.js';
import { allTools } from './tools/index.js';

async function main() {
  const config = loadConfig();
  const client = new ActualClient(api, config);
  const tools = collectTools(allTools, config.enableWrite);
  const server = createServer({ tools, client, api, config });

  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      await client.shutdown();
      process.exit(0);
    });
  }

  await server.connect(new StdioServerTransport());
  console.error(
    `[actual-mcp] v2 activo por stdio — ${tools.length} tools (write=${config.enableWrite})`,
  );
}

main().catch((err) => {
  console.error('[actual-mcp] Error fatal:', err);
  process.exit(1);
});
