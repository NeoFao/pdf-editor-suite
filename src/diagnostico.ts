/**
 * Contadores de diagnóstico de SOLO LECTURA (E-043, docs/ERRORES-CONOCIDOS.md):
 * cuántas veces se llamó de verdad a `engine.getPageText()`/`engine.renderPage()`
 * durante una sesión — la forma de comprobar en un test E2E que un documento
 * grande no dispara esas llamadas para TODAS sus páginas al abrir o tras un
 * comando de una sola página.
 *
 * Apagados por defecto: solo se activan y se exponen en `window.__diagnostico`
 * cuando la URL lleva `?diagnostico=1` (ver `activarDiagnosticoSiCorresponde`,
 * llamada una vez desde `main.ts`), para no dejar ningún rastro en producción
 * ni coste alguno cuando nadie los pide.
 *
 * Este módulo es seguro de importar desde `src/model/**` (motor + sesión, sin
 * DOM — los tests unitarios de `tests/unit/**` lo cargan en Node): nunca toca
 * `window` salvo dentro de `activarDiagnosticoSiCorresponde`, que comprueba
 * que exista antes de usarlo.
 */
export interface ContadoresDiagnostico { renderPage: number; getPageText: number }

let activo = false;
export const contadores: ContadoresDiagnostico = { renderPage: 0, getPageText: 0 };

declare global {
  interface Window { __diagnostico?: ContadoresDiagnostico }
}

/** Llamada una vez al arrancar la app (`main.ts`): activa los contadores si `?diagnostico=1` está en la URL. */
export function activarDiagnosticoSiCorresponde(): void {
  if (typeof window === 'undefined') return;
  try {
    if (new URLSearchParams(window.location.search).get('diagnostico') !== '1') return;
    activo = true;
    window.__diagnostico = contadores;
  } catch {
    // location/URLSearchParams bloqueados en algún entorno embebido: sin
    // diagnóstico, la app sigue funcionando con normalidad.
  }
}

export function contarRenderPage(): void { if (activo) contadores.renderPage++; }
export function contarGetPageText(): void { if (activo) contadores.getPageText++; }

/** Solo para tests: reinicia el estado del módulo entre pruebas que lo activan a mano. */
export function _resetDiagnosticoParaTests(): void {
  activo = false;
  contadores.renderPage = 0;
  contadores.getPageText = 0;
}
