// tool-registry.ts — recopila tools válidas aplicando el gating de escritura.
import type { ToolDef } from './types.js';
import type { Messages } from './messages.js';

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function collectTools(
  all: ToolDef[],
  enableWrite: boolean,
  m: Messages,
): ToolDef[] {
  for (const t of all) {
    if (!NAME_RE.test(t.name)) throw new Error(m.invalidToolName(t.name));
  }
  return all.filter((t) => t.readOnly || enableWrite);
}
