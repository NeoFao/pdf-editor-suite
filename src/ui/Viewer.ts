import { PageGeometry } from '../coords/PageGeometry';
import type { EditSession } from '../model/EditSession';
import { visiblePageIndices } from './layout';
import { TextLayer, type EditRequest } from './TextLayer';
import type { PtPoint } from '../coords/PageGeometry';
import type { RectPt } from '../engine/PdfEngine';

const GAP = 16;

export interface ViewerCallbacks {
  onEdit: (req: EditRequest) => void;
  onSelect: (pageIndex: number, runId: number) => void;
  onBackgroundClick: (pageIndex: number, at: PtPoint) => void;
  onMove: (pageIndex: number, runId: number, dxPt: number, dyPt: number) => void;
  onPageChange?: (pageIndex: number) => void;
  onStroke?: (pageIndex: number, points: PtPoint[]) => void;
  /** Campo de texto AcroForm confirmado (evento 'change', no tecla a tecla). */
  onFormText?: (pageIndex: number, annotIndex: number, value: string, oldValue: string) => void;
  /** Casilla AcroForm marcada/desmarcada. */
  onFormChecked?: (pageIndex: number, annotIndex: number, checked: boolean) => void;
  /** Selección de un combo o una lista confirmada (evento 'change'). `values` son las etiquetas elegidas. */
  onFormChoice?: (pageIndex: number, annotIndex: number, values: string[]) => void;
  /** Widget de un grupo de radio marcado. */
  onFormRadio?: (pageIndex: number, annotIndex: number) => void;
}

/** Renderiza páginas visibles (canvas del motor) con su capa de texto encima. */
export class Viewer {
  private wrappers: HTMLElement[] = [];
  private geoms: PageGeometry[] = [];
  private rendered = new Set<number>();
  private scale = 1;
  private highlights = new Map<number, RectPt[]>();
  private observer: IntersectionObserver | null = null;
  private currentPage = 0;
  private penMode = false;

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

  /** Cambia la escala (zoom) y vuelve a maquetar y renderizar. */
  setScale(scale: number): void {
    this.scale = scale;
    this.rebuild();
  }

