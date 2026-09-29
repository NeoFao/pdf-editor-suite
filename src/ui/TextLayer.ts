import type { PageModel } from '../model/types';
import type { PageGeometry } from '../coords/PageGeometry';
import { cssFontFor } from './cssFontFor';
import { measureFontAscent } from './measureFontAscent';
import { registrarGesto } from './gesto';

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
 *
 * E-030 — En reposo el bloque se posiciona con `run.boxPt` (la caja ajustada
 * a los glifos), pero esa caja casi nunca coincide con la línea base real:
 * al entrar en edición, el bloque se REPOSICIONA para que su línea base
 * coincida con `run.originPt` (el origen real de la línea de texto, en
 * puntos PDF) convertido a px CSS, con `line-height` calculado a partir del
 * ascenso/descenso medidos de la fuente (`measureFontAscent`) — no del alto
 * de `boxPt` ni de un `line-height` igual al tamaño de fuente, que arrastra
 * un "half-leading" desconocido y desalinea la base ~1-3 px (más que la
 * tolerancia de ±1.5 px exigida). Como el bloque se mueve, un elemento
 * `.run-mask` APARTE — posicionado siempre con la caja ORIGINAL `run.boxPt`,
 * nunca reposicionado — es quien garantiza que el texto original quede tapado
 * (E-002): el bloque puede moverse o cambiar de alto sin destapar nada.
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
      // Rect de reposo: SIEMPRE la caja original de los glifos (`run.boxPt`).
      // Es la geometría a la que el bloque vuelve al salir de edición y la
      // que usa la máscara — nunca se recalcula desde el DOM (E-002).
      const r = this.geom.rectPtToCss(run.boxPt);

      // Máscara aparte, fija en `r` para siempre: aunque el bloque se mueva
      // al entrar en edición (E-030), esto sigue tapando el texto original.
      const mask = document.createElement('div');
      mask.className = 'run-mask';
      Object.assign(mask.style, {
        position: 'absolute',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`
      });
      this.host.appendChild(mask);

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

        // E-030: reposiciona para que la línea base caiga exactamente en
        // `run.originPt` (px CSS de página, vía PageGeometry), no en el
        // borde superior de `boxPt`. `line-height` = ascenso + descenso
        // MEDIDOS de la fuente (no `sizeCss`): así el half-leading que el
        // navegador reparte arriba/abajo de la caja de línea es 0 y
        // `top = líneaBase - ascenso` cae justo en el borde superior real.
        const { ascentCss, descentCss } = measureFontAscent(editFont);
        const origin = this.geom.ptToCss(run.originPt.xPt, run.originPt.yPt);
        const baselineCss = origin.y;
        const lineHeightCss = ascentCss + descentCss;
        block.dataset.baselineCss = String(baselineCss);
        Object.assign(block.style, {
          left: `${origin.x}px`,
          top: `${baselineCss - ascentCss}px`,
          height: `${lineHeightCss}px`,
          lineHeight: `${lineHeightCss}px`
        });

        mask.classList.add('active');
        block.classList.add('editing');
        block.contentEditable = 'true';
        block.focus();
      });
      const commit = (): void => {
        if (!block.isContentEditable) return;
        block.contentEditable = 'false';
        block.classList.remove('editing');
        mask.classList.remove('active');
        block.style.font = '';
        block.style.color = '';
        delete block.dataset.baselineCss;
        // Restaura EXACTAMENTE la geometría de reposo (prueba de oro de
        // píxeles de fidelidad-reposo.spec.ts, también tras editar y cancelar).
        Object.assign(block.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          height: `${r.height}px`,
          lineHeight: `${r.height}px`
        });
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

  /**
   * Tirador para arrastrar el bloque; dispara onMove al soltar. Cancelado
   * (pointercancel — E-034, ver `registrarGesto`): restaura la posición de
   * reposo del bloque en el propio DOM y no dispara `onMove` — nada que
   * deshacer en el motor porque `onMove` es lo único que llega a ejecutar
   * un comando.
   */
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
      registrarGesto({
        onMove: (ev) => {
          block.style.left = `${baseLeft + (ev.clientX - startX)}px`;
          block.style.top = `${baseTop + (ev.clientY - startY)}px`;
        },
        onUp: (ev) => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (dx !== 0 || dy !== 0) this.cb.onMove(this.page.index, runId, dx, dy);
        },
        onCancel: () => {
          block.style.left = `${baseLeft}px`;
          block.style.top = `${baseTop}px`;
        }
      });
    });
    return handle;
  }
}
