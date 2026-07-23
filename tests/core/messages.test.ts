import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';
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
  it('ningún .regex()/.uuid() de src/tools o src/core/types.ts deja el mensaje como cadena fija (incluye los anidados)', () => {
    // Enfoque ESTÁTICO en vez de parsear valores: el dinámico (parsear un string
    // contra cada campo de PRIMER NIVEL de inputSchema) no alcanza los mensajes
    // que viven dentro de un esquema anidado — p.ej. `MONTH` dentro de
    // `operations: z.array(z.object({ month: MONTH, ... }))` en set_budget.ts:
    // al parsear un string contra `operations`, Zod falla primero con SU propio
    // mensaje de "no es un array" y nunca llega a validar `month`. Leer el código
    // fuente cubre los anidados por construcción, sin depender de si el campo es
    // alcanzable desde fuera.
    const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const dirTools = path.join(raiz, 'src', 'tools');
    const archivos = readdirSync(dirTools)
      .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
      .map((f) => path.join(dirTools, f))
      .concat(path.join(raiz, 'src', 'core', 'types.ts'));

    const problemas: string[] = [];
    for (const archivo of archivos) {
      const codigo = readFileSync(archivo, 'utf8');
      for (const problema of localizarMensajesSinTraducir(codigo)) {
        problemas.push(`${path.relative(raiz, archivo)}: ${problema}`);
      }
    }
    expect(problemas).toEqual([]);
  });
});

/**
 * Recorre el código fuente buscando llamadas `.regex(...)` / `.uuid(...)` y
 * comprueba que, si llevan mensaje, esté envuelto en la función diferida
 * `{ error: () => ... }` en vez de ser una cadena fija (española o no).
 */
function localizarMensajesSinTraducir(codigo: string): string[] {
  const problemas: string[] = [];
  const patronLlamada = /\.(regex|uuid)\(/g;
  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = patronLlamada.exec(codigo))) {
    const metodo = coincidencia[1];
    const inicioArgumentos = coincidencia.index + coincidencia[0].length;
    const argumentos = extraerArgumentosBalanceados(codigo, inicioArgumentos);
    const llevaClaveError = /error\s*:/.test(argumentos);

    if (llevaClaveError) {
      // Lleva la clave, pero ¿su valor es de verdad una función diferida?
      if (!/error\s*:\s*\(\s*\)\s*=>/.test(argumentos)) {
        problemas.push(`${metodo}(${resumir(argumentos)}) — "error:" no es una función diferida`);
      }
      continue;
    }

    // Sin clave "error:": para .regex() descartamos el literal de expresión
    // regular (primer argumento) y miramos si queda algo más (un segundo
    // argumento, aunque sea una cadena fija sin envolver).
    const resto = metodo === 'regex' ? quitarLiteralRegexInicial(argumentos) : argumentos.trim();
    if (resto.length > 0) {
      problemas.push(`${metodo}(${resumir(argumentos)}) — mensaje como cadena fija, sin función diferida`);
    }
  }
  return problemas;
}

/** Extrae el texto de los argumentos de una llamada ya abierta (tras el "(" inicial),
 * respetando el anidamiento de paréntesis/llaves/corchetes y sin dejar que los que
 * aparezcan dentro de literales de cadena o de expresión regular (p.ej. `{4}` en
 * `/^\d{4}-\d{2}-\d{2}$/`) alteren el conteo de profundidad. */
function extraerArgumentosBalanceados(codigo: string, inicio: number): string {
  let profundidad = 1; // el "(" de apertura ya está consumido
  let i = inicio;
  while (i < codigo.length && profundidad > 0) {
    const c = codigo[i];
    if (c === '(' || c === '{' || c === '[') {
      profundidad++;
    } else if (c === ')' || c === '}' || c === ']') {
      profundidad--;
      if (profundidad === 0) break;
    } else if (c === "'" || c === '"' || c === '`') {
      const comilla = c;
      i++;
      while (i < codigo.length && codigo[i] !== comilla) {
        if (codigo[i] === '\\') i++;
        i++;
      }
    } else if (c === '/') {
      const previo = codigo.slice(0, i).trimEnd().slice(-1);
      // Solo tratamos "/" como inicio de regex si sigue a "(" o "," — en este
      // código controlado los regex siempre aparecen así, nunca como división.
      if (previo === '(' || previo === ',') {
        i++;
        while (i < codigo.length && codigo[i] !== '/') {
          if (codigo[i] === '\\') i++;
          i++;
        }
        while (i + 1 < codigo.length && /[a-z]/i.test(codigo[i + 1])) i++; // flags
      }
    }
    i++;
  }
  return codigo.slice(inicio, i);
}

/** Quita el literal de expresión regular inicial (y la coma que le sigue) de los
 * argumentos de un `.regex(...)`, dejando solo lo que venga después (si hay algo). */
function quitarLiteralRegexInicial(argumentos: string): string {
  const t = argumentos.trimStart();
  if (t[0] !== '/') return t; // no debería pasar: .regex() siempre empieza por el patrón
  let i = 1;
  while (i < t.length && t[i] !== '/') {
    if (t[i] === '\\') i++;
    i++;
  }
  i++; // saltar la barra de cierre
  while (i < t.length && /[a-z]/i.test(t[i])) i++; // flags de la regex
  let resto = t.slice(i).trimStart();
  if (resto.startsWith(',')) resto = resto.slice(1).trimStart();
  return resto.trim();
}

function resumir(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > 60 ? `${plano.slice(0, 60)}…` : plano;
}
