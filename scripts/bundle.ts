// Empaqueta el servidor como MCP Bundle (.mcpb) instalable en Claude Desktop.
// Uso: npm run bundle  →  build/actual-budget-mcp-es.mcpb
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLAUDE_ELECTRON_PLIST,
  parseElectronVersion,
  resolveElectronTarget,
  parsePrebuildAbi,
  describeAbiCheck,
} from './electron-target.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const build = path.join(root, 'build');
const stage = path.join(build, 'stage');
// Binario local en vez de `npx mcpb`: en un clon recién hecho, si `npm run bundle` se
// lanza antes de `npm install`, `npx` descargaría en silencio otra versión del registro.
const mcpb = path.join(root, 'node_modules', '.bin', 'mcpb');

function run(cmd: string, args: string[], cwd = root) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
}

// 1. Compilar en un dist/ limpio: `tsc` nunca borra lo que ya hay, así que un .js
// huérfano de un fuente renombrado o eliminado sobreviviría y viajaría en el bundle.
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
run('npm', ['run', 'build']);

// 2. Escenario limpio
fs.rmSync(build, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

// 3. Copiar lo que va dentro del bundle (y nada más)
fs.cpSync(path.join(root, 'dist'), path.join(stage, 'dist'), { recursive: true });
for (const file of [
  'manifest.json',
  'package-lock.json',
  'icon.png',
  'README.md',
  'README.es.md',
  'PRIVACY.md',
  'PRIVACY.es.md',
  'LICENSE',
]) {
  fs.copyFileSync(path.join(root, file), path.join(stage, file));
}

// package.json del bundle: sin scripts. `prepare` ejecuta `npm run build`, y npm lo
// lanzaría durante el `npm ci` de abajo — en el escenario no hay ni src/ ni TypeScript.
// Las dependencias nativas (better-sqlite3) SÍ conservan sus scripts de instalación.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
delete pkg.scripts;
delete pkg.devDependencies;
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');

// 4. Solo dependencias de producción, con su binario nativo
run('npm', ['ci', '--omit=dev'], stage);
// package-lock.json solo hacía falta para `npm ci`; no viaja en el bundle
fs.rmSync(path.join(stage, 'package-lock.json'), { force: true });

// 5. Recompilar el módulo nativo contra el Electron de Claude Desktop.
// `npm ci` lo ha dejado compilado para el Node que ejecuta este script, que NO es el runtime
// donde va a correr la extensión: Claude Desktop la arranca como UtilityProcess de su Electron.
const detected = (() => {
  try {
    return parseElectronVersion(
      execFileSync('plutil', ['-p', CLAUDE_ELECTRON_PLIST], { encoding: 'utf8' }),
    );
  } catch {
    return null; // Claude Desktop no instalado: resolveElectronTarget da el mensaje accionable
  }
})();
const electronTarget = resolveElectronTarget({ override: process.env.ELECTRON_TARGET, detected });
console.error(`\nCompilando el módulo nativo para Electron ${electronTarget}…`);

const sqliteDir = path.join(stage, 'node_modules', 'better-sqlite3');
// prebuild-install informa por stderr: hacen falta los dos flujos para leer qué instaló.
const prebuild = spawnSync(
  path.join(stage, 'node_modules', '.bin', 'prebuild-install'),
  ['--runtime=electron', `--target=${electronTarget}`, '--arch=arm64', '--platform=darwin', '--verbose'],
  { cwd: sqliteDir, encoding: 'utf8' },
);
const prebuildOutput = `${prebuild.stdout ?? ''}${prebuild.stderr ?? ''}`;
const abi = prebuild.status === 0 ? parsePrebuildAbi(prebuildOutput) : null;
if (abi === null) {
  throw new Error(
    `prebuild-install no instaló un binario de electron para ${electronTarget}.\n${prebuildOutput}`,
  );
}

// 6. Verificar el binario que realmente viaja: se le hace dlopen con este Node, que tiene
// otro ABI, así que DEBE fallar declarando el ABI de Electron. Si cargara, el bundle
// llevaría el binario de Node y la extensión moriría con ERR_DLOPEN_FAILED al primer uso.
const addon = path.join(sqliteDir, 'build', 'Release', 'better_sqlite3.node');
let loadError: Error | null = null;
try {
  process.dlopen({ exports: {} } as NodeModule, addon);
} catch (err) {
  loadError = err as Error;
}
const check = describeAbiCheck(loadError, abi);
if (!check.ok) throw new Error(`El bundle llevaría un binario nativo inservible: ${check.detail}`);
console.error(`Verificado: ${check.detail}`);

// 7. Validar el manifiesto y empaquetar
run(mcpb, ['validate', path.join(stage, 'manifest.json')]);
const out = path.join(build, 'actual-budget-mcp-es.mcpb');
run(mcpb, ['pack', stage, out]);

// 8. Informe
const sizeMb = (fs.statSync(out).size / 1024 / 1024).toFixed(1);
console.error(`\nBundle listo: ${out} (${sizeMb} MB, Electron ${electronTarget} / ABI ${abi})`);
console.error('Instálalo arrastrándolo a Claude Desktop → Ajustes → Extensiones.');
