/**
 * Arranca el servidor de test E2E `next` o `deploy` en el puerto de `scripts/puertos-e2e.mjs`.
 *
 * `npm run preview:next` / `preview:deploy` pasan por aquí en vez de escribir 4173/4174 a mano en
 * package.json: así hay UNA sola fuente de puertos (E-062/E-065) y `e2e:liberar` los conoce todos.
 *
 *   node scripts/servir-preview.mjs next     # vite preview sobre dist/
 *   node scripts/servir-preview.mjs deploy   # scripts/servir-despliegue.mjs sobre dist-deploy/
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUERTOS_E2E } from './puertos-e2e.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Argumentos de `node` para el servidor `que`, o `null` si no existe. */
export function argumentosPreview(que) {
  if (que === 'next') {
    return [path.join(RAIZ, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview',
      '--port', String(PUERTOS_E2E.appNueva), '--host', '127.0.0.1', '--strictPort'];
  }
  if (que === 'deploy') {
    return [path.join(RAIZ, 'scripts', 'servir-despliegue.mjs'),
      '--port', String(PUERTOS_E2E.despliegue), '--dir', 'dist-deploy', '--config', 'vercel.json'];
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = argumentosPreview(process.argv[2]);
  if (!args) {
    console.error('Uso: node scripts/servir-preview.mjs <next|deploy>');
    process.exit(2);
  }
  const hijo = spawn(process.execPath, args, { cwd: RAIZ, stdio: 'inherit' });
  for (const senal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(senal, () => hijo.kill(senal));
  hijo.on('exit', (codigo) => process.exit(codigo ?? 1));
}
