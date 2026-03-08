#!/usr/bin/env node

// index.js — Punto de entrada del MCP server para Actual Budget
// Usa transporte stdio para comunicarse con Claude Desktop / Claude.ai

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initActual, shutdownActual } from './actualClient.js';

// Importar todas las herramientas
import * as getAccounts from './tools/getAccounts.js';
import * as getCategories from './tools/getCategories.js';
import * as getTransactions from './tools/getTransactions.js';
import * as getSummaryByCategory from './tools/getSummaryByCategory.js';
import * as getBudgetMonths from './tools/getBudgetMonths.js';
import * as getNetWorth from './tools/getNetWorth.js';

// Registro de herramientas disponibles
const tools = [
  getAccounts,
  getCategories,
  getTransactions,
  getSummaryByCategory,
  getBudgetMonths,
  getNetWorth,
];

// Mapa nombre → handler para despacho rápido
const toolHandlers = new Map(tools.map((t) => [t.definition.name, t.handler]));

// Crear el servidor MCP
const server = new Server(
  {
    name: 'actual-budget-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handler: listar herramientas disponibles
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => t.definition),
}));

// Handler: ejecutar una herramienta
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const handler = toolHandlers.get(name);
  if (!handler) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: `Herramienta desconocida: ${name}` }),
        },
      ],
    };
  }

  try {
    // Asegurar que Actual Budget está conectado antes de cada llamada
    await initActual();

    const result = await handler(args ?? {});
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (err) {
    console.error(`[actual-mcp] Error en ${name}:`, err.message);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: `Error al ejecutar ${name}: ${err.message}`,
          }),
        },
      ],
    };
  }
});

// Arrancar el servidor
async function main() {
  console.error('[actual-mcp] Iniciando servidor MCP para Actual Budget...');

  // Intentar conectar a Actual Budget al inicio (pero no fallar si no se puede)
  try {
    await initActual();
  } catch (err) {
    console.error('[actual-mcp] No se pudo conectar a Actual Budget al inicio.');
    console.error('[actual-mcp] Se reintentará en cada llamada a herramienta.');
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[actual-mcp] Servidor MCP activo y escuchando por stdio');
}

// Cerrar limpiamente al recibir señal de parada
process.on('SIGINT', async () => {
  await shutdownActual();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await shutdownActual();
  process.exit(0);
});

main().catch((err) => {
  console.error('[actual-mcp] Error fatal:', err);
  process.exit(1);
});
