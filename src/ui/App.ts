import { PdfiumEngine } from '../engine/pdfium/PdfiumEngine';
import { EditSession } from '../model/EditSession';
import { CommandBus } from '../commands/Command';
import { EditTextRunCmd } from '../commands/EditTextRun';
import { ReplaceRunFontCmd } from '../commands/ReplaceRunFont';
import { DeleteRunCmd } from '../commands/DeleteRun';
import { InsertTextCmd } from '../commands/InsertText';
import { MoveRunCmd } from '../commands/MoveRun';
import { SetColorCmd } from '../commands/SetColor';
import { RotatePageCmd } from '../commands/RotatePage';
import { DeletePageCmd } from '../commands/DeletePage';
import { MovePageCmd } from '../commands/MovePage';
import { InsertPdfCmd } from '../commands/InsertPdf';
import { DuplicatePageCmd } from '../commands/DuplicatePage';
import { InsertImageCmd } from '../commands/InsertImage';
import { AddNoteCmd } from '../commands/AddNote';
import { SetFormTextCmd } from '../commands/SetFormText';
import { SetFormCheckedCmd } from '../commands/SetFormChecked';
import { SetFormChoiceCmd } from '../commands/SetFormChoice';
import { SetFormRadioCmd } from '../commands/SetFormRadio';
import { HighlightRunCmd } from '../commands/HighlightRun';
import { UnderlineRunCmd } from '../commands/UnderlineRun';
import { StrikethroughRunCmd } from '../commands/StrikethroughRun';
import { DrawStrokeCmd } from '../commands/DrawStroke';
import { OcrPageCmd } from '../commands/OcrPage';
import { TesseractOcr } from '../ocr/TesseractOcr';
import { SignaturePad } from './SignaturePad';
import { parseRange } from './pageRange';
import { Viewer } from './Viewer';
import type { EditRequest } from './TextLayer';
import type { PtPoint } from '../coords/PageGeometry';
import type { RectPt } from '../engine/PdfEngine';

/** Orquesta motor + sesión + comandos + visor. Punto de entrada de la app nueva. */
export class App {
  private engine!: PdfiumEngine;
  private session: EditSession | null = null;
  private bus: CommandBus | null = null;
  private docName = 'documento.pdf';
  private insertMode = false;
  private penMode = false;
  private noteMode = false;
  private selection: { pageIndex: number; runId: number } | null = null;
  private viewer: Viewer | null = null;
  private scale = 1;
  private readonly viewerEl: HTMLElement;
  private readonly thumbsEl: HTMLElement;
  private readonly status: HTMLElement;
  private readonly pageIndicator: HTMLElement;
  private readonly btnInsert: HTMLButtonElement;
  private readonly btnPen: HTMLButtonElement;
  private readonly btnNote: HTMLButtonElement;
  private readonly btnOcr: HTMLButtonElement;
  private readonly colorInput: HTMLInputElement;
  private readonly searchInput: HTMLInputElement;
  private readonly rangeInput: HTMLInputElement;
  private currentPage = 0;

