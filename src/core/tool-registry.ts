// tool-registry.ts — recopila tools válidas aplicando el gating de escritura.
import type { ToolDef } from './types.js';

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export function collectTools(all: ToolDef[], enableWrite: boolean): ToolDef[] {
  for (const t of all) {
    if (!NAME_RE.test(t.name)) throw new Error(`Nombre de tool inválido: ${t.name}`);
  }
  return all.filter((t) => t.readOnly || enableWrite);
}
