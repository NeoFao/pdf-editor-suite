/**
 * Registro único de un gesto de arrastre con puntero (E-034, ver
 * docs/ERRORES-CONOCIDOS.md). Todo gesto de esta app (mover/redimensionar
 * una imagen, arrastrar una línea de texto, reordenar una miniatura) sigue
 * el mismo patrón: `pointerdown` arma listeners de `pointermove`/`pointerup`
 * para terminar el gesto. El defecto: el navegador puede no entregar jamás
 * ese `pointerup` — un gesto táctil interrumpido por el scroll del sistema,
 * un cambio de pestaña o ventana, o la pérdida de la captura del puntero
 * mandan `pointercancel` en su lugar. Sin manejarlo, dos cosas se rompen a
 * la vez: los `removeEventListener` de `window`/`document` nunca llegan a
 * ejecutarse (fuga de listeners, §2.6, misma familia que E-014/E-020) y
 * cualquier estado temporal del gesto (vista previa de posición/tamaño,
 * `document.body.style.userSelect`, indicador de inserción) se queda a
 * medias hasta recargar la página.
 *
 * Este helper es el ÚNICO sitio de la app que engancha `pointermove`/
 * `pointerup`/`pointercancel` sobre `window` o `document` (la regla
 * determinista `gesto-con-cancelacion` lo exige) — todo gesto nuevo pasa por
 * aquí. `pointercancel` (o Escape, si `cancelarConEscape`) se trata siempre
 * como CANCELAR: `onCancel` deshace cualquier vista previa y NO debe
 * disparar ningún comando; `onUp` es la única vía que aplica el resultado.
 * `onSettle`, si se da, se llama SIEMPRE tras `onUp` u `onCancel` — para
 * limpieza común a ambos casos (p. ej. restaurar `userSelect`).
 */
export interface OpcionesGesto {
  onMove: (e: PointerEvent) => void;
  /** Soltar con normalidad: aplicar el resultado del gesto. */
  onUp: (e: PointerEvent) => void;
  /** Cancelado (pointercancel, o Escape si `cancelarConEscape`): deshacer la vista previa, sin aplicar nada. */
  onCancel: () => void;
  /** Limpieza común a `onUp` y `onCancel`, llamada siempre después de uno de los dos. */
  onSettle?: () => void;
  /** Elemento donde escuchar move/up/cancel. Por defecto `window` (el puntero casi siempre sale del elemento donde empezó el gesto). */
  target?: EventTarget;
  /** Si es true, Escape también cancela el gesto (p. ej. arrastrar una miniatura). */
  cancelarConEscape?: boolean;
}

/**
 * Nº de gestos armados por `registrarGesto()` que siguen sin resolverse
 * (ni `onUp` ni `onCancel` ni el terminador manual). Único contador
 * compartido de "hay un arrastre en curso en algún sitio" — lo consulta
 * `hayGestoEnCurso()` (E-045, docs/ERRORES-CONOCIDOS.md): el desalojo de
 * páginas lejanas del visor (`Viewer.evictFarPages`) no puede destruir el
 * DOM de una página mientras el usuario la está arrastrando (arrastrar una
 * línea de texto, mover/redimensionar una imagen, reordenar una miniatura —
 * los tres pasan por aquí), porque eso rompería el gesto a medias (foco/
 * captura de puntero sobre un nodo ya desconectado). Vive en este fichero
 * porque es el ÚNICO sitio permitido para enganchar pointermove/pointerup/
 * pointercancel (regla `gesto-con-cancelacion`) — cualquier otro sitio que
 * necesite "¿hay un gesto activo?" pregunta aquí, no vuelve a enganchar sus
 * propios listeners.
 */
let gestosActivos = 0;
export function hayGestoEnCurso(): boolean { return gestosActivos > 0; }

/**
 * Arma un gesto y devuelve una función para darlo por terminado desde
 * fuera SIN invocar `onCancel` ni `onUp` (limpieza silenciosa; no la usa
 * ningún llamante actual, pero cierra el caso "el componente se destruye a
 * mitad de gesto" sin dejar listeners colgados).
 */
export function registrarGesto(opts: OpcionesGesto): () => void {
  const target = opts.target ?? window;
  let activo = true;
  gestosActivos++;

  const quitarListeners = (): void => {
    target.removeEventListener('pointermove', onMove as EventListener);
    target.removeEventListener('pointerup', onUp as EventListener);
    target.removeEventListener('pointercancel', onCancel as EventListener);
    if (opts.cancelarConEscape) window.removeEventListener('keydown', onKeyDown);
    gestosActivos--;
  };

  const onMove = (e: Event): void => {
    if (!activo) return;
    opts.onMove(e as PointerEvent);
  };
  const onUp = (e: Event): void => {
    if (!activo) return;
    activo = false;
    quitarListeners();
    opts.onUp(e as PointerEvent);
    opts.onSettle?.();
  };
  const onCancel = (): void => {
    if (!activo) return;
    activo = false;
    quitarListeners();
    opts.onCancel();
    opts.onSettle?.();
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') onCancel();
  };

  target.addEventListener('pointermove', onMove as EventListener);
  target.addEventListener('pointerup', onUp as EventListener);
  target.addEventListener('pointercancel', onCancel as EventListener);
  if (opts.cancelarConEscape) window.addEventListener('keydown', onKeyDown);

  return (): void => {
    if (!activo) return;
    activo = false;
    quitarListeners();
  };
}