  /** Desplaza el visor hasta la página indicada. */
  scrollToPage(i: number): void {
    this.wrappers[i]?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** Activa/desactiva el modo pluma (la capa de dibujo captura el puntero). */
  setPenMode(on: boolean): void {
    this.penMode = on;
    this.root.querySelectorAll('.pen-layer').forEach((el) => {
      (el as HTMLElement).style.pointerEvents = on ? 'auto' : 'none';
    });
  }

  /** Capa transparente por página que dibuja el trazo y emite los puntos en pt. */
  private attachPenCapture(pen: HTMLElement, pageIndex: number): void {
    let pts: Array<[number, number]> = [];
    let drawing = false;
    let preview: HTMLCanvasElement | null = null;
    const at = (e: PointerEvent): [number, number] => {
      const r = pen.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    pen.addEventListener('pointerdown', (e) => {
      drawing = true; pts = [at(e)]; pen.setPointerCapture(e.pointerId);
      preview = document.createElement('canvas');
      preview.width = pen.clientWidth; preview.height = pen.clientHeight;
      Object.assign(preview.style, { position: 'absolute', inset: '0' });
      pen.appendChild(preview);
    });
    pen.addEventListener('pointermove', (e) => {
      if (!drawing || !preview) return;
      pts.push(at(e));
      const ctx = preview.getContext('2d')!;
      ctx.clearRect(0, 0, preview.width, preview.height);
      ctx.strokeStyle = '#dc1414'; ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
    });
    const finish = (): void => {
      if (!drawing) return;
      drawing = false;
      preview?.remove(); preview = null;
      if (pts.length >= 2) {
        const geom = this.geoms[pageIndex]!;
        const ptPts = pts.map(([x, y]) => geom.cssToPt(x, y));
        this.cb.onStroke?.(pageIndex, ptPts);
      }
      pts = [];
    };
    pen.addEventListener('pointerup', finish);
    pen.addEventListener('pointercancel', finish);
  }

  private observeVisible(): void {
    this.observer?.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      let best: IntersectionObserverEntry | null = null;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
      }
      if (!best) return;
      const i = Number((best.target as HTMLElement).dataset.page);
      if (Number.isFinite(i) && i !== this.currentPage) {
        this.currentPage = i;
        this.cb.onPageChange?.(i);
      }
    }, { root: this.root, threshold: [0.2, 0.6] });
    for (const w of this.wrappers) this.observer.observe(w);
  }

  /** Fija las coincidencias de búsqueda a resaltar por página y las repinta. */
  setHighlights(byPage: Map<number, RectPt[]>): void {
    this.highlights = byPage;
    for (let i = 0; i < this.wrappers.length; i++) this.drawHighlights(i);
  }

  private drawHighlights(i: number): void {
    const wrapper = this.wrappers[i];
    if (!wrapper) return;
    wrapper.querySelector('.hl-layer')?.remove();
    const rects = this.highlights.get(i);
    if (!rects || rects.length === 0) return;
    const geom = this.geoms[i]!;
    const layer = document.createElement('div');
    layer.className = 'hl-layer';
    Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    for (const r of rects) {
      const c = geom.rectPtToCss(r);
      const box = document.createElement('div');
      box.className = 'search-hl';
      Object.assign(box.style, {
        position: 'absolute', left: `${c.left}px`, top: `${c.top}px`,
        width: `${c.width}px`, height: `${c.height}px`,
        background: 'rgba(250, 204, 21, .45)', outline: '1px solid #eab308'
      });
      layer.appendChild(box);
    }
    wrapper.appendChild(layer);
  }

  /** Marcadores de notas adhesivas (anotaciones reales); se leen del motor, no del modelo. */
  private drawNotes(i: number): void {
    const wrapper = this.wrappers[i];
    if (!wrapper) return;
    wrapper.querySelector('.note-layer')?.remove();
    const notes = this.session.engine.getNotes(this.session.doc, i);
    if (notes.length === 0) return;
    const geom = this.geoms[i]!;
    const layer = document.createElement('div');
    layer.className = 'note-layer';
    Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    for (const note of notes) {
      const c = geom.rectPtToCss(note.rectPt);
      const marker = document.createElement('div');
      marker.className = 'note-marker';
      marker.title = note.text;
      marker.setAttribute('aria-label', note.text);
      // El motor ya pinta el icono de la nota al renderizar la página (el bitmap
      // incluye las anotaciones): este marcador queda transparente y solo sirve
      // de zona accesible/hover sobre ese icono, para no dibujar uno encima del otro.
      marker.textContent = '';
      Object.assign(marker.style, {
        position: 'absolute', left: `${c.left}px`, top: `${c.top}px`,
        width: `${c.width}px`, height: `${c.height}px`,
        background: 'transparent',
        pointerEvents: 'auto', cursor: 'help'
      });
      layer.appendChild(marker);
    }
    wrapper.appendChild(layer);
  }

  /**
   * Campos AcroForm editables (texto, casilla, radio, combo y lista) sobre la
   * página. Unidades: `field.rectPt` está en puntos PDF (origen abajo-
   * izquierda); se convierte a px CSS de página con `geom.rectPtToCss`, igual
   * que el resto de capas (`drawHighlights`, `drawNotes`).
   *
   * El motor ya pinta el valor actual del campo al renderizar la página (su
   * apariencia /AP forma parte del bitmap, como el icono de las notas): si
   * además dibujáramos el control con fondo transparente se vería el valor
   * una vez desde el canvas y otra desde el control. Para evitarlo sin dejar
   * de usar controles nativos de verdad (que reciban teclado/ratón), el
   * `<input>`/`<select>` de texto/combo/lista lleva un fondo casi opaco que
   * tapa el render del motor debajo; el control es la única fuente visual de
   * "qué hay marcado/escrito ahora". Casilla y radio no lo necesitan: su
   * control nativo ya es un recuadro/círculo opaco de por sí (igual que en
   * fase 1 con la casilla).
   */
  private drawFormFields(i: number): void {
    const wrapper = this.wrappers[i];
    if (!wrapper) return;
    wrapper.querySelector('.form-layer')?.remove();
    const fields = this.session.engine.listFormFields(this.session.doc, i);
    if (fields.length === 0) return;
    const geom = this.geoms[i]!;
    const layer = document.createElement('div');
    layer.className = 'form-layer';
    Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    for (const field of fields) {
      // Botón y firma se listan en el motor pero no se dibujan (no editables desde aquí).
      if (field.kind !== 'text' && field.kind !== 'checkbox' && field.kind !== 'radio'
        && field.kind !== 'combo' && field.kind !== 'list') continue;
      const c = geom.rectPtToCss(field.rectPt);
      const posStyle = {
        position: 'absolute', left: `${c.left}px`, top: `${c.top}px`,
        width: `${c.width}px`, height: `${c.height}px`,
        boxSizing: 'border-box',
        pointerEvents: field.readOnly ? 'none' : 'auto'
      } as const;

      if (field.kind === 'text') {
        const input = document.createElement('input');
        input.className = 'form-field';
        input.dataset.fieldName = field.name;
        input.disabled = field.readOnly;
        Object.assign(input.style, posStyle);
        input.type = 'text';
        input.value = field.value;
        Object.assign(input.style, {
          font: `${Math.max(8, c.height * 0.7)}px sans-serif`,
          border: '1px solid #94a3b8',
          // Casi opaco: tapa el valor que el motor ya rasterizó debajo (ver comentario de la clase).
          background: 'rgba(255,255,255,0.95)'
        });
        const oldValue = field.value;
        input.addEventListener('change', () => {
          this.cb.onFormText?.(i, field.annotIndex, input.value, oldValue);
        });
        layer.appendChild(input);
      } else if (field.kind === 'checkbox') {
        const input = document.createElement('input');
        input.className = 'form-field';
        input.dataset.fieldName = field.name;
        input.disabled = field.readOnly;
        Object.assign(input.style, posStyle);
        input.type = 'checkbox';
        input.checked = field.checked;
        input.style.margin = '0';
        input.addEventListener('change', () => {
          this.cb.onFormChecked?.(i, field.annotIndex, input.checked);
        });
        layer.appendChild(input);
      } else if (field.kind === 'radio') {
        const input = document.createElement('input');
        input.className = 'form-field';
        input.dataset.fieldName = field.name;
        input.disabled = field.readOnly;
        Object.assign(input.style, posStyle);
        input.type = 'radio';
        // Prefijo de página: agrupa los widgets del mismo campo entre sí sin
        // colisionar con un campo del mismo nombre en otra página.
        input.name = `p${i}-${field.name}`;
        if (field.exportValue !== undefined) input.value = field.exportValue;
        input.checked = field.checked;
        input.style.margin = '0';
        input.addEventListener('change', () => {
          this.cb.onFormRadio?.(i, field.annotIndex);
        });
        layer.appendChild(input);
      } else {
        // combo o list
        const select = document.createElement('select');
        select.className = 'form-field';
        select.dataset.fieldName = field.name;
        select.disabled = field.readOnly;
        Object.assign(select.style, posStyle);
        Object.assign(select.style, {
          font: `${Math.max(8, Math.min(c.height, 18) * 0.65)}px sans-serif`,
          border: '1px solid #94a3b8',
          background: 'rgba(255,255,255,0.95)'
        });
        if (field.kind === 'list') {
          select.multiple = field.multiSelect;
          select.size = Math.max(1, field.options.length);
        }
        for (const opt of field.options) {
          const optionEl = document.createElement('option');
          optionEl.textContent = opt.label;
          optionEl.value = opt.value;
          optionEl.selected = opt.selected;
          select.appendChild(optionEl);
        }
        select.addEventListener('change', () => {
          const chosen = Array.from(select.selectedOptions).map((o) => o.value);
          this.cb.onFormChoice?.(i, field.annotIndex, chosen);
        });
        layer.appendChild(select);
      }
    }
    wrapper.appendChild(layer);
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
    this.observeVisible();
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
    this.drawHighlights(i); // conserva los resaltados tras un re-render
    this.drawNotes(i);
    this.drawFormFields(i);

    // Capa de captura de pluma (encima de todo; solo activa en modo pluma).
    const pen = document.createElement('div');
    pen.className = 'pen-layer';
    Object.assign(pen.style, { position: 'absolute', inset: '0', pointerEvents: this.penMode ? 'auto' : 'none', cursor: 'crosshair' });
    this.attachPenCapture(pen, i);
    wrapper.appendChild(pen);
  }
}
