import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildToolResult, invalidInputResult, createServer } from '../../src/core/server.js';
import { messagesFor } from '../../src/core/messages.js';
import { testConfig } from '../helpers/mock-api.js';
import type { ToolDef } from '../../src/core/types.js';

describe('buildToolResult', () => {
  it('wraps payload as text + structuredContent', () => {
    const r = buildToolResult({ a: 1 }, { stale: false, lastSynced: '2026-07-21T10:00:00.000Z' });
    expect(r.content[0].type).toBe('text');
    expect(JSON.parse(r.content[0].text)).toEqual({ a: 1 });
    expect(r.structuredContent).toEqual({ a: 1 });
  });
  it('adds stale_data flags when stale', () => {
    const r = buildToolResult({ a: 1 }, { stale: true, lastSynced: '2026-07-20T09:00:00.000Z' });
    expect(r.structuredContent).toMatchObject({ a: 1, stale_data: true, last_synced: '2026-07-20T09:00:00.000Z' });
  });
  it('does not spread stale flags into array payloads', () => {
    const r = buildToolResult([{ a: 1 }], { stale: true, lastSynced: 'x' });
    expect(r.structuredContent).toEqual({ items: [{ a: 1 }], stale_data: true, last_synced: 'x' });
  });
});

describe('invalidInputResult', () => {
  const issues = [{ path: ['date'], message: 'Fecha en formato YYYY-MM-DD' }];
  it('titula el error en español por defecto', () => {
    const r: any = invalidInputResult(issues, messagesFor('es'));
    expect(JSON.parse(r.content[0].text).error.message).toBe('Entrada inválida');
  });
  it('titula el error en inglés cuando se pide', () => {
    const r: any = invalidInputResult(issues, messagesFor('en'));
    expect(JSON.parse(r.content[0].text).error.message).toBe('Invalid input');
  });
  it('conserva la ruta del campo en el hint', () => {
    const r: any = invalidInputResult(issues, messagesFor('es'));
    expect(JSON.parse(r.content[0].text).error.hint).toContain('date:');
  });
  it('marca el resultado como error', () => {
    expect((invalidInputResult(issues, messagesFor('es')) as any).isError).toBe(true);
  });
  it('no revienta cuando el path traía elementos no-string (p.ej. symbol) y ya llega normalizado', () => {
    // Zod 4 tipa path como PropertyKey[] (puede incluir symbols); i.path.join('.') lanza
    // TypeError si hay un symbol en el array. El punto de llamada (catch de createServer)
    // normaliza con i.path.map(String) antes de invocar invalidInputResult — String(symbol)
    // sí funciona ('Symbol(campo)'), lo que revienta es el join implícito con el symbol crudo.
    const pathConSimbolo: PropertyKey[] = [Symbol('campo'), 'anidado'];
    const issuesConSimbolo = [{ path: pathConSimbolo.map(String), message: 'algo falló' }];
    const r: any = invalidInputResult(issuesConSimbolo, messagesFor('es'));
    expect(() => JSON.parse(r.content[0].text)).not.toThrow();
    expect(JSON.parse(r.content[0].text).error.hint).toBe('Symbol(campo).anidado: algo falló');
  });
});

// createServer no tenía NINGÚN test (comprobado en la revisión: mutar
// `path: i.path.map(String)` por `path: i.path as any` en src/core/server.ts no rompía
// ningún test). Este bloque monta un McpServer real con una tool falsa que lanza un
// ZodError y lo invoca de punta a punta con un Client del SDK sobre un transporte en
// memoria — así se ejerce de verdad el `catch` de createServer, no solo invalidInputResult
// por separado (que es justo el agujero señalado por el revisor).
function fakeZodErrorTool(): ToolDef {
  return {
    name: 'fake_zod_error_tool',
    description: 'Tool de prueba que siempre lanza un ZodError',
    readOnly: true,
    inputSchema: { value: z.string() },
    handler: async () => {
      const innerSchema = z.object({ date: z.string() });
      // Provoca un ZodError real (no uno construido a mano) con path ['date'].
      innerSchema.parse({ date: 123 } as any);
      return {};
    },
  };
}

async function connectedClient(config: typeof testConfig) {
  const server = createServer({
    tools: [fakeZodErrorTool()],
    client: { ensureReady: async () => ({ stale: false, lastSynced: null }) } as any,
    api: {},
    config,
  });
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('createServer — idioma de los errores de validación', () => {
  it('responde en inglés cuando config.messagesLang es "en"', async () => {
    const client = await connectedClient({ ...testConfig, messagesLang: 'en' });
    const result: any = await client.callTool({ name: 'fake_zod_error_tool', arguments: { value: 'x' } });
    const body = JSON.parse(result.content[0].text);
    expect(body.error.message).toBe('Invalid input');
  });

  it('responde en español cuando config.messagesLang es "es"', async () => {
    const client = await connectedClient({ ...testConfig, messagesLang: 'es' });
    const result: any = await client.callTool({ name: 'fake_zod_error_tool', arguments: { value: 'x' } });
    const body = JSON.parse(result.content[0].text);
    expect(body.error.message).toBe('Entrada inválida');
  });

  it('conserva la ruta del campo en el hint', async () => {
    const client = await connectedClient({ ...testConfig, messagesLang: 'es' });
    const result: any = await client.callTool({ name: 'fake_zod_error_tool', arguments: { value: 'x' } });
    const body = JSON.parse(result.content[0].text);
    expect(body.error.hint).toContain('date:');
  });
});
