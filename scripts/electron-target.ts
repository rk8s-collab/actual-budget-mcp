// El servidor de una extensión .mcpb no corre bajo Node: Claude Desktop lo arranca como
// UtilityProcess de su propio Electron. El módulo nativo (better-sqlite3) tiene que estar
// compilado contra el ABI de ESE Electron; si viaja el binario de Node, el bundle instala
// bien pero la primera consulta muere con ERR_DLOPEN_FAILED y el presupuesto queda cerrado.
// Aquí vive la lógica pura de "¿para qué Electron compilamos y salió bien?".

/** Info.plist del Electron Framework de la app instalada, tal y como lo lee `plutil -p`. */
export const CLAUDE_ELECTRON_PLIST =
  '/Applications/Claude.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources/Info.plist';

export function parseElectronVersion(plutilOutput: string): string | null {
  const match = plutilOutput.match(/"CFBundleVersion"\s*=>\s*"(\d+\.\d+\.\d+)"/);
  return match ? match[1] : null;
}

export function resolveElectronTarget(opts: {
  override?: string | undefined;
  detected?: string | null;
}): string {
  const version = (opts.override ?? opts.detected ?? '').trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `No se pudo determinar la versión de Electron de Claude Desktop (valor: "${version}"). ` +
        `Instala Claude Desktop o fija la versión con ELECTRON_TARGET=x.y.z npm run bundle.`,
    );
  }
  return version;
}

/** ABI que prebuild-install dice haber instalado, leído del nombre del prebuild de electron. */
export function parsePrebuildAbi(prebuildOutput: string): number | null {
  const match = prebuildOutput.match(/-electron-v(\d+)-/);
  return match ? Number(match[1]) : null;
}

/**
 * Verifica el binario ya instalado. Se le pasa el error de hacerle dlopen con el Node que
 * empaqueta (o null si cargó): como ese Node tiene otro ABI, la carga DEBE fallar y el
 * mensaje debe delatar el ABI de Electron contra el que se compiló.
 */
export function describeAbiCheck(
  loadError: Error | null,
  expectedAbi: number,
): { ok: boolean; detail: string } {
  if (loadError === null) {
    return {
      ok: false,
      detail:
        'el binario nativo carga con el Node que empaqueta, así que está compilado para Node ' +
        'y no para el Electron de Claude Desktop',
    };
  }
  const compiledFor = loadError.message.match(
    /compiled against a different Node\.js version using\s+NODE_MODULE_VERSION (\d+)/,
  );
  if (!compiledFor) {
    return { ok: false, detail: `el binario nativo no se pudo verificar: ${loadError.message}` };
  }
  const abi = Number(compiledFor[1]);
  if (abi !== expectedAbi) {
    return {
      ok: false,
      detail: `el binario nativo declara NODE_MODULE_VERSION ${abi} y se esperaba ${expectedAbi}`,
    };
  }
  return { ok: true, detail: `binario nativo compilado para NODE_MODULE_VERSION ${abi} (Electron)` };
}
