import { describe, it, expect } from 'vitest';
import { collectTools } from '../../src/core/tool-registry.js';
import { messagesFor } from '../../src/core/messages.js';
import { allTools } from '../../src/tools/index.js';
import type { ToolDef } from '../../src/core/types.js';

const mk = (name: string, readOnly: boolean): ToolDef => ({
  name, description: name, readOnly, inputSchema: {}, handler: async () => ({}),
});

describe('collectTools', () => {
  const tools = [mk('get_a', true), mk('set_b', false), mk('get_c', true)];
  it('filters out write tools when enableWrite=false', () => {
    expect(collectTools(tools, false, messagesFor('es')).map((t) => t.name)).toEqual(['get_a', 'get_c']);
  });
  it('keeps all tools when enableWrite=true', () => {
    expect(collectTools(tools, true, messagesFor('es'))).toHaveLength(3);
  });
  it('rejects invalid tool names', () => {
    expect(() => collectTools([mk('bad.name', true)], true, messagesFor('es'))).toThrowError(/bad\.name/);
  });
  it('validates names of write-gated tools even when filtered out', () => {
    expect(() => collectTools([mk('bad.write', false)], false, messagesFor('es'))).toThrowError(/bad\.write/);
  });
  it('lanza el mensaje de error en el idioma que se le pasa (no cablea español)', () => {
    expect(() => collectTools([mk('bad.name', true)], true, messagesFor('en'))).toThrowError(/Invalid tool name/);
  });
});

describe('catalog (plan 3)', () => {
  it('ships 8 read + 10 write tools, write-gated', () => {
    expect(allTools).toHaveLength(18);
    expect(allTools.filter((t) => t.readOnly)).toHaveLength(8);
    expect(collectTools(allTools, false, messagesFor('es'))).toHaveLength(8);
    expect(collectTools(allTools, true, messagesFor('es'))).toHaveLength(18);
    expect(collectTools(allTools, false, messagesFor('es')).every((t) => t.readOnly)).toBe(true);
  });
  it('registra las tools de escritura en el catálogo', () => {
    expect(allTools.map((t) => t.name)).toContain('update_transaction');
    expect(allTools.map((t) => t.name)).toContain('categorize_transactions');
    expect(allTools.map((t) => t.name)).toContain('split_transaction');
    expect(allTools.map((t) => t.name)).toContain('create_transaction');
    expect(allTools.map((t) => t.name)).toContain('create_schedule');
    expect(allTools.map((t) => t.name)).toContain('set_budget');
    expect(allTools.map((t) => t.name)).toContain('transfer_budget');
    expect(allTools.map((t) => t.name)).toContain('update_category_note');
    expect(allTools.map((t) => t.name)).toContain('create_category_group');
    expect(allTools.map((t) => t.name)).toContain('update_category_group');
  });
});

describe('títulos de tools (Connectors Directory)', () => {
  it('cada tool declara un title no vacío', () => {
    for (const tool of allTools) {
      expect(tool.title, `${tool.name} sin title`).toBeTruthy();
      expect(tool.title.trim().length, `${tool.name} con title vacío`).toBeGreaterThan(0);
    }
  });

  it('el title es distinto del name (no un alias trivial)', () => {
    for (const tool of allTools) {
      expect(tool.title, `${tool.name}: title igual a name`).not.toBe(tool.name);
    }
  });

  it('no hay titles duplicados entre tools', () => {
    const titles = allTools.map((t) => t.title);
    expect(new Set(titles).size, 'hay titles repetidos').toBe(titles.length);
  });
});
