// native-check.ts — detecta un desajuste de ABI del módulo nativo (better-sqlite3)
// cuando la extensión .mcpb corre bajo un Electron distinto al que se compiló.
//
// El bundle (scripts/bundle.ts) recompila better-sqlite3 contra el Electron de Claude
// Desktop al empaquetar, pero eso queda fijado a esa versión: si Claude Desktop sube de
// versión MAYOR de Electron después, el ABI cambia y el binario deja de cargar con
// ERR_DLOPEN_FAILED. Ese fallo ocurre DENTRO de @actual-app/api (loot-core), así que lo
// único que ve el servidor es el síntoma genérico ("no se pudo abrir el presupuesto"),
// nunca la causa real. Esta comprobación repite el mismo truco que ya usa
// scripts/bundle.ts para verificar el binario al empaquetar: un dlopen() manual contra
// el propio .node, cuyo mensaje de error (si el ABI no coincide) declara los dos
// números — el ABI para el que se compiló y el del runtime actual.
//
// Lógica pura y testeable: dlopen y la ruta se reciben por parámetro, nada de acceso a
// fs ni al binario real desde aquí.
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// native-check.ts vive en src/core (dev) o dist/core (build): ../../ es la raíz del
// paquete en ambos casos (mismo cálculo que en config.ts).
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface AbiMismatch {
  /** NODE_MODULE_VERSION para el que se compiló el binario (primer número del mensaje). */
  compiladoPara: number;
  /** NODE_MODULE_VERSION que exige el runtime actual (segundo número del mensaje). */
  runtime: number;
}

/**
 * Analiza el mensaje de un dlopen fallido por ABI. Node lo escribe con el número del
 * MÓDULO primero y el del RUNTIME actual después, p.ej.:
 *   "...was compiled against a different Node.js version using
 *   NODE_MODULE_VERSION 146. This version of Node.js requires
 *   NODE_MODULE_VERSION 147."
 * Devuelve null si el mensaje no tiene esa forma (otro tipo de fallo al cargar: binario
 * ausente, corrupto, etc. — eso no es un desajuste de ABI y no se debe reportar como tal).
 */
export function parseAbiMismatch(mensaje: string): AbiMismatch | null {
  const coincidencia = mensaje.match(
    /NODE_MODULE_VERSION\s+(\d+)\.[\s\S]*?NODE_MODULE_VERSION\s+(\d+)/,
  );
  if (!coincidencia) return null;
  return { compiladoPara: Number(coincidencia[1]), runtime: Number(coincidencia[2]) };
}

/** Ruta del binario nativo de better-sqlite3, relativa a la raíz del paquete. */
export function nativeAddonPath(pkgRoot: string = PKG_ROOT): string {
  return path.join(pkgRoot, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
}

export type NativeCheckResult = { ok: true } | ({ ok: false } & AbiMismatch);

/**
 * Ejecuta la comprobación real. Recibe `dlopen` y la ruta del binario por parámetro para
 * poder testearla con dobles, sin depender del binario real ni de un dlopen de verdad.
 *
 * Si el binario no existe, o dlopen falla por cualquier otra causa que no sea un
 * desajuste de ABI, esto NO es un error: se trata como "no se puede comprobar" (ok:true)
 * y se sigue adelante — el mensaje legible que ya existe (budgetClosed) cubre el resto de
 * causas posibles.
 */
export function checkNativeAbi(
  dlopen: (addonPath: string) => void,
  addonPath: string,
): NativeCheckResult {
  try {
    dlopen(addonPath);
  } catch (err) {
    const desajuste = parseAbiMismatch((err as Error).message ?? '');
    if (desajuste) return { ok: false, ...desajuste };
  }
  return { ok: true };
}
