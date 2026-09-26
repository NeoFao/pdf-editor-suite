import type { PageModel } from '../model/types';
import type { PageGeometry } from '../coords/PageGeometry';

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
      Object.assign(block.style, {
        position: 'absolute',
        left: `${r.left}px`,
        top: `${r.top}px`,
        minWidth: `${r.width}px`,
        height: `${r.height}px`,
        font: `${r.height}px sans-serif`,
        lineHeight: `${r.height}px`,
        cursor: 'text',
        whiteSpace: 'pre'
      });

      let oldText = run.text;
      block.addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.onSelect(this.page.index, run.runId);
        if (block.isContentEditable) return;
        oldText = block.textContent ?? '';
        block.contentEditable = 'true';
        block.focus();
      });
      const commit = (): void => {
        if (!block.isContentEditable) return;
        block.contentEditable = 'false';
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
    Object.assign(handle.style, {
      position: 'absolute', left: '-9px', top: '-9px', width: '14px', height: '14px',
      borderRadius: '50%', background: '#6366f1', cursor: 'move', border: '2px solid #fff'
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
