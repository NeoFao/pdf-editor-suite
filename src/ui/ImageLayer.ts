import type { PageGeometry } from '../coords/PageGeometry';
import type { RectPt } from '../engine/PdfEngine';

export interface ImageBoxInfo { objIndex: number; rectPt: RectPt }

export interface ImageLayerCallbacks {
  onSelect: (pageIndex: number, objIndex: number) => void;
  /** Gesto completo (mover o redimensionar) terminado: rect final en puntos PDF. */
  onChangeRect: (pageIndex: number, objIndex: number, newRectPt: RectPt, oldRectPt: RectPt) => void;
}

/** Rect CSS (px de página), como lo devuelve `PageGeometry.rectPtToCss`. */
interface CssBox { left: number; top: number; width: number; height: number }

const MIN_SIZE_CSS = 10; // px CSS: tamaño mínimo durante el redimensionado, evita cajas degeneradas mientras se arrastra.

/**
 * Marco interactivo por imagen de página (sello/firma insertados, #20/#21
 * de la tabla de paridad §9). Un `.image-box` por imagen, posicionado con
 * `geom.rectPtToCss(img.rectPt)` — igual convención que `.run`/`.run-mask`
 * (E-029/E-030): en reposo invisible (sin borde, ver CSS en
 * index.next.html), solo el estado `.selected` pinta algo. Clic → selecciona
 * (borde índigo + 4 tiradores `.image-handle` en las esquinas, visibles solo
 * por CSS mientras está seleccionada). Arrastrar el marco → mover; arrastrar
 * un tirador → redimensionar. Vista previa en vivo moviendo el propio DOM;
 * SOLO al soltar se dispara `onChangeRect` con el rect final ya convertido a
 * puntos PDF (E-002: nada de lo que se lee durante el arrastre —posiciones
 * CSS del propio elemento— se usa para nada persistente hasta ese único
 * commit). Listeners globales de puntero atados al empezar cada gesto y
 * retirados al terminar (§2.6/E-020), igual que `TextLayer.makeDragHandle`.
 */
export class ImageLayer {
  constructor(
    private readonly host: HTMLElement,
    private readonly pageIndex: number,
    private readonly images: ImageBoxInfo[],
    private readonly geom: PageGeometry,
    private readonly cb: ImageLayerCallbacks,
    private readonly selectedObjIndex: number | null
  ) {
    this.build();
  }

  private build(): void {
    for (const img of this.images) {
      const r = this.geom.rectPtToCss(img.rectPt);
      const box = document.createElement('div');
      box.className = 'image-box';
      box.dataset.objIndex = String(img.objIndex);
      if (img.objIndex === this.selectedObjIndex) box.classList.add('selected');
      Object.assign(box.style, {
        position: 'absolute',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        pointerEvents: 'auto'
      });

      box.addEventListener('pointerdown', (e) => this.beginMove(e, box, img, r));
      for (const esquina of ['nw', 'ne', 'sw', 'se'] as const) {
        box.appendChild(this.makeHandle(esquina, box, img, r));
      }
      this.host.appendChild(box);
    }
  }

  /**
   * Suprime la selección de texto nativa del navegador durante un gesto de
   * arrastre. Sin esto, arrastrar el marco por encima de líneas de texto
   * (los `.run` de `TextLayer`, que sí contienen texto real aunque
   * transparente) dispara la selección nativa del navegador a lo largo del
   * recorrido del ratón — visible como una franja azul — aunque el gesto
   * empiece y termine sobre el propio marco. `preventDefault()`/
   * `stopPropagation()` en el `pointerdown` no bastan: la selección nativa
   * se arma por el recorrido del cursor sobre el documento, no por qué
   * elemento recibió el evento. Se restaura siempre al soltar.
   */
  private previousUserSelect: string | null = null;
  private suprimirSeleccionNativa(): void {
    this.previousUserSelect = document.body.style.userSelect;
    document.body.style.userSelect = 'none';
  }
  private restaurarSeleccionNativa(): void {
    document.body.style.userSelect = this.previousUserSelect ?? '';
    this.previousUserSelect = null;
  }

  private selectAndNotify(box: HTMLElement, objIndex: number): void {
    for (const el of Array.from(this.host.querySelectorAll<HTMLElement>('.image-box'))) el.classList.remove('selected');
    box.classList.add('selected');
    this.cb.onSelect(this.pageIndex, objIndex);
  }

