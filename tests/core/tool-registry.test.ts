import { describe, it, expect } from 'vitest';
import { collectTools } from '../../src/core/tool-registry.js';
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
});
