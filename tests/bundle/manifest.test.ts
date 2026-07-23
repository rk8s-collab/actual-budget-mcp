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

import { allTools } from '../../src/tools/index.js';
import { loadConfig } from '../../src/core/config.js';

describe('manifest ↔ code consistency', () => {
  it('advertises exactly the registered tools', () => {
    const declared = (manifest.tools as Array<{ name: string }>).map((t) => t.name).sort();
    const registered = allTools.map((t) => t.name).sort();
    expect(declared).toEqual(registered);
  });

  it('gives every declared tool a description', () => {
    for (const tool of manifest.tools as Array<{ name: string; description?: string }>) {
      expect(tool.description, `${tool.name} sin description`).toBeTruthy();
    }
  });

  it('maps every user_config key to an env var the server actually reads', () => {
    const env = manifest.server.mcp_config.env as Record<string, string>;
    // Cada clave del formulario se referencia exactamente una vez en env
    for (const key of Object.keys(manifest.user_config)) {
      const refs = Object.values(env).filter((v) => v === '${user_config.' + key + '}');
      expect(refs, `user_config.${key} no está cableada en mcp_config.env`).toHaveLength(1);
    }
    // Y cada variable de entorno del manifiesto la entiende loadConfig
    const cfg = loadConfig({
      ACTUAL_SERVER_URL: 'https://actual.example.org/',
      ACTUAL_SERVER_PASSWORD: 'x',
      ACTUAL_SYNC_ID: '00000000-0000-0000-0000-000000000000',
      LOCALE: 'es-ES',
      CURRENCY: 'EUR',
      ENABLE_WRITE: 'true',
    });
    expect(cfg.locale).toBe('es-ES');
    expect(cfg.currency).toBe('EUR');
    expect(cfg.enableWrite).toBe(true);
  });

  it('does not expose ACTUAL_DATA_DIR in the form', () => {
    expect(Object.keys(manifest.user_config)).not.toContain('data_dir');
    expect(JSON.stringify(manifest.server.mcp_config.env)).not.toContain('ACTUAL_DATA_DIR');
  });

  it('defaults the write toggle to off', () => {
    expect(manifest.user_config.enable_write.default).toBe(false);
  });
});

describe('icon', () => {
  it('ships a 256x256 PNG next to the manifest', () => {
    const file = path.join(root, manifest.icon as string);
    const buf = readFileSync(file);
    // Cabecera PNG y dimensiones en el chunk IHDR (bytes 16-23, big-endian)
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBe(256);
    expect(buf.readUInt32BE(20)).toBe(256);
  });
});
