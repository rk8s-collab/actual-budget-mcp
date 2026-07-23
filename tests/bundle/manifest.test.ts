import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

describe('manifest.json', () => {
  it('declares MCPB schema 0.4 and the required root fields', () => {
    expect(manifest.manifest_version).toBe('0.4');
    for (const field of ['name', 'version', 'description', 'author', 'server']) {
      expect(manifest[field], `falta el campo obligatorio ${field}`).toBeDefined();
    }
  });

  it('keeps its version in sync with package.json', () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it('runs the built entry point with node', () => {
    expect(manifest.server.type).toBe('node');
    expect(manifest.server.entry_point).toBe('dist/index.js');
    expect(manifest.server.mcp_config.command).toBe('node');
    expect(manifest.server.mcp_config.args).toEqual(['${__dirname}/dist/index.js']);
  });

  it('targets macOS with Node >= 22', () => {
    expect(manifest.compatibility.platforms).toEqual(['darwin']);
    expect(manifest.compatibility.runtimes.node).toBe('>=22');
  });
});
