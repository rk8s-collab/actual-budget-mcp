import { describe, it, expect } from 'vitest';
import { messagesFor, msg } from '../../src/core/messages.js';
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
