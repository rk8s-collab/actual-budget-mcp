import { describe, it, expect, afterEach } from 'vitest';
import { messagesFor, msg, setMessageLanguage, activeMessages } from '../../src/core/messages.js';
import { ID } from '../../src/core/types.js';
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

// El idioma activo es estado de módulo: restaurarlo o se contamina el resto del fichero.
afterEach(() => setMessageLanguage('es'));

describe('idioma activo', () => {
  it('arranca en español sin configurar nada', () => {
    expect(activeMessages().mustBeUuid).toBe(messagesFor('es').mustBeUuid);
  });
  it('cambia al idioma fijado', () => {
    setMessageLanguage('en');
    expect(activeMessages().mustBeUuid).toBe(messagesFor('en').mustBeUuid);
  });
});

describe('mensajes de esquema', () => {
  it('sale en español por defecto', () => {
    const r = ID.safeParse('no-es-uuid');
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe(messagesFor('es').mustBeUuid);
  });
  it('sale en inglés tras cambiar el idioma, con el MISMO esquema ya construido', () => {
    setMessageLanguage('en');
    const r = ID.safeParse('no-es-uuid');
    expect(r.error!.issues[0].message).toBe(messagesFor('en').mustBeUuid);
  });
  it('ninguna tool deja un mensaje de esquema sin traducir', async () => {
    // Muerde de verdad: parsea un valor inválido contra cada campo y compara los
    // mensajes en los dos idiomas. Si un campo se quedó con un literal español
    // fijo, sale idéntico en ambos y falla aquí.
    const { allTools } = await import('../../src/tools/index.js');
    const sospechosos: string[] = [];
    for (const tool of allTools) {
      for (const [campo, esquema] of Object.entries(tool.inputSchema as Record<string, any>)) {
        setMessageLanguage('es');
        const es = esquema.safeParse('valor-invalido-a-proposito');
        if (es.success) continue;
        setMessageLanguage('en');
        const en = esquema.safeParse('valor-invalido-a-proposito');
        const mEs = es.error.issues[0].message, mEn = en.error!.issues[0].message;
        // Solo interesan los mensajes NUESTROS: los que genera Zod salen igual en
        // ambos idiomas y no son responsabilidad de esta tarea.
        if (mEs === mEn && /^(Fecha|Mes|Debe ser)/.test(mEs)) sospechosos.push(`${tool.name}.${campo}: ${mEs}`);
      }
    }
    expect(sospechosos).toEqual([]);
  });
});
