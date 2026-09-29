/**
 * Libera los puertos que usan los servidores de test E2E (3100 app vieja,
 * 4173 app nueva) — pensado sobre todo para 4173: playwright.config.js fija
 * `reuseExistingServer: false` en el webServer de la app nueva (E-033), así
 * que un `vite preview` que quedó vivo de una sesión anterior hace que
 * Playwright falle con "puerto ya en uso" en vez de reconstruir. Este script
 * lo libera para que ese fallo no sea un obstáculo.
 *
 * SOLO mata el proceso que escucha en el puerto si su nombre es node o vite
 * (el propio `vite preview`, o `node server.js`). Nunca mata un proceso
 * ajeno: si no se puede averiguar su nombre, avisa y lo deja vivo.
 *
 * Multiplataforma, sin dependencias externas: netstat + taskkill en Windows,
 * lsof + kill en el resto (Unix/macOS).
 *
 * Uso: `npm run e2e:liberar` (o `node scripts/liberar-puertos.mjs`).
 * NO se llama desde `npm run verify`: matar procesos automáticamente en un
 * pipeline es invasivo. Es una herramienta manual para desatascar el entorno
 * local; el error de Playwright ya explica qué comando ejecutar.
 */
import { execSync } from 'node:child_process';

const PUERTOS = [4173, 3100];
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

/** Nombre del ejecutable de un PID en Windows (tasklist). */
function nombreProcesoWindows(pid) {
  try {
    const salida = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' });
    // "node.exe","12345","Console","1","45,678 K"
    const m = salida.match(/^"([^"]+)"/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
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

/** Nombre del comando de un PID en Unix (ps). */
function nombreProcesoUnix(pid) {
  try {
    const salida = execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' });
    return salida.trim() || null;
  } catch {
    return null;
  }
}

function matarUnix(pid) {
  execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
}

/**
 * ¿Es seguro matar este proceso? Solo node o vite. `vite preview` corre
 * dentro de un proceso node en ambas plataformas, así que basta con mirar el
 * nombre reportado por el sistema — nunca inspeccionamos la línea de
 * comandos completa, así que un `node` ajeno (que no sea un servidor de
 * este repo) también se libera si escucha en 4173/3100; es el límite
 * consciente de esta heurística: identifica el PUERTO correcto, no el
 * proceso exacto que arrancó Playwright.
 */
function esProcesoPermitido(nombre) {
  if (!nombre) return false;
  return /node|vite/i.test(nombre);
}

function liberarPuerto(puerto) {
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
  for (const pid of pids) {
    const nombre = esWindows ? nombreProcesoWindows(pid) : nombreProcesoUnix(pid);
    if (!esProcesoPermitido(nombre)) {
      console.warn(
        `  puerto ${puerto}: PID ${pid} (${nombre ?? 'nombre desconocido'}) no parece ` +
        'node/vite — no se mata. Si es un servidor de test, ciérralo a mano.'
      );
      continue;
    }
    try {
      if (esWindows) matarWindows(pid); else matarUnix(pid);
      console.log(`  puerto ${puerto}: PID ${pid} (${nombre}) liberado`);
    } catch (e) {
      console.warn(`  puerto ${puerto}: no se pudo matar el PID ${pid}: ${e.message}`);
    }
  }
}

console.log('Liberando puertos de test E2E (4173 app nueva, 3100 app vieja)...');
for (const puerto of PUERTOS) liberarPuerto(puerto);
