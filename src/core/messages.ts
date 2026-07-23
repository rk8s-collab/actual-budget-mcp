// messages.ts — mensajes de runtime en los dos idiomas.
// El español es el tipo de referencia: `const en: Messages` obliga al compilador a
// exigir cada clave y cada firma. Los mensajes con datos son funciones.
// NO entran aquí: los logs a stderr ni la validación de config (que corre antes
// de que exista config y por eso no puede consultar el idioma).
import type { Config } from './config.js';

const es = {
  invalidInput: 'Entrada inválida',
};

export type Messages = typeof es;

const en: Messages = {
  invalidInput: 'Invalid input',
};

const CATALOGUES: Record<'es' | 'en', Messages> = { es, en };

export function messagesFor(lang: 'es' | 'en'): Messages {
  return CATALOGUES[lang];
}

export function msg(config: Config): Messages {
  return messagesFor(config.messagesLang);
}
