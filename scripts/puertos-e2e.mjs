/**
 * Fuente ÚNICA de los puertos de los servidores de test E2E (E-062).
 *
 * Lo importan `playwright.config.js` (campo `port` de cada `webServer`) y
 * `scripts/liberar-puertos.mjs` (`npm run e2e:liberar`). Añadir un servidor
 * nuevo a Playwright exige darle puerto AQUÍ, y así `e2e:liberar` lo libera
 * sin tocar nada más. La regla `puertos-e2e-sincronizados` lo vigila.
 *
 * Sin efectos secundarios: solo datos.
 */
export const PUERTOS_E2E = Object.freeze({
  /** App vieja (`node server.js`), proyectos `escritorio` y `movil`. */
  appVieja: 3100,
  /** App nueva (`vite preview` sobre dist/), proyecto `next`. */
  appNueva: 4173,
  /** Despliegue (`scripts/servir-despliegue.mjs`), proyecto `deploy`. */
  despliegue: 4174
});

/** Lista plana de puertos, sin repetidos. */
export const LISTA_PUERTOS_E2E = Object.freeze([...new Set(Object.values(PUERTOS_E2E))]);
