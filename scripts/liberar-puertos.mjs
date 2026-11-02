/**
 * Libera los puertos que usan los servidores de test E2E (por defecto 3100 app
 * vieja, 4173 app nueva, 4174 despliegue; con E2E_PUERTO_BASE se desplazan y
 * SOLO se liberan los desplazados — E-112; la lista sale de
 * scripts/puertos-e2e.mjs, la misma que usa playwright.config.js — E-062) y
 * cierra los procesos huérfanos de ESTE repo (node/vite/vitest/chrome cuya
 * línea de comandos cita la ruta del repo; nunca el propio script ni sus
 * ancestros). Pensado sobre todo para la app nueva: playwright.config.js fija
 * `reuseExistingServer: false` en su webServer (E-033), así que un
 * `vite preview` que quedó vivo de una sesión anterior hace que Playwright
 * falle con "puerto ya en uso" en vez de reconstruir. Este script lo libera
 * para que ese fallo no sea un obstáculo.
 *
 * SOLO mata el proceso que escucha en el puerto si su nombre es node o vite
 * (el propio `vite preview`, o `node server.js`), si se puede leer su línea de
 * comandos y si ésta no cita OTRO worktree ni el checkout principal (E-112).
 * Nunca mata un proceso ajeno: si no se puede identificar, avisa y lo deja
 * vivo. La decisión es una función pura (`decidirLiberacionPuerto`).
 *
 * Multiplataforma, sin dependencias externas: netstat + taskkill en Windows,
 * lsof + kill en el resto (Unix/macOS).
 *
 * Uso: `npm run e2e:liberar` (o `node scripts/liberar-puertos.mjs`). En un
 * worktree con puertos desplazados: `E2E_PUERTO_BASE=10000 npm run e2e:liberar`.
 * NO se llama desde `npm run verify`: matar procesos automáticamente en un
 * pipeline es invasivo. Es una herramienta manual para desatascar el entorno
 * local; el error de Playwright ya explica qué comando ejecutar.
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LISTA_PUERTOS_E2E } from './puertos-e2e.mjs';
import {
  parsearProcesosWindows, parsearProcesosUnix, pidsProtegidos, seleccionarHuerfanos, decidirLiberacionPuerto
} from './procesos-e2e.mjs';

// Misma lista que usa playwright.config.js (E-062): nunca una copia a mano.
const PUERTOS = LISTA_PUERTOS_E2E;
const RAIZ_REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const esWindows = process.platform === 'win32';

/** PIDs en escucha en `puerto`, vía `netstat -ano` (Windows). */
function pidsEnPuertoWindows(puerto) {
  let salida;
  try {
    salida = execSync('netstat -ano', { encoding: 'utf8' });
  } catch {
    return [];
  }
  const pids = new Set();
  for (const linea of salida.split('\n')) {
    const cols = linea.trim().split(/\s+/);
    // Formato: TCP  127.0.0.1:4173  0.0.0.0:0  LISTENING  12345
    if (cols.length < 5) continue;
    const [proto, local, , estado, pid] = cols;
    if (!/^TCP/i.test(proto)) continue;
    if (estado !== 'LISTENING') continue;
    if (!local.endsWith(`:${puerto}`)) continue;
    if (pid && pid !== '0') pids.add(pid);
  }
  return [...pids];
}

function matarWindows(pid) {
  execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
}

/** PIDs en escucha en `puerto`, vía `lsof` (Unix/macOS). */
function pidsEnPuertoUnix(puerto) {
  try {
    const salida = execSync(`lsof -ti :${puerto}`, { encoding: 'utf8' });
    return salida.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    // lsof sale con código != 0 cuando no hay nada escuchando: no es un error.
    return [];
  }
}

function matarUnix(pid) {
  execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
}

function liberarPuerto(puerto, procesos, protegidos) {
  // Los PIDs vienen de netstat/lsof, no de entrada de usuario, pero se
  // interpolan en comandos de shell (execSync): se validan como enteros
  // puros antes de usarlos en cualquier comando, defensa en profundidad
  // frente a una salida de sistema inesperada.
  const pids = (esWindows ? pidsEnPuertoWindows(puerto) : pidsEnPuertoUnix(puerto))
    .filter((pid) => /^\d+$/.test(pid));
  if (pids.length === 0) {
    console.log(`  puerto ${puerto}: libre`);
    return;
  }
  const { matar, omitir } = decidirLiberacionPuerto(pids, procesos ?? [], RAIZ_REPO, protegidos);
  for (const o of omitir) {
    console.warn(
      `  puerto ${puerto}: PID ${o.pid} (${o.nombre ?? 'nombre desconocido'}) no se mata (${o.motivo}). ` +
      'Si es un servidor de test tuyo, ciérralo a mano.'
    );
  }
  for (const p of matar) {
    try {
      if (esWindows) matarWindows(String(p.pid)); else matarUnix(String(p.pid));
      console.log(`  puerto ${puerto}: PID ${p.pid} (${p.nombre}) liberado`);
    } catch (e) {
      console.warn(`  puerto ${puerto}: no se pudo matar el PID ${p.pid}: ${e.message}`);
    }
  }
}

/** Lista todos los procesos (pid, ppid, nombre, línea de comandos). */
function listarProcesos() {
  try {
    if (esWindows) {
      const salida = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Process | ' +
        'Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"',
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      );
      return parsearProcesosWindows(salida);
    }
    return parsearProcesosUnix(
      execSync('ps -eo pid=,ppid=,args=', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    );
  } catch (e) {
    console.warn(`  no se pudo listar los procesos (${e.message.split('\n')[0]}): no se mata nada.`);
    return null;
  }
}

/** Cierra los procesos node/vite/vitest/chrome cuya línea de comandos cita este repo (no otro worktree). */
function liberarHuerfanos(procesos, protegidos) {
  if (!procesos) return;
  const { cerrar, desconocidos } = seleccionarHuerfanos(procesos, RAIZ_REPO, protegidos);
  for (const p of desconocidos) {
    console.warn(`  PID ${p.pid} (${p.nombre}): no se puede leer su línea de comandos — no se cierra.`);
  }
  if (cerrar.length === 0) {
    console.log('  procesos huérfanos de este repo: ninguno');
    return;
  }
  for (const p of cerrar) {
    try {
      // p.pid ya está validado como entero positivo en seleccionarHuerfanos.
      if (esWindows) matarWindows(String(p.pid)); else matarUnix(String(p.pid));
      console.log(`  huérfano PID ${p.pid} (${p.nombre}) cerrado`);
    } catch {
      // Puede haber muerto ya (hijo de otro huérfano cerrado antes).
      console.warn(`  huérfano PID ${p.pid} (${p.nombre}): no se pudo cerrar (¿ya terminó?)`);
    }
  }
}

// Sin la lista de procesos no se puede identificar a nadie: no se mata nada (listarProcesos ya avisó).
const procesos = listarProcesos();
const protegidos = procesos ? pidsProtegidos(procesos, process.pid) : new Set([process.pid]);
const base = process.env.E2E_PUERTO_BASE ? ` (E2E_PUERTO_BASE=${process.env.E2E_PUERTO_BASE})` : '';
console.log(`Liberando puertos de test E2E${base}: ${PUERTOS.join(', ')}...`);
for (const puerto of PUERTOS) liberarPuerto(puerto, procesos, protegidos);
console.log('Buscando procesos huérfanos de este repo...');
liberarHuerfanos(procesos, protegidos);
