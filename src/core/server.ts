// server.ts — construye el McpServer y envuelve cada handler de tool.
// buildToolResult es puro (testeado); createServer cablea el registro de tools.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { ToolDef, ToolContext } from './types.js';
import type { ActualClient } from './actual-client.js';

export function buildToolResult(
  payload: unknown,
  meta: { stale: boolean; lastSynced: string | null },
) {
  const body: any =
    meta.stale && payload && typeof payload === 'object'
      ? { ...(payload as object), stale_data: true, last_synced: meta.lastSynced }
      : payload;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    structuredContent: body,
  };
}

function errorResult(code: string, message: string, hint?: string) {
  const body = { error: { code, message, ...(hint ? { hint } : {}) } };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(body) }],
    isError: true,
  };
}

export function createServer(deps: {
  tools: ToolDef[];
  client: ActualClient;
  api: any;
  config: Config;
}): McpServer {
  const server = new McpServer({ name: 'actual-budget-mcp', version: '2.0.0' });
  const ctx: ToolContext = { api: deps.api, config: deps.config };

  for (const tool of deps.tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        annotations: tool.readOnly
          ? { readOnlyHint: true }
          : { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async (input: any) => {
        try {
          const meta = await deps.client.ensureReady({ forWrite: !tool.readOnly });
          const payload = await tool.handler(input ?? {}, ctx);
          return buildToolResult(payload, meta);
        } catch (err) {
          if (err instanceof ZodError) {
            return errorResult(
              'invalid_input',
              'Entrada inválida',
              err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
            );
          }
          console.error(`[actual-mcp] Error en ${tool.name}:`, err);
          return errorResult('tool_failed', `${tool.name}: ${(err as Error).message}`);
        }
      },
    );
  }
  return server;
}
