import { describe, it, expect } from 'vitest';
import {
  parseElectronVersion,
  resolveElectronTarget,
  parsePrebuildAbi,
  describeAbiCheck,
} from '../../scripts/electron-target.js';

// Salida real de `plutil -p` sobre el Info.plist del Electron Framework de Claude Desktop.
const PLUTIL_OUTPUT = `{
  "CFBundleName" => "Electron Framework"
  "CFBundleVersion" => "42.7.0"
  "CFBundleIdentifier" => "com.github.Electron.framework"
}`;

describe('parseElectronVersion', () => {
  it('extrae la versión de Electron del Info.plist', () => {
    expect(parseElectronVersion(PLUTIL_OUTPUT)).toBe('42.7.0');
  });

  it('devuelve null si el plist no trae CFBundleVersion', () => {
    expect(parseElectronVersion('{\n  "CFBundleName" => "Electron Framework"\n}')).toBeNull();
  });
});

describe('resolveElectronTarget', () => {
  it('usa la versión detectada en Claude Desktop', () => {
    expect(resolveElectronTarget({ detected: '42.7.0' })).toBe('42.7.0');
  });

  it('deja forzar la versión por encima de la detectada', () => {
    expect(resolveElectronTarget({ override: '41.2.0', detected: '42.7.0' })).toBe('41.2.0');
  });

  it('falla con un mensaje accionable si no hay ninguna versión', () => {
    expect(() => resolveElectronTarget({ detected: null })).toThrow(/ELECTRON_TARGET/);
  });

  it('rechaza una versión que no sea x.y.z', () => {
    expect(() => resolveElectronTarget({ override: '42' })).toThrow(/42/);
  });
});

describe('parsePrebuildAbi', () => {
  it('lee el ABI del nombre del prebuild que descarga prebuild-install', () => {
    const output =
      'prebuild-install info looking for cached prebuild @ ' +
      '/Users/x/.npm/_prebuilds/0e3bca-better-sqlite3-v12.11.1-electron-v146-darwin-arm64.tar.gz';
    expect(parsePrebuildAbi(output)).toBe(146);
  });

  it('ignora los prebuilds de node: el bundle solo vale si es de electron', () => {
    const output = 'prebuild-install info unpacking @ better-sqlite3-v12.11.1-node-v147-darwin-arm64.tar.gz';
    expect(parsePrebuildAbi(output)).toBeNull();
  });
});

describe('describeAbiCheck', () => {
  // El binario nativo se compila contra el ABI de Electron, así que el Node que empaqueta
  // NO debe poder cargarlo: que cargue es la señal de que viajaría el binario equivocado.
  const mismatch = new Error(
    "The module '/x/better_sqlite3.node'\nwas compiled against a different Node.js version using\n" +
      'NODE_MODULE_VERSION 146. This version of Node.js requires\nNODE_MODULE_VERSION 147.',
  );

  it('acepta el binario cuando declara el ABI esperado', () => {
    expect(describeAbiCheck(mismatch, 146).ok).toBe(true);
  });

  it('rechaza el binario cuando declara otro ABI', () => {
    const check = describeAbiCheck(mismatch, 145);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/146/);
  });

  it('rechaza el binario si carga con el Node que empaqueta', () => {
    const check = describeAbiCheck(null, 146);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/Node/);
  });

  it('rechaza un fallo de carga que no sea de ABI', () => {
    const check = describeAbiCheck(new Error('file not found'), 146);
    expect(check.ok).toBe(false);
    expect(check.detail).toMatch(/file not found/);
  });
});
