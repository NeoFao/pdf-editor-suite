import { PageGeometry } from '../coords/PageGeometry';
import type { EditSession } from '../model/EditSession';
import { visiblePageIndices } from './layout';
import { TextLayer, type EditRequest } from './TextLayer';
import type { PtPoint } from '../coords/PageGeometry';

const GAP = 16;

export interface ViewerCallbacks {
  onEdit: (req: EditRequest) => void;
  onSelect: (pageIndex: number, runId: number) => void;
  onBackgroundClick: (pageIndex: number, at: PtPoint) => void;
  onMove: (pageIndex: number, runId: number, dxPt: number, dyPt: number) => void;
}

/** Renderiza páginas visibles (canvas del motor) con su capa de texto encima. */
export class Viewer {
  private wrappers: HTMLElement[] = [];
  private geoms: PageGeometry[] = [];
  private rendered = new Set<number>();
  private scale = 1;

  constructor(
    private readonly root: HTMLElement,
    private readonly session: EditSession,
    private readonly cb: ViewerCallbacks
  ) {
    this.layout();
    this.root.addEventListener('scroll', () => this.renderVisible());
    this.renderVisible();
    this.session.model.on('change', (pageIndex) => { this.rendered.delete(pageIndex); this.renderVisible(); });
    // Recarga completa (deshacer de borrar/insertar): reconstruir todo.
    this.session.model.onReload(() => this.rebuild());
  }

  private rebuild(): void {
    this.root.textContent = '';
    this.wrappers = [];
    this.geoms = [];
    this.rendered = new Set();
    this.layout();
    this.renderVisible();
  }

  private cssHeights(): number[] {
    return this.session.model.pages.map((p) => p.sizePt.heightPt * this.scale);
  }

  private layout(): void {
    for (const page of this.session.model.pages) {
      const w = document.createElement('div');
      w.className = 'page';
      w.dataset.page = String(page.index);
      Object.assign(w.style, {
        position: 'relative',
        margin: `0 auto ${GAP}px`,
        background: '#fff',
        boxShadow: '0 1px 6px rgba(0,0,0,.25)',
        width: `${page.sizePt.widthPt * this.scale}px`,
        height: `${page.sizePt.heightPt * this.scale}px`
      });
      // Clic en el fondo (no en un run) → insertar en ese punto.
      w.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('run')) return;
        const rect = w.getBoundingClientRect();
        const geom = this.geoms[page.index]!;
        const at = geom.cssToPt(e.clientX - rect.left, e.clientY - rect.top);
        this.cb.onBackgroundClick(page.index, at);
      });
      this.root.appendChild(w);
      this.wrappers.push(w);
      this.geoms.push(new PageGeometry(page.sizePt.widthPt, page.sizePt.heightPt, this.scale, page.rotation));
    }
  }

  private renderVisible(): void {
    const idx = visiblePageIndices(this.cssHeights(), GAP, this.root.scrollTop, this.root.clientHeight);
    for (const i of idx) {
      if (this.rendered.has(i)) continue;
      this.renderPage(i);
      this.rendered.add(i);
    }
  }

  private renderPage(i: number): void {
    const page = this.session.model.pages[i]!;
    const wrapper = this.wrappers[i]!;
    wrapper.textContent = '';
    const { width, height, data } = this.session.engine.renderPage(this.session.doc, i, this.scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.style.display = 'block';
    const img = new ImageData(width, height);
    img.data.set(data);
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    wrapper.appendChild(canvas);
    const layer = document.createElement('div');
    layer.className = 'text-layer';
    Object.assign(layer.style, { position: 'absolute', inset: '0' });
    wrapper.appendChild(layer);
    const geom = this.geoms[i]!;
    new TextLayer(layer, page, geom, {
      onEdit: this.cb.onEdit,
      onSelect: this.cb.onSelect,
      onMove: (pageIndex, runId, dxCss, dyCss) => {
        // La conversión pt es afín: el delta no depende del punto base.
        const o = geom.cssToPt(0, 0);
        const d = geom.cssToPt(dxCss, dyCss);
        this.cb.onMove(pageIndex, runId, d.xPt - o.xPt, d.yPt - o.yPt);
      }
    });
  }
}
