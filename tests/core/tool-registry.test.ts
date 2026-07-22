import { describe, it, expect } from 'vitest';
import { collectTools } from '../../src/core/tool-registry.js';
import { allTools } from '../../src/tools/index.js';
import type { ToolDef } from '../../src/core/types.js';

const mk = (name: string, readOnly: boolean): ToolDef => ({
  name, description: name, readOnly, inputSchema: {}, handler: async () => ({}),
});

describe('collectTools', () => {
  const tools = [mk('get_a', true), mk('set_b', false), mk('get_c', true)];
  it('filters out write tools when enableWrite=false', () => {
    expect(collectTools(tools, false).map((t) => t.name)).toEqual(['get_a', 'get_c']);
  });
  it('keeps all tools when enableWrite=true', () => {
    expect(collectTools(tools, true)).toHaveLength(3);
  });
  it('rejects invalid tool names', () => {
    expect(() => collectTools([mk('bad.name', true)], true)).toThrowError(/bad\.name/);
  });
  it('validates names of write-gated tools even when filtered out', () => {
    expect(() => collectTools([mk('bad.write', false)], false)).toThrowError(/bad\.write/);
  });
});

describe('catalog', () => {
  it('keeps the 8 plan-1 read tools and gates write tools out when enableWrite=false', () => {
    const readTools = allTools.filter((t) => t.readOnly);
    expect(readTools).toHaveLength(8);
    const gated = collectTools(allTools, false);
    expect(gated).toHaveLength(8);
    expect(gated.every((t) => t.readOnly)).toBe(true);
  });
  it('registra las tools de escritura en el catálogo', () => {
    expect(allTools.map((t) => t.name)).toContain('update_transaction');
    expect(allTools.map((t) => t.name)).toContain('categorize_transactions');
  });
});
