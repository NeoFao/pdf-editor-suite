import type { PageModel } from '../model/types';
import type { PageGeometry } from '../coords/PageGeometry';
import { cssFontFor } from './cssFontFor';

export interface EditRequest { pageIndex: number; runId: number; newText: string; oldText: string; el: HTMLElement }
export interface TextLayerCallbacks {
  onEdit: (req: EditRequest) => void;
  onSelect: (pageIndex: number, runId: number) => void;
  onMove: (pageIndex: number, runId: number, dxCss: number, dyCss: number) => void;
}

/**
 * Capa de bloques de texto editables sobre una página. Cada run es un div
 * posicionado por PageGeometry. Clic selecciona/edita; un tirador permite
 * arrastrarlo. El texto se pone con textContent, nunca innerHTML.
 *
 * E-029 — En reposo el `<div class="run">` es INVISIBLE (texto transparente,
 * sin fondo, tirador oculto): el motor (PDFium) ya pintó esa misma línea con
 * su fuente real en el `<canvas>` de debajo; esta capa solo aporta el hitbox
 * para seleccionar/editar/arrastrar — pintar el texto otra vez encima
 * duplicaba la línea en negro sans-serif. Los estados (reposo/hover/
 * seleccionada/edición) son CSS puro por clase (`.run`, `.selected`,
 * `.editing`, ver `index.next.html`); solo entrando en edición se fija en
 * línea la mejor aproximación tipográfica del run real (`cssFontFor` +
 * `run.color`), porque eso es dato del documento, no estado de UI — igual
 * que la geometría (left/top/tamaño), que siempre fue inline.
 */
export class TextLayer {
  constructor(
    private readonly host: HTMLElement,
    private readonly page: PageModel,
    private readonly geom: PageGeometry,
    private readonly cb: TextLayerCallbacks
  ) {
    this.build();
  }

  private build(): void {
    for (const run of this.page.runs) {
      const r = this.geom.rectPtToCss(run.boxPt);
      const block = document.createElement('div');
      block.className = 'run';
      block.dataset.runId = String(run.runId);
      block.textContent = run.text;
      // Solo geometría inline (E-029): el resto de la apariencia en reposo
      // (texto transparente, sin fondo) sale de la clase `.run` en CSS.
      Object.assign(block.style, {
        position: 'absolute',
        left: `${r.left}px`,
        top: `${r.top}px`,
        minWidth: `${r.width}px`,
        height: `${r.height}px`,
        lineHeight: `${r.height}px`
      });

      // Mejor aproximación tipográfica del run real, calculada una vez y
      // aplicada en línea SOLO mientras se edita (ver comentario de clase).
      // El tamaño sale de sizePt del PDF × la escala de la geometría, nunca
      // del alto de la caja (E-002).
      const sizeCss = run.sizePt * this.geom.scale;
      const editFont = cssFontFor(run.fontName, sizeCss);
      const editColor = `rgb(${run.color[0]}, ${run.color[1]}, ${run.color[2]})`;

      let oldText = run.text;
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        for (const el of Array.from(this.host.querySelectorAll<HTMLElement>('.run'))) el.classList.remove('selected');
        block.classList.add('selected');
        this.cb.onSelect(this.page.index, run.runId);
        if (block.isContentEditable) return;
        oldText = block.textContent ?? '';
        block.style.font = editFont;
        block.style.color = editColor;
        block.classList.add('editing');
        block.contentEditable = 'true';
        block.focus();
      });
      const commit = (): void => {
        if (!block.isContentEditable) return;
        block.contentEditable = 'false';
        block.classList.remove('editing');
        block.style.font = '';
        block.style.color = '';
        const newText = block.textContent ?? '';
        if (newText !== oldText) {
          this.cb.onEdit({ pageIndex: this.page.index, runId: run.runId, newText, oldText, el: block });
        }
      };
      block.addEventListener('blur', commit);
      block.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); block.blur(); }
        if (e.key === 'Escape') { block.textContent = oldText; block.blur(); }
      });

      block.appendChild(this.makeDragHandle(block, run.runId));
      this.host.appendChild(block);
    }
  }

  /** Tirador para arrastrar el bloque; dispara onMove al soltar. */
  private makeDragHandle(block: HTMLElement, runId: number): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'run-drag';
    // Posición/tamaño (geometría) inline; color, opacidad y visibilidad por
    // estado (reposo/hover/seleccionada) salen de la clase en CSS (E-029).
    Object.assign(handle.style, {
      position: 'absolute', left: '-9px', top: '-9px', width: '14px', height: '14px'
    });
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const baseLeft = parseFloat(block.style.left) || 0;
      const baseTop = parseFloat(block.style.top) || 0;
      const onMove = (ev: PointerEvent): void => {
        block.style.left = `${baseLeft + (ev.clientX - startX)}px`;
        block.style.top = `${baseTop + (ev.clientY - startY)}px`;
      };
      const onUp = (ev: PointerEvent): void => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (dx !== 0 || dy !== 0) this.cb.onMove(this.page.index, runId, dx, dy);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    return handle;
  }
}
