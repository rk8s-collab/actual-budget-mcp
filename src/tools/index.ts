// index.ts — catálogo de tools. Cada task de tool añade su import aquí.
import type { ToolDef } from '../core/types.js';
import { tool as getAccounts } from './get_accounts.js';

export const allTools: ToolDef[] = [getAccounts];
