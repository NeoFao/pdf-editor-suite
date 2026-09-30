/**
 * Helper común de diálogos modales (A-04/A-05, WCAG 2.1.2 y 2.4.3): todo panel
 * modal de `src/ui/` se abre con `mostrarModal`, que garantiza a la vez:
 *  - foco inicial DENTRO (lo hace `showModal()`; si nada es enfocable, el propio diálogo),
 *  - Tab / Shift+Tab atrapados entre el primer y el último control enfocables,
 *  - Escape cierra (evento `cancel` nativo del `<dialog>`; `puedeCerrar` lo puede vetar
 *    mientras hay una operación en curso),
 *  - al cerrar, el foco vuelve al elemento que abrió el diálogo,
 *  - `aria-modal="true"` y un nombre accesible (`aria-labelledby`).
 * Sin innerHTML: el llamador construye el contenido con nodos.
 */
const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface OpcionesModal {
  /** id del elemento que titula el diálogo (nombre accesible). */
  tituloId: string;
  /** Devuelve `false` para vetar el cierre por Escape (p. ej. operación en curso). */
  puedeCerrar?: () => boolean;
}

export function mostrarModal(dialog: HTMLDialogElement, opciones: OpcionesModal): void {
  const disparador = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', opciones.tituloId);

  dialog.addEventListener('cancel', (e) => {
    if (opciones.puedeCerrar && !opciones.puedeCerrar()) e.preventDefault();
  });

  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const lista = Array.from(dialog.querySelectorAll<HTMLElement>(ENFOCABLES)).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (lista.length === 0) { e.preventDefault(); return; }
    const primero = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    const activo = document.activeElement;
    if (e.shiftKey && (activo === primero || !dialog.contains(activo))) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && (activo === ultimo || !dialog.contains(activo))) { e.preventDefault(); primero.focus(); }
  });

  dialog.addEventListener('close', () => {
    dialog.remove();
    if (disparador?.isConnected) disparador.focus();
  });

  document.body.appendChild(dialog);
  dialog.showModal();
}
