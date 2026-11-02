/**
 * Lógica PURA (sin tocar el sistema) para localizar procesos huérfanos de
 * este repo (E-062). La usa `scripts/liberar-puertos.mjs`; vive aparte para
 * poder probarla con datos falsos (`procesos-e2e.test.mjs`).
 *
 * Un proceso es "de este repo" solo si su nombre está en la lista blanca Y su
 * línea de comandos contiene la ruta del repo. Si no se conoce el nombre o la
 * línea de comandos, NO se cierra (resultado `desconocido`).
 */

const NOMBRES_PERMITIDOS = /^(node|vite|vitest|chrome-headless-shell|chrome)(\.exe)?$/i;

/** Para liberar un puerto: solo node o vite (el servidor de test); chrome/vitest no escuchan puertos de E2E. */
const NOMBRES_PERMITIDOS_PUERTO = /^(node|vite)(\.exe)?$/i;

/** Normaliza una ruta para comparar: barras /, minúsculas, sin barra final. */
export function normalizarRuta(ruta) {
  return String(ruta).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

const SEGMENTO_WORKTREE = '/.claude/worktrees/';

/**
 * ¿La línea de comandos cita OTRO worktree (o el checkout principal visto desde un worktree, o un worktree visto
 * desde el principal)? Solo mira rutas absolutas en la línea de comandos: el cwd no está en la lista de procesos
 * (E-113). Una ruta relativa (`node server.js`) no se puede atribuir y devuelve false.
 * @param {string|null} cmd
 * @param {string} raizRepo raíz del worktree/checkout que ejecuta el script
 */
export function perteneceAOtroWorktree(cmd, raizRepo) {
  if (!cmd) return false;
  const n = normalizarRuta(cmd);
  const r = normalizarRuta(raizRepo);
  // 1) Rutas de worktree citadas: la raíz de cada una acaba en `<segmento><nombre>`.
  let desde = 0;
  let citaWorktree = false;
  for (;;) {
    const i = n.indexOf(SEGMENTO_WORKTREE, desde);
    if (i < 0) break;
    citaWorktree = true;
    const ini = i + SEGMENTO_WORKTREE.length;
    let fin = ini;
    while (fin < n.length && !/[/"']/.test(n.charAt(fin))) fin++;
    const raizCitada = n.slice(0, fin);
    const nombre = n.slice(ini, fin);
    // Coincide con la nuestra si nuestra raíz acaba en el mismo `.claude/worktrees/<nombre>` y no hay más texto.
    const nuestra = r.endsWith(SEGMENTO_WORKTREE + nombre) && r.length <= raizCitada.length &&
      raizCitada.endsWith(r);
    if (!nuestra) return true;
    desde = fin;
  }
  if (citaWorktree) return false;
  // 2) Sin ruta de worktree: si somos un worktree, citar el checkout principal es ser de otro.
  const k = r.indexOf(SEGMENTO_WORKTREE);
  if (k > 0) {
    const principal = r.slice(0, k);
    let d = 0;
    for (;;) {
      const i = n.indexOf(principal, d);
      if (i < 0) return false;
      const c = n.charAt(i + principal.length);
      if (c === '' || /[/"']/.test(c)) return true;
      d = i + 1;
    }
  }
  return false;
}

/**
 * Decide qué PIDs que escuchan en un puerto se pueden matar. Pura: no toca el sistema.
 * Solo node/vite, con línea de comandos legible, que no estén protegidos ni sean de otro worktree.
 * @param {Array<number|string>} pids PIDs en escucha
 * @param {Array<{pid:number,nombre:string|null,cmd:string|null}>} procesos lista completa
 * @param {string} raizRepo
 * @param {Set<number>} protegidos
 * @returns {{matar:Array<object>, omitir:Array<{pid:number, nombre:string|null, motivo:string}>}}
 */
export function decidirLiberacionPuerto(pids, procesos, raizRepo, protegidos) {
  const porPid = new Map(procesos.map((p) => [p.pid, p]));
  const matar = [];
  const omitir = [];
  for (const crudo of pids) {
    const pid = Number(crudo);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    const p = porPid.get(pid);
    if (protegidos.has(pid)) omitir.push({ pid, nombre: p?.nombre ?? null, motivo: 'protegido' });
    else if (!p || !p.cmd || !p.nombre) omitir.push({ pid, nombre: p?.nombre ?? null, motivo: 'desconocido' });
    else if (!NOMBRES_PERMITIDOS_PUERTO.test(p.nombre)) omitir.push({ pid, nombre: p.nombre, motivo: 'no-permitido' });
    else if (perteneceAOtroWorktree(p.cmd, raizRepo)) omitir.push({ pid, nombre: p.nombre, motivo: 'otro-worktree' });
    else matar.push(p);
  }
  return { matar, omitir };
}

/**
 * Clasifica un proceso: 'repo' (cerrar), 'ajeno' (dejar) o 'desconocido'
 * (faltan nombre o línea de comandos: avisar y dejar).
 * @param {{pid:number, nombre:string|null, cmd:string|null}} p
 * @param {string} raizRepo
 */
export function clasificarProceso(p, raizRepo) {
  if (!p.nombre || !p.cmd) return 'desconocido';
  if (!NOMBRES_PERMITIDOS.test(p.nombre)) return 'ajeno';
  if (perteneceAOtroWorktree(p.cmd, raizRepo)) return 'ajeno';
  const raiz = normalizarRuta(raizRepo);
  const cmd = normalizarRuta(p.cmd);
  // La ruta debe terminar en "/", comilla o fin (no blanco: la ruta lleva espacios): ".../PDF Editor" no
  // debe casar con ".../PDF Editor 2" ni con ".../PDF Editorial".
  let desde = 0;
  for (;;) {
    const i = cmd.indexOf(raiz, desde);
    if (i < 0) return 'ajeno';
    const siguiente = cmd.charAt(i + raiz.length);
    if (siguiente === '' || /[/"']/.test(siguiente)) return 'repo';
    desde = i + 1;
  }
}

/**
 * Procesos a cerrar: los 'repo' menos los PID protegidos (el propio script y
 * sus ancestros: npm, la shell…). Devuelve también los desconocidos con nombre
 * permitido, para avisar de ellos. Los PID se validan como enteros positivos.
 * @param {Array<{pid:number, nombre:string|null, cmd:string|null}>} procesos
 * @param {string} raizRepo
 * @param {Set<number>} protegidos
 */
export function seleccionarHuerfanos(procesos, raizRepo, protegidos) {
  const cerrar = [];
  const desconocidos = [];
  for (const p of procesos) {
    if (!Number.isInteger(p.pid) || p.pid <= 0) continue;
    if (protegidos.has(p.pid)) continue;
    const c = clasificarProceso(p, raizRepo);
    if (c === 'repo') cerrar.push(p);
    else if (c === 'desconocido' && p.nombre && NOMBRES_PERMITIDOS.test(p.nombre)) desconocidos.push(p);
  }
  return { cerrar, desconocidos };
}

/** PIDs del propio proceso y de sus ancestros, según la lista pid→ppid. */
export function pidsProtegidos(procesos, pidPropio) {
  const padre = new Map(procesos.map((p) => [p.pid, p.ppid]));
  const protegidos = new Set([pidPropio]);
  let actual = padre.get(pidPropio);
  while (Number.isInteger(actual) && actual > 0 && !protegidos.has(actual)) {
    protegidos.add(actual);
    actual = padre.get(actual);
  }
  return protegidos;
}

/** Salida JSON de `Get-CimInstance Win32_Process | ConvertTo-Json` (Windows). */
export function parsearProcesosWindows(json) {
  let datos;
  try { datos = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(datos)) datos = datos ? [datos] : [];
  return datos.map((d) => ({
    pid: Number(d.ProcessId),
    ppid: Number(d.ParentProcessId),
    nombre: d.Name ?? null,
    cmd: d.CommandLine ?? null
  }));
}

/** Salida de `ps -eo pid=,ppid=,args=` (Unix/macOS). */
export function parsearProcesosUnix(texto) {
  const procesos = [];
  for (const linea of texto.split('\n')) {
    const m = linea.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    const cmd = m[3].trim();
    const primero = cmd.split(/\s+/)[0];
    procesos.push({ pid: Number(m[1]), ppid: Number(m[2]), nombre: primero.split('/').pop() || null, cmd });
  }
  return procesos;
}
