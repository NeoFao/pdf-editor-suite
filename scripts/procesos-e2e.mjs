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

/** Normaliza una ruta para comparar: barras /, minúsculas, sin barra final. */
export function normalizarRuta(ruta) {
  return String(ruta).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
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
