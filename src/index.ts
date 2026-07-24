#!/usr/bin/env node
import './core/log-redirect.js';
import 'dotenv/config';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as api from '@actual-app/api';
import { loadConfig } from './core/config.js';
import { setMessageLanguage, msg } from './core/messages.js';
import { ActualClient } from './core/actual-client.js';
import { collectTools } from './core/tool-registry.js';
import { createServer } from './core/server.js';
import { allTools } from './tools/index.js';
import { checkNativeAbi, nativeAddonPath } from './core/native-check.js';

// dlopen real, solo para esta comprobación puntual: carga el binario nativo con un
// módulo "de usar y tirar" (sus exports no se usan) únicamente para leer, si falla,
// el mensaje de Node que declara los dos NODE_MODULE_VERSION en juego.
function dlopenReal(addonPath: string): void {
  process.dlopen({ exports: {} } as NodeModule, addonPath);
}

async function main() {
  const config = loadConfig();
  setMessageLanguage(config.messagesLang);
  const client = new ActualClient(api, config, undefined, () => checkNativeAbi(dlopenReal, nativeAddonPath()));
  const tools = collectTools(allTools, config.enableWrite, msg(config));
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
