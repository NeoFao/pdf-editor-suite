import type { PdfEngine, DocHandle } from '../engine/PdfEngine';
import type { DocumentModel } from '../model/DocumentModel';
import { PageGeometry } from '../coords/PageGeometry';
import { visiblePageIndices } from './layout';
import { TextLayer, type EditRequest } from './TextLayer';

const GAP = 16;

/** Renderiza páginas visibles (canvas del motor) con su capa de texto encima. */
export class Viewer {
  private readonly wrappers: HTMLElement[] = [];
  private readonly rendered = new Set<number>();
  private scale = 1;

  constructor(
    private readonly root: HTMLElement,
    private readonly engine: PdfEngine,
    private readonly doc: DocHandle,
    private readonly model: DocumentModel,
    private readonly onEdit: (req: EditRequest) => void
  ) {
    this.layout();
    this.root.addEventListener('scroll', () => this.renderVisible());
    this.renderVisible();
    this.model.on('change', (pageIndex) => { this.rendered.delete(pageIndex); this.renderVisible(); });
  }

  setScale(scale: number): void { this.scale = scale; this.layout(); this.rendered.clear(); this.renderVisible(); }

  private cssHeights(): number[] {
    return this.model.pages.map((p) => p.sizePt.heightPt * this.scale);
  }

  private layout(): void {
    if (this.wrappers.length === 0) {
      for (const page of this.model.pages) {
        const w = document.createElement('div');
        w.className = 'page';
        w.dataset.page = String(page.index);
        w.style.position = 'relative';
        w.style.margin = `0 auto ${GAP}px`;
        w.style.background = '#fff';
        w.style.boxShadow = '0 1px 6px rgba(0,0,0,.25)';
        this.root.appendChild(w);
        this.wrappers.push(w);
      }
    }
    this.model.pages.forEach((page, i) => {
      const w = this.wrappers[i]!;
      w.style.width = `${page.sizePt.widthPt * this.scale}px`;
      w.style.height = `${page.sizePt.heightPt * this.scale}px`;
    });
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
    const page = this.model.pages[i]!;
    const wrapper = this.wrappers[i]!;
    wrapper.textContent = '';
    const { width, height, data } = this.engine.renderPage(this.doc, i, this.scale);
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
    const geom = new PageGeometry(page.sizePt.widthPt, page.sizePt.heightPt, this.scale, page.rotation);
    new TextLayer(layer, page, geom, this.onEdit);
  }
}
