// messages.ts — mensajes de runtime en los dos idiomas.
// El español es el tipo de referencia: `const en: Messages` obliga al compilador a
// exigir cada clave y cada firma. Los mensajes con datos son funciones.
// NO entran aquí: los logs a stderr ni la validación de config (que corre antes
// de que exista config y por eso no puede consultar el idioma).
import type { Config } from './config.js';

const es = {
  invalidInput: 'Entrada inválida',
  dateFormat: 'Fecha en formato YYYY-MM-DD',
  monthFormat: 'Mes en formato YYYY-MM',
  mustBeUuid: 'Debe ser un UUID (usa get_accounts / get_categories / get_transactions para obtenerlos)',
};

export type Messages = typeof es;

const en: Messages = {
  invalidInput: 'Invalid input',
  dateFormat: 'Date in YYYY-MM-DD format',
  monthFormat: 'Month in YYYY-MM format',
  mustBeUuid: 'Must be a UUID (use get_accounts / get_categories / get_transactions to obtain them)',
};

const CATALOGUES: Record<'es' | 'en', Messages> = { es, en };

export function messagesFor(lang: 'es' | 'en'): Messages {
  return CATALOGUES[lang];
}

export function msg(config: Config): Messages {
  return messagesFor(config.messagesLang);
}

const MARKER = '@msg:';

/** Marca una clave para resolverla al formatear el error: los esquemas Zod se
 *  construyen al cargar el módulo, antes de que exista config. */
export function key<K extends keyof Messages>(k: K): string {
  return `${MARKER}${k}`;
}

export function resolveKeys(text: string, m: Messages): string {
  return text.replace(/@msg:([a-zA-Z]+)/g, (whole, k: string) => {
    const value = (m as Record<string, unknown>)[k];
    return typeof value === 'string' ? value : whole;
  });
}
