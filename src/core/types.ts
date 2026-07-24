// types.ts — contratos compartidos por todas las tools.
import { z, type ZodRawShape } from 'zod';
import type { Config } from './config.js';
import { activeMessages } from './messages.js';

/** Ids de Actual. UUID estricto: el compilador AQL interpola los valores de tipo
 *  `id` en el SQL sin escaparlos, así que la validación es la única barrera. */
export const ID = z.string().uuid({ error: () => activeMessages().mustBeUuid });

export interface ToolContext {
  api: any;            // @actual-app/api module (injected; mocked in tests)
  config: Config;
}

export interface ToolDef {
  name: string;
  title: string;                     // nombre legible para el cliente MCP (en inglés, como description)
  description: string;
  readOnly: boolean;                 // false => only registered when enableWrite
  inputSchema: ZodRawShape;          // Zod raw shape consumed by SDK registerTool
  outputSchema?: ZodRawShape;        // optional; enables SDK-side structuredContent validation
  /** Solo tools de escritura: se fusiona sobre los defaults de server.ts */
  annotations?: { destructiveHint?: boolean; idempotentHint?: boolean };
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}
