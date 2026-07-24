import { describe, it, expect, vi } from 'vitest';
import * as path from 'node:path';
import {
  parseAbiMismatch,
  nativeAddonPath,
  checkNativeAbi,
} from '../../src/core/native-check.js';

// Mensaje real que Node lanza al hacer dlopen() de un .node compilado para otro
// NODE_MODULE_VERSION (capturado en scripts/electron-target.ts al verificar el
// bundle): el PRIMER número es el del módulo, el SEGUNDO el del runtime actual.
const MISMATCH_MESSAGE =
  "The module '/x/better_sqlite3.node'\nwas compiled against a different Node.js version using\n" +
  'NODE_MODULE_VERSION 146. This version of Node.js requires\nNODE_MODULE_VERSION 147.';

describe('parseAbiMismatch', () => {
  it('extrae compiladoPara (primer número) y runtime (segundo número)', () => {
    expect(parseAbiMismatch(MISMATCH_MESSAGE)).toEqual({ compiladoPara: 146, runtime: 147 });
  });

  it('no confunde el orden: el módulo va primero, el runtime después', () => {
    const resultado = parseAbiMismatch(MISMATCH_MESSAGE);
    expect(resultado!.compiladoPara).toBe(146);
    expect(resultado!.runtime).toBe(147);
    expect(resultado!.compiladoPara).not.toBe(resultado!.runtime);
  });

  it('devuelve null si el mensaje no es de desajuste de ABI', () => {
    expect(parseAbiMismatch('ENOENT: no such file or directory')).toBeNull();
  });

  it('devuelve null ante un mensaje vacío', () => {
    expect(parseAbiMismatch('')).toBeNull();
  });
});

describe('nativeAddonPath', () => {
  it('resuelve el binario dentro de node_modules/better-sqlite3/build/Release, relativo a la raíz del paquete', () => {
    const raiz = '/pkg/root';
    expect(nativeAddonPath(raiz)).toBe(
      path.join('/pkg/root', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
    );
  });

  it('sin argumento, resuelve contra la raíz real del paquete (dos niveles por encima de src/core)', () => {
    expect(nativeAddonPath()).toMatch(/node_modules[/\\]better-sqlite3[/\\]build[/\\]Release[/\\]better_sqlite3\.node$/);
  });
});

describe('checkNativeAbi', () => {
  it('devuelve ok:true cuando dlopen no lanza (el binario carga bien)', () => {
    const dlopen = vi.fn(() => {});
    const result = checkNativeAbi(dlopen, '/algun/path.node');
    expect(result).toEqual({ ok: true });
    expect(dlopen).toHaveBeenCalledWith('/algun/path.node');
  });

  it('devuelve ok:false con los dos números cuando dlopen lanza un desajuste de ABI', () => {
    const dlopen = vi.fn(() => {
      throw new Error(MISMATCH_MESSAGE);
    });
    const result = checkNativeAbi(dlopen, '/algun/path.node');
    expect(result).toEqual({ ok: false, compiladoPara: 146, runtime: 147 });
  });

  it('devuelve ok:true (no se puede comprobar) si dlopen lanza por otra causa, p.ej. el binario no existe', () => {
    const dlopen = vi.fn(() => {
      throw new Error("Cannot find module '/algun/path.node'");
    });
    const result = checkNativeAbi(dlopen, '/algun/path.node');
    expect(result).toEqual({ ok: true });
  });
});
