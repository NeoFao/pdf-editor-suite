#!/usr/bin/env node
/**
 * Comprueba que `css/tailwind.min.css` corresponde al HTML y al JS actuales.
 *
 * El CSS compilado está versionado (no hay paso de build en despliegue), así
 * que si alguien añade una clase y no recompila, en producción esa clase no
 * existe: el código se lee bien y no pinta nada. Es el mismo agujero por el que
 * pasaron `border-3` y `backdrop-blur-xs` (E-022).
 *
 * Recompila a un temporal y compara. No toca el fichero del repo.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ACTUAL = path.join(RAIZ, 'css/tailwind.min.css');
const TEMPORAL = path.join(os.tmpdir(), `tailwind-check-${process.pid}.css`);

// Se invoca el CLI de Tailwind con node directamente, no vía `npx`: en Windows
// spawnSync sobre un `.cmd` falla con EINVAL salvo que se pida una shell, y
// pedirla abriría la puerta a inyección por la ruta del proyecto.
const CLI_TAILWIND = path.join(RAIZ, 'node_modules/tailwindcss/lib/cli.js');

try {
  execFileSync(
    process.execPath,
    [CLI_TAILWIND, '-i', './css/input.css', '-o', TEMPORAL, '--minify'],
    { cwd: RAIZ, stdio: 'pipe' }
  );
} catch (err) {
  console.error('No se pudo compilar Tailwind para comparar:');
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}

const esperado = fs.readFileSync(TEMPORAL, 'utf8');
const enRepo = fs.existsSync(ACTUAL) ? fs.readFileSync(ACTUAL, 'utf8') : '';
fs.rmSync(TEMPORAL, { force: true });

if (esperado.trim() === enRepo.trim()) {
  console.log('css/tailwind.min.css está al día.');
  process.exit(0);
}

console.error('\nFALLO  css/tailwind.min.css no corresponde al HTML/JS actuales.');
console.error(`  compilado ahora: ${esperado.length} bytes`);
console.error(`  en el repo:      ${enRepo.length} bytes`);
console.error('\n  Cómo arreglarlo: npm run build && git add css/tailwind.min.css');
console.error('  Sin esto, una clase nueva no existe en producción (E-022).\n');
process.exit(1);
