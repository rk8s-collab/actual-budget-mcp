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
 * comprueba que, si llevan mensaje, esté envuelto en una función diferida que
 * lea de verdad el catálogo (`activeMessages()`) en vez de ser una cadena fija
 * (española o no) colada dentro de `{ error: () => '...' }`.
 *
 * No basta con comprobar la FORMA `error: () => ...`: eso lo cumple también
 * `error: () => 'Fecha en formato YYYY-MM-DD'`, que es justo el error que
 * comete quien copia el patrón de al lado y mete el texto dentro. Por eso el
 * cuerpo de la función diferida se comprueba con `comprobarClaveError`, que
 * exige que invoque `activeMessages()`.
 *
 * Para no disparar falsos positivos con escrituras legítimas (patrón
 * extraído a una constante, `new RegExp(...)`, parámetros compartidos en un
 * objeto aparte), el argumento de mensaje se localiza por POSICIÓN tras
 * dividir los argumentos de nivel superior por comas — no por "lo que sobra
 * después del literal regex". Si ese argumento es un identificador, se busca
 * su definición (`const NOMBRE = {...}`) en el mismo fichero y se juzga igual.
 */
function localizarMensajesSinTraducir(codigo: string): string[] {
  const problemas: string[] = [];
  const patronLlamada = /\.(regex|uuid)\(/g;
  let coincidencia: RegExpExecArray | null;
  while ((coincidencia = patronLlamada.exec(codigo))) {
    const metodo = coincidencia[1] as 'regex' | 'uuid';
    const inicioArgumentos = coincidencia.index + coincidencia[0].length;
    const argumentos = extraerArgumentosBalanceados(codigo, inicioArgumentos);
    const partes = dividirArgumentosSuperior(argumentos);

    // .regex(patron, mensaje?): el primer argumento es el patrón, se ignora.
    // .uuid(mensaje?): el único argumento, si existe, es el mensaje/opciones.
    const argumentoMensaje = metodo === 'regex' ? partes[1] : partes[0];
    if (argumentoMensaje === undefined) continue; // sin segundo argumento: no hay mensaje que comprobar

    const problema = comprobarArgumentoMensaje(argumentoMensaje, codigo);
    if (problema) {
      problemas.push(`${metodo}(${resumir(argumentos)}) — ${problema}`);
    }
  }
  return problemas;
}

/**
 * Juzga el argumento de mensaje/opciones de una llamada `.regex()`/`.uuid()`.
 * Devuelve `null` si está bien (sin mensaje, o mensaje diferido que lee el
 * catálogo) o una descripción del problema si no.
 */
function comprobarArgumentoMensaje(argumento: string, codigoCompleto: string): string | null {
  const t = argumento.trim();
  if (t.length === 0) return null; // argumento vacío (p.ej. una coma colgante): nada que comprobar

  if (/^['"`]/.test(t)) {
    // Cadena fija directa como segundo argumento: `.regex(re, 'mensaje')`.
    return 'mensaje como cadena fija, sin función diferida';
  }

  if (t.startsWith('{')) {
    // Objeto de opciones inline: o bien no tiene clave "error" (es un mensaje
    // fijo colado por otra vía, p.ej. `{ message: '...' }`), o la tiene y hay
    // que comprobar que sea una función diferida que lea el catálogo.
    if (!/error\s*:/.test(t)) {
      return 'objeto de opciones sin clave "error" diferida (revisar si esconde un mensaje fijo)';
    }
    return comprobarClaveError(t);
  }

  const esIdentificador = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(t);
  if (esIdentificador) {
    // Identificador (p.ej. params compartidos en una constante aparte):
    // buscamos su definición en el mismo fichero para poder juzgarla igual.
    const definicion = buscarDefinicionConst(codigoCompleto, t);
    if (definicion === null) {
      return `identificador "${t}" no analizable estáticamente (revisar a mano que use activeMessages())`;
    }
    if (!/error\s*:/.test(definicion)) {
      return null; // objeto de parámetros sin clave "error": no es un mensaje, nada que reportar
    }
    return comprobarClaveError(definicion);
  }

  // Otra expresión no reconocida (llamada a función, propiedad, etc.): no es
  // analizable estáticamente con este método; no se marca para no generar
  // falsos positivos sobre construcciones legítimas que no podemos resolver.
  return null;
}

/** Comprueba que un texto con una clave `error:` la resuelva con una función
 * diferida que invoque `activeMessages()` — cubre tanto `() => ...` como la
 * firma `(issue) => ...` que documenta Zod 4. */
function comprobarClaveError(texto: string): string | null {
  if (/error\s*:\s*\([^)]*\)\s*=>[^,}]*activeMessages\(\)/.test(texto)) {
    return null;
  }
  return '"error:" no invoca activeMessages() (¿mensaje fijo o función no diferida?)';
}