  constructor(rootEl: HTMLElement) {
    rootEl.textContent = '';
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    Object.assign(bar.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '8px', borderBottom: '1px solid #ccc', font: '14px sans-serif', flex: '0 0 auto' });

    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'application/pdf'; file.id = 'file-input';
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void this.openFile(f); });

    const openImg = document.createElement('input');
    openImg.type = 'file'; openImg.accept = 'image/*'; openImg.id = 'btn-open-image'; openImg.title = 'Abrir una imagen como PDF';
    openImg.addEventListener('change', () => { const f = openImg.files?.[0]; if (f) void this.openImage(f).finally(() => { openImg.value = ''; }); });

    this.btnInsert = this.button('Insertar texto', 'btn-insert', () => this.toggleInsert());
    const btnDelete = this.button('Borrar', 'btn-delete', () => this.deleteSelected());
    const btnHighlight = this.button('Resaltar', 'btn-highlight', () => this.highlightSelected());
    const btnUnderline = this.button('Subrayar', 'btn-underline', () => this.underlineSelected());
    const btnStrike = this.button('Tachar', 'btn-strike', () => this.strikeSelected());
    const btnSign = this.button('Firmar', 'btn-sign', () => this.openSignature());
    this.btnPen = this.button('Pluma', 'btn-pen', () => this.togglePen());
    this.btnNote = this.button('Nota', 'btn-note', () => this.toggleNote());
    this.btnOcr = this.button('OCR', 'btn-ocr', () => void this.runOcr());

    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color'; this.colorInput.id = 'btn-color'; this.colorInput.title = 'Color de la línea seleccionada';
    this.colorInput.addEventListener('input', () => this.applyColor());

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search'; this.searchInput.id = 'btn-search'; this.searchInput.placeholder = 'Buscar…';
    this.searchInput.addEventListener('input', () => this.search());

    const btnPrev = this.button('‹', 'btn-prev', () => this.goToPage(this.currentPage - 1));
    const btnNext = this.button('›', 'btn-next', () => this.goToPage(this.currentPage + 1));
    const btnRotate = this.button('Rotar ⟳', 'btn-rotate', () => { if (this.bus) void this.bus.execute(new RotatePageCmd(this.currentPage, 90)); });
    const btnDeletePage = this.button('Eliminar pág', 'btn-delete-page', () => this.deleteCurrentPage());
    const btnDuplicate = this.button('Duplicar', 'btn-duplicate', () => { if (this.bus) void this.bus.execute(new DuplicatePageCmd(this.currentPage)); });
    const btnPageUp = this.button('Subir', 'btn-page-up', () => this.moveCurrentPage(-1));
    const btnPageDown = this.button('Bajar', 'btn-page-down', () => this.moveCurrentPage(1));

    const insertPdf = document.createElement('input');
    insertPdf.type = 'file'; insertPdf.accept = 'application/pdf'; insertPdf.id = 'btn-insert-pdf'; insertPdf.title = 'Insertar otro PDF tras la página actual';
    insertPdf.addEventListener('change', () => { const f = insertPdf.files?.[0]; if (f) void this.handleInsertPdf(f).finally(() => { insertPdf.value = ''; }); });

    const insertImage = document.createElement('input');
    insertImage.type = 'file'; insertImage.accept = 'image/*'; insertImage.id = 'btn-insert-image'; insertImage.title = 'Insertar una imagen en la página actual';
    insertImage.addEventListener('change', () => { const f = insertImage.files?.[0]; if (f) void this.handleInsertImage(f).finally(() => { insertImage.value = ''; }); });
    this.pageIndicator = document.createElement('span');
    this.pageIndicator.id = 'page-indicator'; this.pageIndicator.style.font = '13px sans-serif'; this.pageIndicator.textContent = '– / –';

    const btnZoomOut = this.button('−', 'btn-zoom-out', () => this.zoom(1 / 1.25));
    const btnZoomIn = this.button('+', 'btn-zoom-in', () => this.zoom(1.25));
    const btnExtract = this.button('Extraer pág.', 'btn-extract', () => this.extractCurrent());
    this.rangeInput = document.createElement('input');
    this.rangeInput.type = 'text'; this.rangeInput.id = 'btn-range'; this.rangeInput.placeholder = '1-3,5'; this.rangeInput.size = 6;
    const btnSplit = this.button('Dividir', 'btn-split', () => this.splitByRange());
    const btnSave = this.button('Guardar', 'btn-save', () => this.save());
    const btnUndo = this.button('Deshacer', 'btn-undo', () => { void this.bus?.undo(); });
    const btnRedo = this.button('Rehacer', 'btn-redo', () => { void this.bus?.redo(); });

    this.status = document.createElement('span');
    this.status.id = 'status'; this.status.style.marginLeft = 'auto'; this.status.style.color = '#555';

    bar.append(file, openImg, this.btnInsert, btnDelete, btnHighlight, btnUnderline, btnStrike, btnSign, this.btnPen, this.btnNote, this.btnOcr, this.colorInput, this.searchInput, btnPrev, this.pageIndicator, btnNext, btnRotate, btnDeletePage, btnDuplicate, btnPageUp, btnPageDown, insertPdf, insertImage, btnZoomOut, btnZoomIn, btnExtract, this.rangeInput, btnSplit, btnSave, btnUndo, btnRedo, this.status);
    rootEl.appendChild(bar);

    // Área inferior: miniaturas (izquierda) + visor (derecha). Flex para que
    // siempre quede bajo la barra aunque esta ocupe varias filas.
    const area = document.createElement('div');
    Object.assign(area.style, { flex: '1', minHeight: '0', display: 'flex' });

    this.thumbsEl = document.createElement('div');
    this.thumbsEl.id = 'thumbs';
    Object.assign(this.thumbsEl.style, { width: '150px', flex: '0 0 150px', overflow: 'auto', background: '#3f4145', padding: '8px', boxSizing: 'border-box' });

    this.viewerEl = document.createElement('div');
    this.viewerEl.id = 'viewer';
    Object.assign(this.viewerEl.style, { flex: '1', overflow: 'auto', background: '#525659', padding: '16px' });

    area.append(this.thumbsEl, this.viewerEl);
    rootEl.appendChild(area);

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); void this.bus?.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); void this.bus?.redo(); }
    });
  }

  private button(label: string, id: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label; b.id = id; b.addEventListener('click', onClick);
    return b;
  }

  private toggleInsert(): void {
    this.insertMode = !this.insertMode;
    if (this.insertMode && this.penMode) { this.penMode = false; this.btnPen.style.background = ''; this.viewer?.setPenMode(false); }
    if (this.insertMode && this.noteMode) { this.noteMode = false; this.btnNote.style.background = ''; }
    this.btnInsert.style.background = this.insertMode ? '#c7d2fe' : '';
    this.setStatus(this.insertMode ? 'Modo insertar: haz clic donde quieras el texto.' : 'Modo insertar desactivado.');
  }

  private togglePen(): void {
    this.penMode = !this.penMode;
    if (this.penMode && this.insertMode) { this.insertMode = false; this.btnInsert.style.background = ''; }
    if (this.penMode && this.noteMode) { this.noteMode = false; this.btnNote.style.background = ''; }
    this.btnPen.style.background = this.penMode ? '#c7d2fe' : '';
    this.viewer?.setPenMode(this.penMode);
    this.setStatus(this.penMode ? 'Modo pluma: arrastra para dibujar.' : 'Modo pluma desactivado.');
  }

  private toggleNote(): void {
    this.noteMode = !this.noteMode;
    if (this.noteMode && this.insertMode) { this.insertMode = false; this.btnInsert.style.background = ''; }
    if (this.noteMode && this.penMode) { this.penMode = false; this.btnPen.style.background = ''; this.viewer?.setPenMode(false); }
    this.btnNote.style.background = this.noteMode ? '#c7d2fe' : '';
    this.setStatus(this.noteMode ? 'Modo nota: haz clic donde quieras la nota.' : 'Modo nota desactivado.');
  }

  private async ensureEngine(): Promise<PdfiumEngine> {
    if (!this.engine) this.engine = await PdfiumEngine.create();
    return this.engine;
  }

  async openFile(file: File): Promise<void> {
    await this.openBytes(new Uint8Array(await file.arrayBuffer()), file.name || 'documento.pdf');
  }

  /** Decodifica una imagen a RGBA usando el canvas del navegador. */
  private async decodeImage(file: File): Promise<{ rgba: Uint8Array; width: number; height: number }> {
    const bmp = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width; canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    const { data } = canvas.getContext('2d')!.getImageData(0, 0, bmp.width, bmp.height);
    return { rgba: new Uint8Array(data), width: bmp.width, height: bmp.height };
  }

  /** Abre una imagen convirtiéndola en un PDF de una página. */
  private async openImage(file: File): Promise<void> {
    const engine = await this.ensureEngine();
    const { rgba, width, height } = await this.decodeImage(file);
    const bytes = engine.imageToPdf(rgba, width, height);
    await this.openBytes(bytes, (file.name || 'imagen').replace(/\.[^.]+$/, '') + '.pdf');
    this.setStatus('Imagen abierta como PDF.');
  }

  private async openBytes(bytes: Uint8Array, name: string): Promise<void> {
    this.setStatus('Cargando…');
    const engine = await this.ensureEngine();
    if (this.session) engine.close(this.session.doc);
    this.docName = name;
    this.session = await EditSession.open(engine, bytes);
    this.bus = new CommandBus(this.session);
    this.selection = null;
    this.insertMode = false; this.penMode = false; this.noteMode = false;
    this.btnInsert.style.background = ''; this.btnPen.style.background = ''; this.btnNote.style.background = '';
    this.viewerEl.textContent = '';
    this.scale = 1;
    this.viewer = new Viewer(this.viewerEl, this.session, {
      onEdit: (req) => this.handleEdit(req),
      onSelect: (pageIndex, runId) => { this.selection = { pageIndex, runId }; this.reflectColor(); },
      onBackgroundClick: (pageIndex, at) => { this.handleBackgroundClick(pageIndex, at); },
      onMove: (pageIndex, runId, dxPt, dyPt) => { void this.bus?.execute(new MoveRunCmd(pageIndex, runId, dxPt, dyPt)); },
      onPageChange: (i) => { this.currentPage = i; this.updateIndicator(); this.setActiveThumb(i); },
      onStroke: (pageIndex, points) => { void this.bus?.execute(new DrawStrokeCmd(pageIndex, points)); this.setStatus('Trazo dibujado.'); },
      onFormText: (pageIndex, annotIndex, value, oldValue) => {
        void this.bus?.execute(new SetFormTextCmd(pageIndex, annotIndex, value, oldValue));
        this.setStatus('Campo de formulario actualizado.');
      },
      onFormChecked: (pageIndex, annotIndex, checked) => {
        void this.bus?.execute(new SetFormCheckedCmd(pageIndex, annotIndex, checked));
        this.setStatus('Casilla actualizada.');
      },
      onFormChoice: (pageIndex, annotIndex, values) => {
        const fields = this.session!.engine.listFormFields(this.session!.doc, pageIndex);
        const field = fields.find((f) => f.annotIndex === annotIndex);
        const oldValues = field ? field.options.filter((o) => o.selected).map((o) => o.value) : [];
        void this.bus?.execute(new SetFormChoiceCmd(pageIndex, annotIndex, values, oldValues));
        this.setStatus('Campo de elección actualizado.');
      },
      onFormRadio: (pageIndex, annotIndex) => {
        const fields = this.session!.engine.listFormFields(this.session!.doc, pageIndex);
        const target = fields.find((f) => f.annotIndex === annotIndex);
        const prev = target ? fields.find((f) => f.name === target.name && f.checked) : undefined;
        void this.bus?.execute(new SetFormRadioCmd(pageIndex, annotIndex, prev ? prev.annotIndex : null));
        this.setStatus('Opción marcada.');
      }
    });
    this.currentPage = 0;
    // Tras una operación de página (rotar/eliminar → refresh), rehacer miniaturas.
    this.session.model.onReload(() => {
      const total = this.session?.model.pages.length ?? 0;
      if (this.currentPage >= total) this.currentPage = Math.max(0, total - 1);
      this.buildThumbnails();
      this.setActiveThumb(this.currentPage);
      this.updateIndicator();
    });
    this.buildThumbnails();
    this.updateIndicator();
    this.setStatus(`${this.session.model.pages.length} página(s)`);
  }

  private async handleEdit(req: EditRequest): Promise<void> {
    const s = this.session;
    if (!s || !this.bus) return;
    const res = s.engine.editTextRun(s.doc, req.pageIndex, req.runId, req.newText);
    if (res.ok) {
      s.model.updateRunText(req.pageIndex, req.runId, req.newText);
      this.bus.pushExecuted(new EditTextRunCmd(req.pageIndex, req.runId, req.newText, req.oldText));
      this.setStatus('Editado.');
      return;
    }
    if (res.reason === 'glyph-missing') {
      // La fuente incrustada (subconjunto) no trae ese glifo: como Acrobat,
      // se sustituye la línea por la fuente estándar PDF más parecida en vez
      // de rendirse. `execute` directo (no `bus.execute`) para no dejar un
      // comando fallido en la pila de deshacer si tampoco cubre `newText`
      // (p. ej. CJK) — ahí el motor no modifica nada.
      const cmd = new ReplaceRunFontCmd(req.pageIndex, req.runId, req.newText);
      await cmd.execute(s);
      if (cmd.ok && cmd.fontName) {
        this.bus.pushExecuted(cmd);
        this.setStatus(`La fuente original no tiene algún carácter; la línea usa ${cmd.fontName}.`);
        return;
      }
    }
    req.el.textContent = req.oldText;
    this.setStatus(res.reason === 'glyph-missing'
      ? 'La fuente de esa línea no tiene alguno de esos caracteres; edición no aplicada.'
      : 'No se puede editar ese elemento.');
  }

  private async handleInsert(pageIndex: number, at: PtPoint): Promise<void> {
    if (!this.insertMode || !this.bus) return;
    await this.bus.execute(new InsertTextCmd(pageIndex, { xPt: at.xPt, yPt: at.yPt, text: 'Texto nuevo', sizePt: 16 }));
    this.setStatus('Texto insertado. Haz clic en él para editarlo.');
  }

  /** Clic en el fondo de la página: según el modo activo, inserta texto o coloca una nota. */
  private handleBackgroundClick(pageIndex: number, at: PtPoint): void {
    if (this.noteMode) { void this.handleNote(pageIndex, at); return; }
    void this.handleInsert(pageIndex, at);
  }

  private async handleNote(pageIndex: number, at: PtPoint): Promise<void> {
    if (!this.noteMode || !this.bus) return;
    this.noteMode = false;
    this.btnNote.style.background = '';
    const text = window.prompt('Texto de la nota:');
    if (!text || !text.trim()) { this.setStatus('Modo nota desactivado.'); return; }
    await this.bus.execute(new AddNoteCmd(pageIndex, at.xPt, at.yPt, text.trim()));
    this.setStatus('Nota añadida.');
  }

  private async deleteSelected(): Promise<void> {
    if (!this.bus || !this.selection) { this.setStatus('Selecciona primero una línea (haz clic en ella).'); return; }
    const { pageIndex, runId } = this.selection;
    this.selection = null;
    await this.bus.execute(new DeleteRunCmd(pageIndex, runId));
    this.setStatus('Línea borrada del documento.');
  }

  private selectedRun() {
    if (!this.session || !this.selection) return null;
    const page = this.session.model.pages[this.selection.pageIndex];
    return page?.runs.find((r) => r.runId === this.selection!.runId) ?? null;
  }

  /** Refleja en el selector el color de la línea seleccionada. */
  private reflectColor(): void {
    const run = this.selectedRun();
    if (run) this.colorInput.value = rgbToHex(run.color[0], run.color[1], run.color[2]);
  }

  private applyColor(): void {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection) { this.setStatus('Selecciona una línea para darle color.'); return; }
    const nuevo = hexToRgb(this.colorInput.value);
    const viejo: [number, number, number] = [run.color[0], run.color[1], run.color[2]];
    if (nuevo[0] === viejo[0] && nuevo[1] === viejo[1] && nuevo[2] === viejo[2]) return;
    void this.bus.execute(new SetColorCmd(this.selection.pageIndex, this.selection.runId, nuevo, viejo));
    this.setStatus('Color aplicado.');
  }

  private deleteCurrentPage(): void {
    const total = this.session?.model.pages.length ?? 0;
    if (!this.bus || total <= 1) { this.setStatus('No se puede eliminar la única página.'); return; }
    void this.bus.execute(new DeletePageCmd(this.currentPage));
    this.setStatus('Página eliminada.');
  }

  private openSignature(): void {
    const s = this.session;
    if (!s || !this.bus) { this.setStatus('Abre un documento antes de firmar.'); return; }
    SignaturePad.open((rgba, imgWidth, imgHeight) => {
      const page = s.model.pages[this.currentPage]!;
      const wPt = Math.min(page.sizePt.widthPt * 0.4, 180);
      const hPt = wPt * (imgHeight / imgWidth);
      const xPt = (page.sizePt.widthPt - wPt) / 2;
      const yPt = page.sizePt.heightPt * 0.15;
      void this.bus!.execute(new InsertImageCmd(this.currentPage, { rgba, imgWidth, imgHeight, xPt, yPt, wPt, hPt }));
      this.setStatus('Firma insertada.');
    });
  }

  private highlightSelected(): void {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection) { this.setStatus('Selecciona una línea para resaltarla.'); return; }
    void this.bus.execute(new HighlightRunCmd(this.selection.pageIndex, run.boxPt));
    this.setStatus('Resaltado.');
  }

  private underlineSelected(): void {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection) { this.setStatus('Selecciona una línea para subrayarla.'); return; }
    void this.bus.execute(new UnderlineRunCmd(this.selection.pageIndex, run.boxPt));
    this.setStatus('Subrayado.');
  }

  private strikeSelected(): void {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection) { this.setStatus('Selecciona una línea para tacharla.'); return; }
    void this.bus.execute(new StrikethroughRunCmd(this.selection.pageIndex, run.boxPt));
    this.setStatus('Tachado.');
  }

  private async runOcr(): Promise<void> {
    if (!this.session || !this.bus) { this.setStatus('Abre un documento antes del OCR.'); return; }
    this.btnOcr.disabled = true;
    this.setStatus('Reconociendo texto… (puede tardar)');
    try {
      const cmd = new OcrPageCmd(this.currentPage, new TesseractOcr());
      await this.bus.execute(cmd);
      this.setStatus(`${cmd.recognized} línea(s) reconocida(s).`);
    } catch {
      this.setStatus('Error de OCR.');
    } finally {
      this.btnOcr.disabled = false;
    }
  }

  private async handleInsertImage(file: File): Promise<void> {
    const s = this.session;
    if (!s || !this.bus) return;
    const { rgba, width, height } = await this.decodeImage(file);
    const page = s.model.pages[this.currentPage]!;
    const pageW = page.sizePt.widthPt, pageH = page.sizePt.heightPt;
    const wPt = Math.min(pageW * 0.6, 200);
    const hPt = wPt * (height / width);
    const xPt = (pageW - wPt) / 2, yPt = (pageH - hPt) / 2;
    await this.bus.execute(new InsertImageCmd(this.currentPage, { rgba, imgWidth: width, imgHeight: height, xPt, yPt, wPt, hPt }));
    this.setStatus('Imagen insertada.');
  }

  private async handleInsertPdf(file: File): Promise<void> {
    if (!this.bus) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.bus.execute(new InsertPdfCmd(bytes, this.currentPage + 1));
    this.setStatus('PDF insertado.');
  }

  private moveCurrentPage(delta: number): void {
    const total = this.session?.model.pages.length ?? 0;
    const from = this.currentPage;
    const to = from + delta;
    if (!this.bus || to < 0 || to >= total) return;
    this.currentPage = to; // seguir la página movida
    void this.bus.execute(new MovePageCmd(from, to));
    this.setStatus('Página reordenada.');
  }

  private goToPage(i: number): void {
    const total = this.session?.model.pages.length ?? 0;
    if (i < 0 || i >= total) return;
    this.viewer?.scrollToPage(i);
  }

  private updateIndicator(): void {
    const total = this.session?.model.pages.length ?? 0;
    this.pageIndicator.textContent = total ? `${this.currentPage + 1} / ${total}` : '– / –';
  }

  private setActiveThumb(i: number): void {
    for (const el of Array.from(this.thumbsEl.children)) {
      (el as HTMLElement).style.outline = Number((el as HTMLElement).dataset.page) === i ? '2px solid #6366f1' : 'none';
    }
  }

  /** Miniaturas: un canvas pequeño por página; clic desplaza el visor. */
  private buildThumbnails(): void {
    this.thumbsEl.textContent = '';
    const s = this.session;
    if (!s) return;
    for (const page of s.model.pages) {
      const wide = page.sizePt.widthPt >= page.sizePt.heightPt;
      const scale = (wide ? 120 : 90) / page.sizePt.widthPt;
      const { width, height, data } = s.engine.renderPage(s.doc, page.index, scale);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.dataset.page = String(page.index);
      Object.assign(canvas.style, { display: 'block', width: '100%', height: 'auto', marginBottom: '8px', cursor: 'pointer', background: '#fff', boxSizing: 'border-box' });
      const img = new ImageData(width, height);
      img.data.set(data);
      canvas.getContext('2d')!.putImageData(img, 0, 0);
      canvas.addEventListener('click', () => this.goToPage(page.index));
      this.thumbsEl.appendChild(canvas);
    }
    this.setActiveThumb(0);
  }

  private search(): void {
    if (!this.session || !this.viewer) return;
    const q = this.searchInput.value.trim();
    const byPage = new Map<number, RectPt[]>();
    let total = 0;
    for (const page of this.session.model.pages) {
      const rects = q ? this.session.engine.findText(this.session.doc, page.index, q) : [];
      if (rects.length) { byPage.set(page.index, rects); total += rects.length; }
    }
    this.viewer.setHighlights(byPage);
    this.setStatus(q ? `${total} coincidencia(s)` : '');
  }

  private zoom(factor: number): void {
    this.scale = Math.min(4, Math.max(0.25, Math.round(this.scale * factor * 100) / 100));
    this.viewer?.setScale(this.scale);
    this.setStatus(`Zoom ${Math.round(this.scale * 100)}%`);
  }

  private save(): void {
    const s = this.session;
    if (!s) return;
    this.download(s.engine.save(s.doc), this.docName.replace(/\.pdf$/i, '') + '_editado.pdf');
    this.setStatus('Guardado.');
  }

  private splitByRange(): void {
    const s = this.session;
    if (!s) return;
    const idx = parseRange(this.rangeInput.value, s.model.pages.length);
    if (idx.length === 0) { this.setStatus('Rango no válido (ej.: 1-3,5).'); return; }
    this.download(s.engine.extractPages(s.doc, idx), `${this.docName.replace(/\.pdf$/i, '')}_seleccion.pdf`);
    this.setStatus(`${idx.length} página(s) extraídas.`);
  }

  private extractCurrent(): void {
    const s = this.session;
    if (!s) return;
    const bytes = s.engine.extractPages(s.doc, [this.currentPage]);
    this.download(bytes, `${this.docName.replace(/\.pdf$/i, '')}_pagina_${this.currentPage + 1}.pdf`);
    this.setStatus(`Página ${this.currentPage + 1} extraída.`);
  }

  private download(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  private setStatus(msg: string): void { this.status.textContent = msg; }
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}
