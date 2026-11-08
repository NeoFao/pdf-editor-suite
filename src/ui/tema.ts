/**
 * Tema claro/oscuro (E-130). Por defecto sigue `prefers-color-scheme` (sin atributo en <html>);
 * el conmutador de la barra fija `data-theme="light"|"dark"` en <html> y lo recuerda en
 * `localStorage` (envuelto en try/catch: un origen con almacenamiento bloqueado no rompe la app).
 * Los colores viven en tema.css; aquí solo se elige cuál de los dos bloques de tokens aplica.
 */
export type Tema = 'light' | 'dark';

export const CLAVE_TEMA = 'pdf-editor:tema';

function leerGuardado(): Tema | null {
  try {
    const v = window.localStorage.getItem(CLAVE_TEMA);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

/** Aplica el tema guardado (si lo hay) antes de pintar la app. */
export function aplicarTemaGuardado(): void {
  const t = leerGuardado();
  if (t) document.documentElement.dataset.theme = t;
}

/** Tema que se ve ahora: el fijado a mano o, si no, el del sistema. */
export function temaEfectivo(): Tema {
  const fijado = document.documentElement.dataset.theme;
  if (fijado === 'light' || fijado === 'dark') return fijado;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Cambia al tema contrario del que se ve, lo recuerda y lo devuelve. */
export function alternarTema(): Tema {
  const nuevo: Tema = temaEfectivo() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = nuevo;
  try { window.localStorage.setItem(CLAVE_TEMA, nuevo); } catch { /* almacenamiento no disponible: solo esta sesión */ }
  return nuevo;
}