/** Busca `const NOMBRE = {...}` (o `let`) en el código y devuelve el texto del
 * objeto literal asignado, o `null` si no se encuentra una definición así de
 * analizable (p.ej. viene de otro fichero, o no es un objeto literal). */
function buscarDefinicionConst(codigo: string, nombre: string): string | null {
  const patronDefinicion = new RegExp(`\\b(?:const|let)\\s+${nombre}\\s*(?::[^=]+)?=\\s*`);
  const coincidencia = patronDefinicion.exec(codigo);
  if (!coincidencia) return null;
  let i = coincidencia.index + coincidencia[0].length;
  while (i < codigo.length && /\s/.test(codigo[i])) i++;
  if (codigo[i] !== '{') return null;
  return extraerBloqueBalanceado(codigo, i);
}

/** Divide en argumentos de nivel superior (separados por comas fuera de
 * paréntesis/llaves/corchetes/cadenas/regex) el texto ya extraído de una
 * llamada. Descarta trozos vacíos (espacios entre comas). */
function dividirArgumentosSuperior(argumentos: string): string[] {
  const partes: string[] = [];
  let profundidad = 0;
  let inicio = 0;
  let i = 0;
  while (i < argumentos.length) {
    const c = argumentos[i];
    if (c === '(' || c === '{' || c === '[') {
      profundidad++;
    } else if (c === ')' || c === '}' || c === ']') {
      profundidad--;
    } else if (c === "'" || c === '"' || c === '`') {
      const comilla = c;
      i++;
      while (i < argumentos.length && argumentos[i] !== comilla) {
        if (argumentos[i] === '\\') i++;
        i++;
      }
    } else if (c === '/') {
      const previo = i === 0 ? '' : argumentos.slice(0, i).trimEnd().slice(-1);
      if (i === 0 || previo === '(' || previo === ',') {
        i++;
        while (i < argumentos.length && argumentos[i] !== '/') {
          if (argumentos[i] === '\\') i++;
          i++;
        }
        while (i + 1 < argumentos.length && /[a-z]/i.test(argumentos[i + 1])) i++;
      }
    } else if (c === ',' && profundidad === 0) {
      partes.push(argumentos.slice(inicio, i));
      inicio = i + 1;
    }
    i++;
  }
  partes.push(argumentos.slice(inicio));
  return partes.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Extrae un bloque delimitado por `(`/`{`/`[` respetando el anidamiento y
 * los literales de cadena, empezando EN el propio carácter de apertura
 * (a diferencia de `extraerArgumentosBalanceados`, que asume ya consumido). */
function extraerBloqueBalanceado(codigo: string, inicioApertura: number): string {
  let profundidad = 0;
  let i = inicioApertura;
  while (i < codigo.length) {
    const c = codigo[i];
    if (c === '(' || c === '{' || c === '[') {
      profundidad++;
    } else if (c === ')' || c === '}' || c === ']') {
      profundidad--;
      if (profundidad === 0) {
        i++;
        break;
      }
    } else if (c === "'" || c === '"' || c === '`') {
      const comilla = c;
      i++;
      while (i < codigo.length && codigo[i] !== comilla) {
        if (codigo[i] === '\\') i++;
        i++;
      }
    }
    i++;
  }
  return codigo.slice(inicioApertura, i);
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

function resumir(texto: string): string {
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > 60 ? `${plano.slice(0, 60)}…` : plano;
}
