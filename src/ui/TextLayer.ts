import type { PageModel } from '../model/types';
import type { PageGeometry } from '../coords/PageGeometry';

export interface EditRequest { pageIndex: number; runId: number; newText: string; oldText: string; el: HTMLElement }

/**
 * Capa de bloques de texto editables sobre una página. Cada run es un div
 * posicionado por PageGeometry. Al confirmar la edición llama a onEdit; quien
 * la recibe valida (motor) y decide si aplicar. El texto se pone con
 * textContent, nunca innerHTML (entrada no confiable).
 */
export class TextLayer {
  constructor(
    private readonly host: HTMLElement,
    private readonly page: PageModel,
    private readonly geom: PageGeometry,
    private readonly onEdit: (req: EditRequest) => void
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
      block.addEventListener('click', () => {
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
          this.onEdit({ pageIndex: this.page.index, runId: run.runId, newText, oldText, el: block });
        }
      };
      block.addEventListener('blur', commit);
      block.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); block.blur(); }
        if (e.key === 'Escape') { block.textContent = oldText; block.blur(); }
      });
      this.host.appendChild(block);
    }
  }
}