  /** Inverso de `geom.rectPtToCss`: caja CSS de página (px) → rect en puntos PDF, robusto a rotación. */
  private cssRectToPt(left: number, top: number, width: number, height: number): RectPt {
    const a = this.geom.cssToPt(left, top);
    const b = this.geom.cssToPt(left + width, top + height);
    return {
      xPt: Math.min(a.xPt, b.xPt),
      yPt: Math.min(a.yPt, b.yPt),
      wPt: Math.abs(b.xPt - a.xPt),
      hPt: Math.abs(b.yPt - a.yPt)
    };
  }

  /** Arrastrar el marco entero: mueve (mismo rect, otra posición). */
  private beginMove(e: PointerEvent, box: HTMLElement, img: ImageBoxInfo, restRect: CssBox): void {
    if ((e.target as HTMLElement).classList.contains('image-handle')) return; // el tirador gestiona su propio gesto
    e.preventDefault();
    e.stopPropagation();
    this.selectAndNotify(box, img.objIndex);
    this.suprimirSeleccionNativa();
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    const onMove = (ev: PointerEvent): void => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
      box.style.left = `${restRect.left + dx}px`;
      box.style.top = `${restRect.top + dy}px`;
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this.restaurarSeleccionNativa();
      if (!moved) { box.style.left = `${restRect.left}px`; box.style.top = `${restRect.top}px`; return; }
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      const newRectPt = this.cssRectToPt(restRect.left + dx, restRect.top + dy, restRect.width, restRect.height);
      this.cb.onChangeRect(this.pageIndex, img.objIndex, newRectPt, img.rectPt);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /**
   * Tirador de esquina: redimensiona anclado a la esquina OPUESTA. Por
   * defecto conserva la proporción — como Acrobat al arrastrar una esquina
   * del marco de una imagen—; Mayús la libera (permite estirar libremente).
   * Es la convención inversa de la habitual (donde Mayús SUELE fijar la
   * proporción); se documenta aquí porque así lo pide el comportamiento de
   * referencia (Acrobat) que marca el objetivo de paridad de este PR.
   */
  private makeHandle(esquina: 'nw' | 'ne' | 'sw' | 'se', box: HTMLElement, img: ImageBoxInfo, restRect: CssBox): HTMLElement {
    const handle = document.createElement('div');
    handle.className = `image-handle image-handle-${esquina}`;
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selectAndNotify(box, img.objIndex);
      this.suprimirSeleccionNativa();
      const startX = e.clientX, startY = e.clientY;
      // Signo de cada delta según la esquina: cuánto crecen ancho/alto al
      // mover el ratón hacia afuera de la caja desde ESA esquina.
      const signW = esquina === 'ne' || esquina === 'se' ? 1 : -1;
      const signH = esquina === 'sw' || esquina === 'se' ? 1 : -1;
      let actual: CssBox = { ...restRect };
      const onMove = (ev: PointerEvent): void => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        let newW = restRect.width + signW * dx;
        let newH = restRect.height + signH * dy;
        if (!ev.shiftKey) {
          // Proporción conservada (comportamiento por defecto, ver comentario de clase):
          // domina el eje con mayor cambio relativo respecto al tamaño de reposo.
          const scaleW = newW / restRect.width, scaleH = newH / restRect.height;
          const scale = Math.abs(scaleW - 1) >= Math.abs(scaleH - 1) ? scaleW : scaleH;
          newW = restRect.width * scale;
          newH = restRect.height * scale;
        }
        newW = Math.max(MIN_SIZE_CSS, newW);
        newH = Math.max(MIN_SIZE_CSS, newH);
        let left = restRect.left, top = restRect.top;
        if (esquina === 'nw' || esquina === 'sw') left = restRect.left + restRect.width - newW;
        if (esquina === 'nw' || esquina === 'ne') top = restRect.top + restRect.height - newH;
        actual = { left, top, width: newW, height: newH };
        Object.assign(box.style, { left: `${left}px`, top: `${top}px`, width: `${newW}px`, height: `${newH}px` });
      };
      const onUp = (): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        this.restaurarSeleccionNativa();
        const newRectPt = this.cssRectToPt(actual.left, actual.top, actual.width, actual.height);
        this.cb.onChangeRect(this.pageIndex, img.objIndex, newRectPt, img.rectPt);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return handle;
  }
}
