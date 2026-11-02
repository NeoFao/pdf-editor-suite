/**
 * Fuente ÚNICA de los puertos de los servidores de test E2E (E-062, E-113).
 *
 * Lo importan `playwright.config.js` (webServer y baseURL de cada proyecto),
 * `scripts/servir-preview.mjs` y `scripts/liberar-puertos.mjs`
 * (`npm run e2e:liberar`). Añadir un servidor nuevo a Playwright exige darle
 * puerto AQUÍ. La regla `puertos-e2e-sincronizados` lo vigila.
 *
 * Varios worktrees pueden correr Playwright a la vez si cada uno fija una
 * `E2E_PUERTO_BASE` distinta (p. ej. 10000, 20000): los tres puertos se
 * desplazan esa cantidad. Sin la variable, valen exactamente los de siempre
 * (así CI no cambia nada).
 *
 * Sin efectos secundarios: solo datos y funciones puras.
 */

/** Puertos por defecto (sin desplazamiento). */
export const PUERTOS_E2E_BASE = Object.freeze({
  /** App vieja (`node server.js`), proyectos `escritorio` y `movil`. */
  appVieja: 3100,
  /** App nueva (`vite preview` sobre dist/), proyecto `next`. */
  appNueva: 4173,
  /** Despliegue (`scripts/servir-despliegue.mjs`), proyecto `deploy`. */
  despliegue: 4174
});

/** Desplazamiento máximo: el mayor puerto por defecto (4174) + desplazamiento debe seguir siendo <= 65535. */
export const DESPLAZAMIENTO_MAXIMO = 65535 - 4174;

/**
 * Valida `E2E_PUERTO_BASE` y devuelve el desplazamiento (0 si no está definida o está vacía).
 * Lanza un Error claro si no es un entero decimal en [1, DESPLAZAMIENTO_MAXIMO].
 * @param {string|undefined} valor
 */
export function leerDesplazamiento(valor) {
  if (valor === undefined || valor === null || String(valor).trim() === '') return 0;
  const texto = String(valor).trim();
  const n = Number(texto);
  if (!/^\d+$/.test(texto) || !Number.isSafeInteger(n) || n < 1 || n > DESPLAZAMIENTO_MAXIMO) {
    throw new Error(
      `E2E_PUERTO_BASE="${valor}" no es válido: debe ser un entero entre 1 y ${DESPLAZAMIENTO_MAXIMO} ` +
      '(desplazamiento que se suma a 3100, 4173 y 4174; p. ej. 10000, 20000).'
    );
  }
  return n;
}

/**
 * Puertos de los tres servidores para un entorno dado. Puro y testeable.
 * @param {Record<string,string|undefined>} env
 */
export function calcularPuertosE2E(env = {}) {
  const d = leerDesplazamiento(env.E2E_PUERTO_BASE);
  const puertos = {};
  for (const [clave, base] of Object.entries(PUERTOS_E2E_BASE)) puertos[clave] = base + d;
  const valores = Object.values(puertos);
  if (new Set(valores).size !== valores.length || valores.some((p) => p < 1024 || p > 65535)) {
    throw new Error(`E2E_PUERTO_BASE="${env.E2E_PUERTO_BASE}" produce puertos inválidos o repetidos: ${valores.join(', ')}`);
  }
  return Object.freeze(puertos);
}

/** Puertos activos según el entorno del proceso actual. */
export const PUERTOS_E2E = calcularPuertosE2E(process.env);

/** Lista plana de puertos activos, sin repetidos. */
export const LISTA_PUERTOS_E2E = Object.freeze([...new Set(Object.values(PUERTOS_E2E))]);

/** `http://127.0.0.1:<puerto>` del servidor `clave` de PUERTOS_E2E. */
export function urlLocal(clave, puertos = PUERTOS_E2E) {
  return `http://127.0.0.1:${puertos[clave]}`;
}
