// types.ts — contratos compartidos por todas las tools.
import type { ZodRawShape } from 'zod';
import type { Config } from './config.js';

export interface ToolContext {
  api: any;            // @actual-app/api module (injected; mocked in tests)
  config: Config;
}

export interface ToolDef {
  name: string;
  description: string;
  readOnly: boolean;                 // false => only registered when enableWrite
  inputSchema: ZodRawShape;          // Zod raw shape consumed by SDK registerTool
  outputSchema?: ZodRawShape;        // optional; enables SDK-side structuredContent validation
  /** Solo tools de escritura: se fusiona sobre los defaults de server.ts */
  annotations?: { destructiveHint?: boolean; idempotentHint?: boolean };
  handler: (input: any, ctx: ToolContext) => Promise<unknown>;
}
