import { describe, it, expect } from 'vitest';
import { key, resolveKeys, messagesFor, msg } from '../../src/core/messages.js';
import { testConfig } from '../helpers/mock-api.js';

describe('catálogo de mensajes', () => {
  it('devuelve el español por defecto', () => {
    expect(msg({ ...testConfig, messagesLang: 'es' }).invalidInput).toBe('Entrada inválida');
  });
  it('devuelve el inglés cuando se pide', () => {
    expect(msg({ ...testConfig, messagesLang: 'en' }).invalidInput).toBe('Invalid input');
  });
  it('tiene exactamente las mismas claves en los dos idiomas', () => {
    // El compilador ya lo exige; esto protege de un `any` que se cuele.
    expect(Object.keys(messagesFor('en')).sort()).toEqual(Object.keys(messagesFor('es')).sort());
  });
  it('mantiene el tipo de cada entrada entre idiomas', () => {
    const es = messagesFor('es'), en = messagesFor('en');
    for (const k of Object.keys(es) as (keyof typeof es)[]) {
      expect(typeof en[k], `${k} cambia de tipo entre idiomas`).toBe(typeof es[k]);
    }
  });
});

describe('claves de mensaje en esquemas', () => {
  it('marca la clave de forma reconocible', () => {
    expect(key('dateFormat')).toBe('@msg:dateFormat');
  });
  it('resuelve la clave al idioma pedido', () => {
    expect(resolveKeys(key('dateFormat'), messagesFor('es'))).toBe('Fecha en formato YYYY-MM-DD');
    expect(resolveKeys(key('dateFormat'), messagesFor('en'))).toBe('Date in YYYY-MM-DD format');
  });
  it('deja intacto un texto que no es una clave', () => {
    expect(resolveKeys('Invalid input', messagesFor('en'))).toBe('Invalid input');
  });
  it('resuelve una clave incrustada en un texto mayor', () => {
    expect(resolveKeys(`date: ${key('dateFormat')}`, messagesFor('en'))).toBe('date: Date in YYYY-MM-DD format');
  });
  it('deja la marca tal cual si la clave no existe, en vez de romper', () => {
    expect(resolveKeys('@msg:noExiste', messagesFor('es'))).toBe('@msg:noExiste');
  });
  it('no deja ninguna marca sin resolver en los esquemas reales', async () => {
    const { allTools } = await import('../../src/tools/index.js');
    const declared = JSON.stringify(allTools.map((t) => t.inputSchema));
    for (const found of declared.match(/@msg:[a-zA-Z]+/g) ?? []) {
      const k = found.slice('@msg:'.length);
      expect(Object.keys(messagesFor('es'))).toContain(k);
    }
  });
});
