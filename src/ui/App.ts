import { PdfiumEngine } from '../engine/pdfium/PdfiumEngine';
import { EditSession } from '../model/EditSession';
import { CommandBus } from '../commands/Command';
import { EditTextRunCmd } from '../commands/EditTextRun';
import { ReplaceRunFontCmd } from '../commands/ReplaceRunFont';
import { DeleteRunCmd } from '../commands/DeleteRun';
import { InsertTextCmd } from '../commands/InsertText';
import { MoveRunCmd } from '../commands/MoveRun';
import { SetColorCmd } from '../commands/SetColor';
import { SetRunFontSizeCmd } from '../commands/SetRunFontSize';
import { SetRunFontCmd } from '../commands/SetRunFont';
import { RotatePageCmd } from '../commands/RotatePage';
import { DeletePageCmd } from '../commands/DeletePage';
import { MovePageCmd } from '../commands/MovePage';
import { InsertPdfCmd } from '../commands/InsertPdf';
import { DuplicatePageCmd } from '../commands/DuplicatePage';
import { InsertImageCmd } from '../commands/InsertImage';
import { SetObjectRectCmd } from '../commands/SetObjectRect';
import { DeleteObjectCmd } from '../commands/DeleteObject';
import { AddNoteCmd } from '../commands/AddNote';
import { SetFormTextCmd } from '../commands/SetFormText';
import { SetFormCheckedCmd } from '../commands/SetFormChecked';
import { SetFormChoiceCmd } from '../commands/SetFormChoice';
import { SetFormRadioCmd } from '../commands/SetFormRadio';
import { HighlightRunCmd } from '../commands/HighlightRun';
import { UnderlineRunCmd } from '../commands/UnderlineRun';
import { StrikethroughRunCmd } from '../commands/StrikethroughRun';
import { DrawStrokeCmd } from '../commands/DrawStroke';
import { DrawRectCmd } from '../commands/DrawRect';
import { OcrPageCmd } from '../commands/OcrPage';
import { TesseractOcr } from '../ocr/TesseractOcr';
import { FiltrarPaginaCmd, type TipoFiltro } from '../commands/FiltrarPagina';
import { ComprimirDocumentoCmd } from '../commands/ComprimirDocumento';
import { SignaturePad } from './SignaturePad';
import { CompressPanel } from './CompressPanel';
import { TextPanel } from './TextPanel';
import { agruparLineas, aTextoPlano, aMarkdown, type Linea } from '../texto/estructura';
import { conversorPara, registrarConversor } from '../convert/ConversorDocumento';
import { ConversorMarkdownNavegador } from '../convert/ConversorMarkdownNavegador';
import { descargarArchivo } from './descargarArchivo';
import { quitarFondo } from './quitarFondo';
import { formatoBytes } from './formatoBytes';
import { registrarGesto } from './gesto';
import { parseRange } from './pageRange';
import { Viewer, type ToolMode } from './Viewer';
import type { EditRequest } from './TextLayer';
import type { PtPoint } from '../coords/PageGeometry';
import type { RectPt, OutlineItem } from '../engine/PdfEngine';
import { STANDARD_FONTS } from '../engine/standardFontFor';
import { stripSubsetPrefix } from '../engine/fontClassify';

/** Paleta de #swatches (#18 de la tabla de paridad): 8 colores fijos + el selector personalizado `#tool-color`. */
const PALETTE: { color: string; label: string }[] = [
  { color: '#000000', label: 'Negro' },
  { color: '#dc1414', label: 'Rojo' },
  { color: '#2563eb', label: 'Azul' },
  { color: '#16a34a', label: 'Verde' },
  { color: '#facc15', label: 'Amarillo' }, // mismo amarillo que ya usa el resaltado de búsqueda (Viewer.drawHighlights)
  { color: '#f97316', label: 'Naranja' },
  { color: '#9333ea', label: 'Morado' },
  { color: '#6b7280', label: 'Gris' }
];

/** Mensaje de `#status` por herramienta activa (§1: `setTool` es el único punto de entrada). */
const TOOL_STATUS: Record<ToolMode, string> = {
  none: '',
  insert: 'Modo insertar: haz clic donde quieras el texto.',
  pen: 'Modo pluma: arrastra para dibujar.',
  note: 'Modo nota: haz clic donde quieras la nota.',
  rect: 'Modo rectángulo: arrastra para dibujarlo.',
  eraser: 'Modo borrador: haz clic sobre un trazo o un rectángulo para borrarlo.'
};

/** Orquesta motor + sesión + comandos + visor. Punto de entrada de la app nueva. */
export class App {
  private engine!: PdfiumEngine;
  private session: EditSession | null = null;
  private bus: CommandBus | null = null;
  private docName = 'documento.pdf';
  /**
   * Herramienta activa: `'none' | 'insert' | 'pen' | 'note' | 'rect' |
   * 'eraser'`. Único punto de verdad — `setTool()` es la única función que lo
   * cambia, así los modos son excluyentes POR CONSTRUCCIÓN (activar uno
   * desactiva cualquier otro) y no por parejas de banderas a mano como antes
   * (§1 del lote D de herramientas).
   */
  private tool: ToolMode = 'none';
  /**
   * Color de herramienta (§2, #18) — UNO POR HERRAMIENTA, no compartido: en
   * Acrobat el resaltador es amarillo por defecto y cada herramienta
   * recuerda el suyo, cambiar el color de la pluma no debe teñir el
   * resaltador (ni al revés). `pen`/`rect` conservan el rojo que ya traía la
   * pluma; `highlight` conserva el amarillo que ya traía `HighlightRunCmd`
   * antes de este PR — ningún color por defecto cambia respecto a `main`,
   * solo se hacen elegibles desde la paleta. Subrayar/tachar NO están aquí:
   * conservan el color fijo que ya traían sus comandos, sin tocar.
   */
  private toolColors: { pen: [number, number, number]; rect: [number, number, number]; highlight: [number, number, number] } = {
    pen: [220, 20, 20],
    rect: [220, 20, 20],
    highlight: [250, 204, 21]
  };
  private swatchButtons: HTMLButtonElement[] = [];
  private selection: { pageIndex: number; runId: number } | null = null;
  /** Imagen seleccionada en el marco interactivo (sello/firma, #20/#21), o null. Mutuamente excluyente con `selection`. */
  private selectedImage: { pageIndex: number; objIndex: number } | null = null;
  /**
   * Nombre de la fuente estándar aplicada explícitamente desde `#prop-font`
   * a la selección ACTUAL, o `null` si no se ha tocado (o si cambió la
   * selección desde entonces). Sin este rastro, `reflectPropsPanel` no
   * podría distinguir "el run ya tenía por casualidad el nombre de una de
   * las 14 fuentes estándar" (p. ej. un PDF que incrusta 'Times-Roman' tal
   * cual, como el fixture de fuentes.pdf) de "el usuario eligió esa fuente
   * en el panel": en ambos casos `run.fontName` vale lo mismo, pero solo el
   * segundo caso debe mostrar esa fuente seleccionada en vez de "Original".
   */
  private appliedFontLabel: string | null = null;
  private viewer: Viewer | null = null;
  private scale = 1;
  /** Limpieza pendiente (iframe + oyentes) del intento de impresión anterior, si quedó alguno sin cerrar. Ver `print`. */
  private limpiarImpresionAnterior: (() => void) | null = null;
  private readonly viewerEl: HTMLElement;
  private readonly thumbsEl: HTMLElement;
  private readonly outlineEl: HTMLElement;
  private readonly tabPages: HTMLButtonElement;
  private readonly tabOutline: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly pageIndicator: HTMLElement;
  private readonly btnInsert: HTMLButtonElement;
  private readonly btnPen: HTMLButtonElement;
  private readonly btnNote: HTMLButtonElement;
  private readonly btnRect: HTMLButtonElement;
  private readonly btnEraser: HTMLButtonElement;
  private readonly btnOcr: HTMLButtonElement;
  private readonly filterSelect: HTMLSelectElement;
  private readonly btnFilter: HTMLButtonElement;
  private readonly btnCompress: HTMLButtonElement;
  private readonly colorInput: HTMLInputElement;
  private readonly toolColorInput: HTMLInputElement;
  private readonly propsPanel: HTMLElement;
  private readonly propFont: HTMLSelectElement;
  private readonly propSize: HTMLInputElement;
  private readonly searchInput: HTMLInputElement;
  private readonly rangeInput: HTMLInputElement;
  private currentPage = 0;

  constructor(rootEl: HTMLElement) {
    rootEl.textContent = '';
    const bar = document.createElement('div');
    bar.className = 'toolbar';
    Object.assign(bar.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', padding: '8px', borderBottom: '1px solid #ccc', font: '14px sans-serif', flex: '0 0 auto' });

    const file = document.createElement('input');
    file.type = 'file'; file.accept = 'application/pdf,.md,.markdown,text/markdown'; file.id = 'file-input';
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void this.openFile(f); });

    const btnNew = this.button('Nuevo', 'btn-new', () => void this.newBlank());

    const openImg = document.createElement('input');
    openImg.type = 'file'; openImg.accept = 'image/*'; openImg.id = 'btn-open-image'; openImg.title = 'Abrir una imagen como PDF';
    openImg.addEventListener('change', () => { const f = openImg.files?.[0]; if (f) void this.openImage(f).finally(() => { openImg.value = ''; }); });

    this.btnInsert = this.button('Insertar texto', 'btn-insert', () => this.setTool(this.tool === 'insert' ? 'none' : 'insert'));
    const btnDelete = this.button('Borrar', 'btn-delete', () => this.deleteSelected());
    const btnHighlight = this.button('Resaltar', 'btn-highlight', () => this.highlightSelected());
    const btnUnderline = this.button('Subrayar', 'btn-underline', () => this.underlineSelected());
    const btnStrike = this.button('Tachar', 'btn-strike', () => this.strikeSelected());
    const btnSign = this.button('Firmar', 'btn-sign', () => this.openSignature());
    const signUpload = document.createElement('input');
    signUpload.type = 'file'; signUpload.accept = 'image/*'; signUpload.id = 'btn-sign-upload';
    signUpload.title = 'Firma desde imagen (quita el fondo blanco automáticamente)';
    signUpload.addEventListener('change', () => {
      const f = signUpload.files?.[0];
      if (f) void this.handleSignUpload(f).finally(() => { signUpload.value = ''; });
    });
    this.btnPen = this.button('Pluma', 'btn-pen', () => this.setTool(this.tool === 'pen' ? 'none' : 'pen'));
    this.btnNote = this.button('Nota', 'btn-note', () => this.setTool(this.tool === 'note' ? 'none' : 'note'));
    this.btnRect = this.button('Rectángulo', 'btn-rect', () => this.setTool(this.tool === 'rect' ? 'none' : 'rect'));
    this.btnEraser = this.button('Borrador', 'btn-eraser', () => this.setTool(this.tool === 'eraser' ? 'none' : 'eraser'));
    this.btnOcr = this.button('OCR', 'btn-ocr', () => void this.runOcr());
    // Texto plano de todo el documento (#27 de la tabla de paridad, §9): abre
    // el diálogo de copiar/descargar .txt (TextPanel), mismo espíritu que el
    // modal de OCR de la app vieja. También sirve para leer el texto que un
    // OCR acaba de reconocer, sin que el diálogo se abra solo (ver el estado
    // que deja `runOcr`).
    const btnExtractText = this.button('Texto…', 'btn-extract-text', () => this.openTextPanel());
    // Exportar Markdown estructurado de todo el documento (#31 de la tabla de
    // paridad, §9): descarga directa, sin diálogo previo — como
    // `exportPDFToMarkdown` en la app vieja.
    const btnExportMd = this.button('Exportar Markdown', 'btn-export-md', () => this.exportMarkdown());

    // Filtros de imagen (#25 de la tabla de paridad, §9): a diferencia de la
    // app vieja (rasteriza la página entera), actúan solo sobre los objetos
    // imagen de la página actual — el texto y los vectores no se tocan.
    this.filterSelect = document.createElement('select');
    this.filterSelect.id = 'filter-select';
    this.filterSelect.title = 'Filtro de imagen para la página actual';
    const FILTROS: { value: '' | TipoFiltro; label: string }[] = [
      { value: '', label: 'Ninguno' },
      { value: 'magico', label: 'Color mágico' },
      { value: 'grises', label: 'Escala de grises' },
      { value: 'bn', label: 'Blanco y negro' }
    ];
    for (const { value, label } of FILTROS) {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      this.filterSelect.appendChild(opt);
    }
    this.btnFilter = this.button('Aplicar filtro', 'btn-filter', () => void this.applyImageFilter());

    // Comprimir documento (#26 → #29 de la tabla de paridad, §9): abre un
    // panel pequeño (calidad + dpi máximo) y comprime solo los objetos
    // imagen de TODAS las páginas.
    this.btnCompress = this.button('Comprimir', 'btn-compress', () => this.openCompressPanel());

    this.colorInput = document.createElement('input');
    this.colorInput.type = 'color'; this.colorInput.id = 'btn-color'; this.colorInput.title = 'Color del texto (de la línea seleccionada)';
    this.colorInput.addEventListener('input', () => this.applyColor());

    // Paleta de color de herramienta (§2, #18 de la tabla de paridad):
    // afecta a la herramienta ACTIVA (pluma o rectángulo) o, si ninguna está
    // activa, al resaltador — "Resaltar" no es un modo, actúa de inmediato
    // sobre la selección (ver `activeColorKey`/`reflectSwatches`).
    // Deliberadamente distinta de `#btn-color` de arriba (que cambia el
    // color del TEXTO ya en el documento, seleccionado): título explícito en
    // cada una para que no se confundan.
    const swatchesEl = document.createElement('div');
    swatchesEl.id = 'swatches';
    swatchesEl.title = 'Color de la herramienta activa (o del resaltador)';
    Object.assign(swatchesEl.style, { display: 'flex', gap: '3px', alignItems: 'center' });
    for (const { color, label } of PALETTE) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'swatch';
      swatch.dataset.color = color;
      swatch.title = label;
      swatch.setAttribute('aria-label', label);
      swatch.setAttribute('aria-pressed', 'false'); // reflectSwatches() lo corrige justo debajo
      Object.assign(swatch.style, {
        width: '18px', height: '18px', padding: '0', borderRadius: '3px', cursor: 'pointer',
        background: color, border: '2px solid transparent'
      });
      swatch.addEventListener('click', () => this.setToolColor(hexToRgb(color)));
      swatchesEl.appendChild(swatch);
      this.swatchButtons.push(swatch);
    }
    this.toolColorInput = document.createElement('input');
    this.toolColorInput.type = 'color'; this.toolColorInput.id = 'tool-color';
    this.toolColorInput.title = 'Color de herramienta (personalizado)';
    this.toolColorInput.addEventListener('input', () => this.setToolColor(hexToRgb(this.toolColorInput.value)));
    swatchesEl.appendChild(this.toolColorInput);
    this.reflectSwatches(); // marca la muestra del color activo al arrancar (ninguna herramienta activa → resaltador, amarillo)

    // Panel de propiedades de la línea seleccionada (fuente, tamaño, color),
    // como en Acrobat. Vive dentro de la propia barra de herramientas —igual
    // que el resto de controles de esta app, que no usa paneles flotantes—
    // así no tapa el documento ni rompe el flex existente; solo aparece
    // (`display: flex`) mientras haya una línea seleccionada
    // (`reflectPropsPanel`, llamado desde `onSelect`).
    this.propsPanel = document.createElement('div');
    this.propsPanel.id = 'props-panel';
    Object.assign(this.propsPanel.style, {
      display: 'none', alignItems: 'center', gap: '6px',
      padding: '2px 8px', border: '1px solid #ccc', borderRadius: '4px'
    });

    const fontLabel = document.createElement('label');
    fontLabel.textContent = 'Fuente:';
    fontLabel.style.fontSize = '12px';
    this.propFont = document.createElement('select');
    this.propFont.id = 'prop-font';
    this.propFont.title = 'Fuente de la línea seleccionada';
    this.propFont.addEventListener('change', () => void this.applyFont());
    fontLabel.appendChild(this.propFont);

    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamaño:';
    sizeLabel.style.fontSize = '12px';
    this.propSize = document.createElement('input');
    this.propSize.type = 'number'; this.propSize.id = 'prop-size';
    this.propSize.min = '1'; this.propSize.max = '400'; this.propSize.step = '0.5';
    this.propSize.title = 'Tamaño (pt) de la línea seleccionada';
    this.propSize.style.width = '4.5em';
    this.propSize.addEventListener('change', () => void this.applyFontSize());
    sizeLabel.appendChild(this.propSize);

    this.propsPanel.append(fontLabel, sizeLabel, this.colorInput);

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
    const btnFitWidth = this.button('Ajustar ancho', 'btn-fit-width', () => this.fitWidth());
    const btnExtract = this.button('Extraer pág.', 'btn-extract', () => this.extractCurrent());
    this.rangeInput = document.createElement('input');
    this.rangeInput.type = 'text'; this.rangeInput.id = 'btn-range'; this.rangeInput.placeholder = '1-3,5'; this.rangeInput.size = 6;
    const btnSplit = this.button('Dividir', 'btn-split', () => this.splitByRange());
    const btnSave = this.button('Guardar', 'btn-save', () => this.save());
    const btnPrint = this.button('Imprimir', 'btn-print', () => this.print());
    const btnUndo = this.button('Deshacer', 'btn-undo', () => { void this.bus?.undo(); });
    const btnRedo = this.button('Rehacer', 'btn-redo', () => { void this.bus?.redo(); });

    this.status = document.createElement('span');
    this.status.id = 'status'; this.status.style.marginLeft = 'auto'; this.status.style.color = '#555';

    bar.append(file, btnNew, openImg, this.btnInsert, btnDelete, btnHighlight, btnUnderline, btnStrike, btnSign, signUpload, this.btnPen, this.btnRect, this.btnEraser, this.btnNote, this.btnOcr, btnExtractText, btnExportMd, this.filterSelect, this.btnFilter, this.btnCompress, swatchesEl, this.propsPanel, this.searchInput, btnPrev, this.pageIndicator, btnNext, btnRotate, btnDeletePage, btnDuplicate, btnPageUp, btnPageDown, insertPdf, insertImage, btnZoomOut, btnZoomIn, btnFitWidth, btnExtract, this.rangeInput, btnSplit, btnSave, btnPrint, btnUndo, btnRedo, this.status);
    rootEl.appendChild(bar);

    // Área inferior: miniaturas (izquierda) + visor (derecha). Flex para que
    // siempre quede bajo la barra aunque esta ocupe varias filas.
    const area = document.createElement('div');
    Object.assign(area.style, { flex: '1', minHeight: '0', display: 'flex' });

    // Panel lateral: dos pestañas ("Páginas"/"Marcadores") que alternan entre
    // las miniaturas y el árbol de marcadores dentro del mismo hueco.
    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar';
    Object.assign(sidebar.style, { width: '150px', flex: '0 0 150px', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#3f4145', boxSizing: 'border-box' });

    const tabs = document.createElement('div');
    Object.assign(tabs.style, { display: 'flex', flex: '0 0 auto', borderBottom: '1px solid #2a2c2f' });
    this.tabPages = this.button('Páginas', 'tab-pages', () => this.showSidebarTab('pages'));
    this.tabOutline = this.button('Marcadores', 'tab-outline', () => this.showSidebarTab('outline'));
    Object.assign(this.tabPages.style, { flex: '1', padding: '6px 4px' });
    Object.assign(this.tabOutline.style, { flex: '1', padding: '6px 4px' });
    tabs.append(this.tabPages, this.tabOutline);

    this.thumbsEl = document.createElement('div');
    this.thumbsEl.id = 'thumbs';
    Object.assign(this.thumbsEl.style, { flex: '1', overflow: 'auto', padding: '8px', boxSizing: 'border-box' });

    this.outlineEl = document.createElement('div');
    this.outlineEl.id = 'outline-panel';
    Object.assign(this.outlineEl.style, { flex: '1', overflow: 'auto', padding: '8px', boxSizing: 'border-box', display: 'none', color: '#eee', font: '13px sans-serif' });

    sidebar.append(tabs, this.thumbsEl, this.outlineEl);

    this.viewerEl = document.createElement('div');
    this.viewerEl.id = 'viewer';
    // Focuseable por script (sin entrar en el orden de tabulación) para que,
    // tras hacer clic sobre él o sobre una página, PageUp/PageDown/flechas/
    // Home/End/espacio puedan desplazarlo: el navegador solo aplica el
    // scroll por teclado a un contenedor desplazable con foco (E-032, ver
    // Viewer.programmaticScroll).
    this.viewerEl.tabIndex = -1;
    Object.assign(this.viewerEl.style, { flex: '1', overflow: 'auto', background: '#525659', padding: '16px' });

    area.append(sidebar, this.viewerEl);
    rootEl.appendChild(area);
    this.showSidebarTab('pages');

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); void this.bus?.undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); void this.bus?.redo(); }
      // Escape sale de cualquier herramienta activa (§1). No interfiere con el
      // Escape que ya maneja TextLayer para cancelar una edición en curso: ese
      // no pasa por aquí con ninguna herramienta activa (edición y modo
      // herramienta no coinciden), y si `tool` ya es 'none' esto es un no-op.
      if (e.key === 'Escape' && this.tool !== 'none') this.setTool('none');
      // Suprimir/Retroceso con una imagen seleccionada (#20/#21): solo si el
      // foco no está en un campo editable (contenteditable de un run, un
      // <input>/<textarea>/<select>) — si no, Backspace tendría que borrar
      // un carácter ahí, no la imagen.
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedImage && !this.isEditableTarget(e.target)) {
        e.preventDefault();
        void this.deleteSelectedImage();
      }
    });

    // Arrastrar y soltar un fichero (PDF o imagen) sobre la ventana entera.
    // `dragover` necesita `preventDefault()` para que el navegador permita el
    // `drop` (si no, su acción por defecto es navegar al fichero); la clase
    // `drop-activo` (ver CSS en index.next.html) es la única indicación
    // visual, discreta, de que soltar aquí va a abrir el fichero.
    rootEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      rootEl.classList.add('drop-activo');
    });
    rootEl.addEventListener('dragleave', () => { rootEl.classList.remove('drop-activo'); });
    rootEl.addEventListener('drop', (e) => {
      e.preventDefault();
      rootEl.classList.remove('drop-activo');
      const f = e.dataTransfer?.files?.[0];
      if (f) void this.handleDroppedFile(f);
    });
  }

  /** Un PDF abre normal; un Markdown se convierte a PDF (vía `openFile`); una imagen se convierte a PDF de una página (mismo flujo que `#btn-open-image`). Otro tipo: aviso en `#status`, sin romper nada. */
  private async handleDroppedFile(file: File): Promise<void> {
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (esPdf) { await this.openFile(file); return; }
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (conversorPara(ext)) { await this.openFile(file); return; }
    const esImagen = file.type.startsWith('image/') || /\.(png|jpe?g|jpeg|gif|webp)$/i.test(file.name);
    if (esImagen) { await this.openImage(file); return; }
    this.setStatus('Tipo de archivo no admitido para soltar aquí (usa un PDF o una imagen).');
  }

  /** `#btn-new`: documento de 1 página A4 (595×842 pt) en blanco, abierto como cualquier otro. */
  private async newBlank(): Promise<void> {
    const engine = await this.ensureEngine();
    // Posible mejora futura: avisar si el documento actual tiene cambios sin
    // guardar antes de reemplazarlo (fuera de alcance de este PR).
    const bytes = engine.createBlank(595, 842);
    await this.openBytes(bytes, 'documento.pdf');
    this.setStatus('Documento en blanco creado.');
  }

  private button(label: string, id: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label; b.id = id; b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Único punto de entrada para cambiar la herramienta activa (§1 del lote
   * D): activa las capas del visor y los `aria-pressed`/estilo de los
   * botones que le corresponden a `tool` y desactiva los de cualquier otra —
   * los modos son excluyentes POR CONSTRUCCIÓN (un solo campo, un solo sitio
   * que lo escribe), no por parejas de banderas puestas a mano como antes de
   * este PR. Todo cambio de herramienta pasa por aquí: los propios botones,
   * el manejador de Escape y `handleNote` (que se autodesactiva tras colocar
   * una nota).
   */
  private setTool(tool: ToolMode): void {
    this.tool = tool;
    for (const [nombre, btn] of Object.entries(this.toolButtons()) as [Exclude<ToolMode, 'none'>, HTMLButtonElement][]) {
      const activo = tool === nombre;
      btn.setAttribute('aria-pressed', String(activo));
      btn.style.background = activo ? '#c7d2fe' : '';
    }
    this.viewer?.setTool(tool);
    // La vista previa de pluma/rectángulo en el visor usa un único color a
    // la vez: al activar cualquiera de las dos, empujarle el color QUE ESA
    // herramienta recuerda (nunca el de la otra).
    if (tool === 'pen' || tool === 'rect') this.viewer?.setToolColor(this.toolColors[tool]);
    // La paleta pasa a reflejar la herramienta recién activada (o el
    // resaltador, si `tool` no es pluma ni rectángulo).
    this.reflectSwatches();
    this.setStatus(TOOL_STATUS[tool]);
  }

  /** Botones de herramienta, para que `setTool` los recorra sin repetir la lista en cada sitio. */
  private toolButtons(): Record<Exclude<ToolMode, 'none'>, HTMLButtonElement> {
    return { insert: this.btnInsert, pen: this.btnPen, note: this.btnNote, rect: this.btnRect, eraser: this.btnEraser };
  }

  /**
   * A qué color de `toolColors` afecta la paleta EN ESTE MOMENTO: el de la
   * herramienta activa si es pluma o rectángulo; si no hay ninguna de esas
   * dos activa (incluido el borrador, insertar, nota o ningún modo), el
   * resaltador — porque "Resaltar" no es un modo (`tool`), actúa al
   * instante sobre la línea seleccionada (`highlightSelected`).
   */
  private activeColorKey(): 'pen' | 'rect' | 'highlight' {
    if (this.tool === 'pen') return 'pen';
    if (this.tool === 'rect') return 'rect';
    return 'highlight';
  }

  /** `#swatches`/`#tool-color`: fija el color de la herramienta A LA QUE APLICARÍA ahora mismo (§2, #18) — nunca comparte color entre herramientas. */
  private setToolColor(rgb: [number, number, number]): void {
    this.toolColors[this.activeColorKey()] = rgb;
    this.reflectSwatches();
    if (this.tool === 'pen' || this.tool === 'rect') this.viewer?.setToolColor(rgb);
  }

  /** Marca en la paleta (`aria-pressed` + borde) la muestra que coincide con el color de `activeColorKey()`, y sincroniza `#tool-color`. */
  private reflectSwatches(): void {
    const hex = rgbToHex(...this.toolColors[this.activeColorKey()]);
    for (const b of this.swatchButtons) {
      const activo = (b.dataset.color ?? '').toLowerCase() === hex.toLowerCase();
      b.setAttribute('aria-pressed', String(activo));
      b.style.borderColor = activo ? '#111827' : 'transparent';
    }
    this.toolColorInput.value = hex;
  }

  private async ensureEngine(): Promise<PdfiumEngine> {
    if (!this.engine) {
      this.engine = await PdfiumEngine.create();
      // Registro del puerto de conversión (§9 fila #32): un único conversor
      // hoy (Markdown, puro navegador). Se registra aquí, no en main.ts,
      // porque necesita el motor YA CREADO (measureText/insertText/etc.) —
      // una futura implementación de escritorio (LibreOffice/Word para
      // .docx) se registraría igual, sin que este método cambie de forma.
      registrarConversor(new ConversorMarkdownNavegador(this.engine));
    }
    return this.engine;
  }

  /**
   * Punto de entrada único para abrir un fichero desde `#file-input` o
   * soltarlo en la ventana (`handleDroppedFile`). Un PDF se abre tal cual;
   * si la extensión la acepta algún conversor registrado (hoy, `.md`/
   * `.markdown`), se convierte primero y se abre el PDF resultante como
   * documento normal — el nombre sugerido para guardar pasa a ser
   * `<nombre>.pdf`.
   */
  async openFile(file: File): Promise<void> {
    const engine = await this.ensureEngine();
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    const conversor = conversorPara(ext);
    if (conversor) {
      this.setStatus('Convirtiendo…');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdfBytes = await conversor.convertir(file.name, bytes);
      const pdfName = file.name.replace(/\.[^./\\]+$/, '') + '.pdf';
      await this.openBytes(pdfBytes, pdfName);
      const n = this.session ? engine.pageCount(this.session.doc) : 0;
      this.setStatus(`Convertido desde Markdown (${n} páginas).`);
      return;
    }
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
    this.selectedImage = null;
    this.reflectPropsPanel();
    this.setTool('none'); // el visor viejo (si lo hay) se descarta a continuación; setTool aquí solo resetea botones/estado
    this.viewerEl.textContent = '';
    this.scale = 1;
    this.viewer = new Viewer(this.viewerEl, this.session, {
      onEdit: (req) => this.handleEdit(req),
      onSelect: (pageIndex, runId) => {
        this.selection = { pageIndex, runId };
        this.appliedFontLabel = null;
        this.selectedImage = null; // selección mutuamente excluyente con una imagen
        this.reflectPropsPanel();
      },
      onBackgroundClick: (pageIndex, at) => { this.selectedImage = null; this.handleBackgroundClick(pageIndex, at); },
      onImageSelect: (pageIndex, objIndex) => {
        this.selectedImage = { pageIndex, objIndex };
        this.selection = null; // selección mutuamente excluyente con una línea de texto
        this.reflectPropsPanel();
      },
      onImageChangeRect: (pageIndex, objIndex, newRectPt, oldRectPt) => {
        void this.bus?.execute(new SetObjectRectCmd(pageIndex, objIndex, newRectPt, oldRectPt));
        this.setStatus('Imagen movida/redimensionada.');
      },
      onMove: (pageIndex, runId, dxPt, dyPt) => { void this.bus?.execute(new MoveRunCmd(pageIndex, runId, dxPt, dyPt)); },
      onPageChange: (i) => { this.currentPage = i; this.updateIndicator(); this.setActiveThumb(i); },
      onStroke: (pageIndex, points) => { void this.bus?.execute(new DrawStrokeCmd(pageIndex, points, this.toolColors.pen)); this.setStatus('Trazo dibujado.'); },
      onDrawRect: (pageIndex, rect) => { void this.bus?.execute(new DrawRectCmd(pageIndex, rect, this.toolColors.rect)); this.setStatus('Rectángulo dibujado.'); },
      onErase: (pageIndex, objIndex) => { void this.bus?.execute(new DeleteObjectCmd(pageIndex, objIndex)); this.setStatus('Trazo borrado.'); },
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
    // Ajuste al ancho también al ABRIR (no solo con el botón): antes la
    // escala inicial era fija (1); ahora la página ocupa el ancho útil del
    // visor desde el primer render, en cualquier tamaño de ventana (escritorio
    // o móvil) — ver `fitWidth`. Necesita el wrapper de la página ya en el DOM
    // (lo crea `new Viewer(...)` de forma síncrona, arriba) para medir.
    this.fitWidth();
    // Tras una operación de página (rotar/eliminar → refresh), rehacer miniaturas.
    this.session.model.onReload(() => {
      const total = this.session?.model.pages.length ?? 0;
      if (this.currentPage >= total) this.currentPage = Math.max(0, total - 1);
      this.buildThumbnails();
      this.buildOutline();
      this.setActiveThumb(this.currentPage);
      this.updateIndicator();
    });
    // Tras CUALQUIER recarga del modelo (deshacer/rehacer de un cambio de
    // fuente/tamaño/página, que recrean el documento desde una copia —
    // `EditSession.reload`— o lo reconstruyen en sitio —`refresh`—) el
    // panel de propiedades puede haber quedado desincronizado del documento
    // real: `appliedFontLabel` recordaba la última fuente elegida por el
    // usuario para la selección ANTERIOR al reload, y `this.selection.runId`
    // puede haber dejado de existir (el objeto de texto se recreó con otro
    // índice, o desapareció). Sin esto, deshacer un cambio de fuente volvía
    // el DOCUMENTO a la fuente original pero el panel seguía mostrando la
    // fuente descartada — mentía sobre el estado real (bug de revisión de
    // PR #51). Único punto de enganche: cubre execute Y undo/redo de todos
    // los comandos que reindexan runs (ver grep de `c.refresh()`/`c.reload()`
    // en src/commands/*.ts), no solo los de fuente/tamaño.
    this.session.model.onReload(() => this.reconcileSelectionAfterReload());
    this.buildThumbnails();
    this.buildOutline();
    this.showSidebarTab('pages');
    this.updateIndicator();
    this.setStatus(`${this.session.model.pages.length} página(s)`);
  }

  /**
   * Reconcilia selección y panel de propiedades con el documento real tras
   * un `onReload` del modelo (ver el comentario en `openBytes`). Nunca
   * confía en `appliedFontLabel` ni en `this.selection.runId` de antes del
   * reload: los descarta y, si el runId seleccionado ya no existe en la
   * página, limpia la selección entera (oculta el panel) en vez de dejarla
   * apuntando por casualidad a otro run.
   */
  private reconcileSelectionAfterReload(): void {
    this.appliedFontLabel = null;
    if (this.selection && !this.selectedRun()) this.selection = null;
    // Igual criterio para una imagen seleccionada: una operación de página
    // puede haber renumerado páginas u objetos; si ya no existe, se limpia
    // en vez de dejarla apuntando por casualidad a otra imagen (E-032, mismo
    // principio que la reconciliación de `selection` de arriba).
    if (this.selectedImage && this.session) {
      const pageValida = this.selectedImage.pageIndex < this.session.model.pages.length;
      const sigueExistiendo = pageValida && this.session.engine
        .listImageObjects(this.session.doc, this.selectedImage.pageIndex)
        .some((im) => im.objIndex === this.selectedImage!.objIndex);
      if (!sigueExistiendo) { this.selectedImage = null; this.viewer?.deselectImage(); }
    }
    this.reflectPropsPanel();
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
    if (this.tool !== 'insert' || !this.bus) return;
    await this.bus.execute(new InsertTextCmd(pageIndex, { xPt: at.xPt, yPt: at.yPt, text: 'Texto nuevo', sizePt: 16 }));
    this.setStatus('Texto insertado. Haz clic en él para editarlo.');
  }

  /** Clic en el fondo de la página: según la herramienta activa, inserta texto o coloca una nota. */
  private handleBackgroundClick(pageIndex: number, at: PtPoint): void {
    if (this.tool === 'note') { void this.handleNote(pageIndex, at); return; }
    void this.handleInsert(pageIndex, at);
  }

  private async handleNote(pageIndex: number, at: PtPoint): Promise<void> {
    if (this.tool !== 'note' || !this.bus) return;
    this.setTool('none'); // nota: un solo uso por activación, como antes de este refactor
    const text = window.prompt('Texto de la nota:');
    if (!text || !text.trim()) { this.setStatus('Modo nota desactivado.'); return; }
    await this.bus.execute(new AddNoteCmd(pageIndex, at.xPt, at.yPt, text.trim()));
    this.setStatus('Nota añadida.');
  }

  private async deleteSelected(): Promise<void> {
    if (!this.bus || !this.selection) { this.setStatus('Selecciona primero una línea (haz clic en ella).'); return; }
    const { pageIndex, runId } = this.selection;
    this.selection = null;
    this.reflectPropsPanel();
    await this.bus.execute(new DeleteRunCmd(pageIndex, runId));
    this.setStatus('Línea borrada del documento.');
  }

  /** true si `target` es un campo donde Backspace/Delete deben editar texto, no borrar la imagen seleccionada. */
  private isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    if (el.isContentEditable) return true;
    return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
  }

  private async deleteSelectedImage(): Promise<void> {
    if (!this.bus || !this.selectedImage) return;
    const { pageIndex, objIndex } = this.selectedImage;
    this.selectedImage = null;
    this.viewer?.deselectImage();
    await this.bus.execute(new DeleteObjectCmd(pageIndex, objIndex));
    this.setStatus('Imagen borrada.');
  }

  private selectedRun() {
    if (!this.session || !this.selection) return null;
    const page = this.session.model.pages[this.selection.pageIndex];
    return page?.runs.find((r) => r.runId === this.selection!.runId) ?? null;
  }

  /**
   * Refleja en el panel (§3 del encargo) la fuente, tamaño y color REALES de
   * la línea seleccionada, releídos del modelo — nunca de lo que había antes
   * del último cambio. Oculta el panel entero cuando no hay selección. Se
   * llama tras `onSelect`, tras abrir/cerrar documento, tras borrar la
   * selección y tras cada cambio de fuente/tamaño (con la selección ya
   * reapuntada al runId nuevo, ver `applyFont`/`applyFontSize`).
   */
  private reflectPropsPanel(): void {
    const run = this.selectedRun();
    if (!run) { this.propsPanel.style.display = 'none'; return; }
    this.propsPanel.style.display = 'flex';

    this.propFont.textContent = '';
    const original = document.createElement('option');
    original.value = '__original__';
    original.textContent = `Original (${stripSubsetPrefix(run.fontName)})`;
    this.propFont.appendChild(original);
    for (const name of STANDARD_FONTS) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      this.propFont.appendChild(opt);
    }
    // Solo si el USUARIO eligió explícitamente una fuente estándar en este
    // panel para la selección actual (`appliedFontLabel`) se muestra esa
    // marcada; en cualquier otro caso, "Original" — aunque `run.fontName`
    // coincida por casualidad con el nombre de una fuente estándar (ver el
    // comentario del campo).
    this.propFont.value = this.appliedFontLabel ?? '__original__';

    this.propSize.value = String(Math.round(run.sizePt * 2) / 2);
    this.colorInput.value = rgbToHex(run.color[0], run.color[1], run.color[2]);
  }

  /** `#prop-font` change: aplica la fuente estándar elegida al run seleccionado. */
  private async applyFont(): Promise<void> {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection) return;
    const chosen = this.propFont.value;
    // "Original", o la fuente que ya se había aplicado desde este panel: no hay nada que cambiar.
    if (chosen === '__original__' || chosen === this.appliedFontLabel) return;
    const { pageIndex, runId } = this.selection;
    const cmd = new SetRunFontCmd(pageIndex, runId, chosen);
    await this.bus.execute(cmd);
    if (cmd.ok && cmd.fontName) {
      this.selection = { pageIndex, runId: cmd.runId };
      this.appliedFontLabel = cmd.fontName;
      this.setStatus(`Fuente cambiada a ${cmd.fontName}.`);
    } else {
      this.setStatus('Esa fuente no tiene todos los caracteres de esta línea; sin cambios.');
    }
    this.reflectPropsPanel();
  }

  /** `#prop-size` change: valida el rango (1-400 pt) y aplica el tamaño nuevo. */
  private async applyFontSize(): Promise<void> {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection) return;
    const value = parseFloat(this.propSize.value);
    if (!Number.isFinite(value) || value < 1 || value > 400) {
      this.setStatus('Tamaño no válido: debe estar entre 1 y 400 pt.');
      this.reflectPropsPanel(); // repone el valor válido anterior en el input
      return;
    }
    if (Math.abs(value - run.sizePt) < 0.01) return;
    const { pageIndex, runId } = this.selection;
    const cmd = new SetRunFontSizeCmd(pageIndex, runId, value);
    await this.bus.execute(cmd);
    if (cmd.ok) {
      this.selection = { pageIndex, runId: cmd.runId };
      this.setStatus('Tamaño cambiado.');
    } else {
      this.setStatus('Tamaño no válido: debe estar entre 1 y 400 pt.');
    }
    this.reflectPropsPanel();
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

  /**
   * `#btn-sign-upload`: firma subiendo una imagen (#20 de la tabla de
   * paridad). Decodifica con el mismo `decodeImage` que el resto de flujos
   * de imagen, le quita el fondo casi blanco (`quitarFondo`, umbral por
   * defecto) para que la firma quede con transparencia real (el motor SÍ
   * conserva el canal alfa al insertar, ver `PdfiumEngine.insertImage`) y la
   * inserta centrada, con el mismo ancho razonable que la firma dibujada
   * (180pt, alto proporcional). Queda seleccionada para reposicionarla.
   */
  private async handleSignUpload(file: File): Promise<void> {
    const s = this.session;
    if (!s || !this.bus) return;
    const { rgba, width, height } = await this.decodeImage(file);
    const limpio = quitarFondo(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength));
    const page = s.model.pages[this.currentPage]!;
    const wPt = Math.min(page.sizePt.widthPt * 0.4, 180);
    const hPt = wPt * (height / width);
    const xPt = (page.sizePt.widthPt - wPt) / 2;
    const yPt = page.sizePt.heightPt * 0.15;
    await this.bus.execute(new InsertImageCmd(this.currentPage, {
      rgba: new Uint8Array(limpio.buffer, limpio.byteOffset, limpio.byteLength),
      imgWidth: width, imgHeight: height, xPt, yPt, wPt, hPt
    }));
    const imagenes = s.engine.listImageObjects(s.doc, this.currentPage);
    const insertada = imagenes.reduce((max, im) => (im.objIndex > max.objIndex ? im : max), imagenes[0]!);
    this.selectedImage = { pageIndex: this.currentPage, objIndex: insertada.objIndex };
    this.selection = null;
    this.reflectPropsPanel();
    this.viewer?.selectImage(this.currentPage, insertada.objIndex);
    this.setStatus('Firma insertada desde imagen (fondo quitado).');
  }

  private highlightSelected(): void {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection) { this.setStatus('Selecciona una línea para resaltarla.'); return; }
    void this.bus.execute(new HighlightRunCmd(this.selection.pageIndex, run.boxPt, this.toolColors.highlight));
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
      // No se abre el diálogo de texto solo (ver TextPanel): se ofrece el
      // camino en el propio estado, un clic más que un modal no pedido.
      this.setStatus(`${cmd.recognized} línea(s) reconocida(s). Pulsa «Texto…» para copiarlas.`);
    } catch {
      this.setStatus('Error de OCR.');
    } finally {
      this.btnOcr.disabled = false;
    }
  }

  /**
   * `#btn-filter`: aplica el filtro elegido en `#filter-select` a TODAS las
   * imágenes de la página actual (#25 de la tabla de paridad, §9). Si la
   * página no tiene imágenes, se avisa en `#status` sin ejecutar ningún
   * comando (los filtros solo afectan a imágenes; el texto queda intacto).
   */
  private async applyImageFilter(): Promise<void> {
    if (!this.session || !this.bus) { this.setStatus('Abre un documento antes de aplicar un filtro.'); return; }
    const valor = this.filterSelect.value as TipoFiltro | '';
    if (!valor) { this.setStatus('Elige un filtro antes de aplicarlo.'); return; }
    const imgs = this.session.engine.listImageObjects(this.session.doc, this.currentPage);
    if (imgs.length === 0) {
      this.setStatus('Esta página no tiene imágenes; los filtros solo afectan a imágenes (el texto queda intacto).');
      return;
    }
    this.btnFilter.disabled = true;
    try {
      const cmd = new FiltrarPaginaCmd(this.currentPage, valor);
      await this.bus.execute(cmd);
      this.setStatus(`Filtro aplicado a ${cmd.imagenesAfectadas} imagen(es).`);
    } finally {
      this.btnFilter.disabled = false;
    }
  }

  /** `#btn-compress`: abre el panel de calidad/dpi (`CompressPanel`) y lanza la compresión al confirmar. */
  private openCompressPanel(): void {
    if (!this.session || !this.bus) { this.setStatus('Abre un documento antes de comprimir.'); return; }
    CompressPanel.open(async ({ calidad, dpiMax }) => { await this.runCompress(calidad, dpiMax); });
  }

  /**
   * Comprime el documento entero (#29 de la tabla de paridad, §9), actuando
   * solo sobre los objetos imagen de cada página (el texto y los vectores no
   * se tocan). Puede tardar (recodifica JPEG en el navegador por cada
   * imagen): `#btn-compress` se deshabilita mientras corre.
   */
  private async runCompress(calidad: number, dpiMax: number): Promise<void> {
    if (!this.bus) return;
    this.btnCompress.disabled = true;
    this.setStatus('Comprimiendo… (puede tardar)');
    try {
      const cmd = new ComprimirDocumentoCmd({ calidad, dpiMax });
      await this.bus.execute(cmd);
      const { antesBytes, despuesBytes } = cmd.informe;
      const pct = antesBytes > 0 ? Math.round((1 - despuesBytes / antesBytes) * 100) : 0;
      this.setStatus(`Comprimido: ${formatoBytes(antesBytes)} → ${formatoBytes(despuesBytes)} (−${pct}%)`);
    } catch {
      this.setStatus('Error al comprimir.');
    } finally {
      this.btnCompress.disabled = false;
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

  /**
   * Único punto de entrada para cambiar de "página actual": prev/next, clic
   * en miniatura y clic en marcador pasan todos por aquí (E-032).
   *
   * La selección explícita del usuario manda: `currentPage` se fija AQUÍ,
   * antes de tocar el scroll, no se espera a que el `IntersectionObserver`
   * del Viewer lo confirme. Antes del arreglo, `goToPage` solo llamaba a
   * `scrollToPage` y confiaba en que el observer actualizara `currentPage` al
   * detectar la página "más visible" — pero si el scroll no se movía (todo
   * cabía en el viewport, el destino ya era visible, o ya estaba al final) el
   * observer nunca disparaba y `currentPage` se quedaba con el valor
   * anterior. Todas las operaciones "de la página actual" (eliminar, rotar,
   * duplicar, subir/bajar, extraer, OCR, insertar imagen…) actúan sobre
   * `currentPage`, así que el usuario podía hacer clic en la miniatura 3,
   * pulsar "Eliminar página" y borrar la 1.
   *
   * `Viewer.scrollToPage` fija además un "pin" (`pinnedPage`) para que su
   * propio IntersectionObserver no reafirme otra página mientras el usuario
   * no haga scroll de verdad (rueda, gesto táctil, teclado) — ver el
   * comentario de `Viewer.observeVisible`.
   */
  private goToPage(i: number): void {
    const total = this.session?.model.pages.length ?? 0;
    if (i < 0 || i >= total) return;
    this.currentPage = i;
    this.updateIndicator();
    this.setActiveThumb(i);
    this.viewer?.scrollToPage(i);
  }

  private updateIndicator(): void {
    const total = this.session?.model.pages.length ?? 0;
    this.pageIndicator.textContent = total ? `${this.currentPage + 1} / ${total}` : '– / –';
  }

  /** Resalta la miniatura de `currentPage`: la única fuente visual de "cuál es la página actual" en el panel de páginas (E-032). */
  private setActiveThumb(i: number): void {
    for (const el of Array.from(this.thumbsEl.children)) {
      const t = el as HTMLElement;
      const activa = Number(t.dataset.page) === i;
      t.classList.toggle('active', activa);
      if (activa) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
      t.style.outline = activa ? '2px solid #6366f1' : 'none';
    }
  }

  /** Alterna el panel lateral entre miniaturas de página y árbol de marcadores. */
  private showSidebarTab(which: 'pages' | 'outline'): void {
    this.thumbsEl.style.display = which === 'pages' ? 'block' : 'none';
    this.outlineEl.style.display = which === 'outline' ? 'block' : 'none';
    this.tabPages.style.background = which === 'pages' ? '#c7d2fe' : '';
    this.tabOutline.style.background = which === 'outline' ? '#c7d2fe' : '';
  }

  /** Árbol de marcadores del documento. Se reconstruye al abrir otro documento y tras cualquier `onReload` (borrar/mover página cambia los índices). */
  private buildOutline(): void {
    this.outlineEl.textContent = '';
    const s = this.session;
    if (!s) return;
    const items = s.engine.getOutline(s.doc);
    if (items.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'Este documento no tiene marcadores.';
      this.outlineEl.appendChild(p);
      return;
    }
    this.outlineEl.appendChild(this.buildOutlineList(items, 0));
  }

  /** Nivel de la lista de marcadores: un `<ul>` con un `<li>` por nodo, recursivo para los hijos. */
  private buildOutlineList(items: OutlineItem[], depth: number): HTMLUListElement {
    const ul = document.createElement('ul');
    Object.assign(ul.style, { listStyle: 'none', margin: '0', padding: '0' });
    for (const item of items) {
      const li = document.createElement('li');
      const row = document.createElement('div');
      Object.assign(row.style, { display: 'flex', alignItems: 'center', paddingLeft: `${depth * 14}px` });

      let childrenUl: HTMLUListElement | null = null;
      if (item.children.length > 0) {
        const toggle = document.createElement('button');
        toggle.className = 'outline-toggle';
        toggle.textContent = '▸';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.title = 'Desplegar/plegar';
        Object.assign(toggle.style, { border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', width: '16px', flex: '0 0 16px', padding: '0' });
        toggle.addEventListener('click', () => {
          const expandido = toggle.getAttribute('aria-expanded') === 'true';
          const siguiente = !expandido;
          toggle.setAttribute('aria-expanded', String(siguiente));
          toggle.textContent = siguiente ? '▾' : '▸';
          if (childrenUl) childrenUl.style.display = siguiente ? 'block' : 'none';
        });
        row.appendChild(toggle);
      } else {
        const spacer = document.createElement('span');
        Object.assign(spacer.style, { width: '16px', flex: '0 0 16px', display: 'inline-block' });
        row.appendChild(spacer);
      }

      const btn = document.createElement('button');
      btn.className = 'outline-item';
      btn.textContent = item.title;
      Object.assign(btn.style, { border: 'none', background: 'none', color: 'inherit', textAlign: 'left', flex: '1', padding: '2px 0', cursor: item.pageIndex !== null ? 'pointer' : 'default' });
      if (item.pageIndex !== null) {
        const pageIndex = item.pageIndex;
        btn.addEventListener('click', () => this.goToPage(pageIndex));
      } else {
        btn.disabled = true;
      }
      row.appendChild(btn);
      li.appendChild(row);

      if (item.children.length > 0) {
        childrenUl = this.buildOutlineList(item.children, depth + 1);
        childrenUl.style.display = 'none';
        li.appendChild(childrenUl);
      }
      ul.appendChild(li);
    }
    return ul;
  }

  /** Miniaturas: un canvas pequeño por página; clic desplaza el visor, arrastrar reordena (ver beginThumbDrag). */
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
      canvas.className = 'thumb';
      Object.assign(canvas.style, { display: 'block', width: '100%', height: 'auto', marginBottom: '8px', cursor: 'pointer', background: '#fff', boxSizing: 'border-box' });
      const img = new ImageData(width, height);
      img.data.set(data);
      canvas.getContext('2d')!.putImageData(img, 0, 0);

      // Un clic SIN arrastre navega (comportamiento de siempre); un arrastre
      // que supere el umbral reordena y no debe además disparar el 'click'
      // nativo que el navegador emite al soltar sobre el mismo elemento.
      let suprimirClick = false;
      canvas.addEventListener('click', () => {
        if (suprimirClick) { suprimirClick = false; return; }
        this.goToPage(page.index);
      });
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return; // solo botón primario / toque simple
        this.beginThumbDrag(canvas, page.index, e, (huboArrastre) => { suprimirClick = huboArrastre; });
      });
      this.thumbsEl.appendChild(canvas);
    }
    this.setActiveThumb(0);
  }

  /**
   * Arrastrar y soltar una miniatura para reordenar páginas, al estilo
   * Acrobat. Pointer events (no la API HTML5 `draggable`), para que funcione
   * también en táctil — registrados por `registrarGesto` (`src/ui/gesto.ts`),
   * que también trata `pointercancel` como cancelación (E-034: un gesto
   * táctil interrumpido por el scroll del sistema, o la pérdida de la
   * captura del puntero, nunca entrega `pointerup` — sin esto los listeners
   * de `window` quedaban colgados para siempre y la miniatura se quedaba
   * atenuada con el indicador de inserción a medio poner).
   *
   * Umbral de `UMBRAL_ARRASTRE_PX` para distinguir clic (navegar) de
   * arrastre (reordenar): por debajo del umbral no pasa nada y el 'click'
   * nativo del navegador sigue disparando `goToPage` con normalidad.
   *
   * Mientras se arrastra, un indicador de inserción (`.thumb-drop-indicator`,
   * una línea entre miniaturas) se inserta en el DOM en el punto exacto
   * donde caería la miniatura si se soltara ahí — recalculado en cada
   * `pointermove` a partir del punto medio vertical de cada miniatura, nunca
   * moviendo la miniatura real: la reordenación solo se aplica al soltar.
   *
   * Al soltar con normalidad, se ejecuta UN único `MovePageCmd(from, to)`
   * (deshacible) y `currentPage` pasa a ser la página movida en su nueva
   * posición — vía `goToPage()` (regla `navegacion-por-gotopage`), nunca
   * llamando a `scrollToPage` aquí directamente. Cancelado (Escape, ya
   * existía; o `pointercancel`, E-034): solo se deshace la vista previa
   * (clase e indicador), nunca se ejecuta `MovePageCmd`.
   */
  private beginThumbDrag(
    canvas: HTMLCanvasElement,
    sourceIndex: number,
    inicio: PointerEvent,
    onDragLejos: (huboArrastre: boolean) => void
  ): void {
    const UMBRAL_ARRASTRE_PX = 5;
    const startX = inicio.clientX, startY = inicio.clientY;
    let dragging = false;
    let target: number | null = null; // índice (en el orden ANTES de arrastrar) donde se insertaría
    let indicator: HTMLElement | null = null;

    const miniaturas = (): HTMLCanvasElement[] =>
      Array.from(this.thumbsEl.querySelectorAll<HTMLCanvasElement>('canvas.thumb'));

    const posicionarIndicador = (): void => {
      if (!indicator) return;
      const hijas = miniaturas();
      if (target === null || target >= hijas.length) this.thumbsEl.appendChild(indicator);
      else this.thumbsEl.insertBefore(indicator, hijas[target]!);
    };

    const limpiarVistaPrevia = (): void => {
      canvas.classList.remove('thumb-dragging');
      indicator?.remove();
      indicator = null;
    };

    registrarGesto({
      cancelarConEscape: true,
      onMove: (ev) => {
        const dx = ev.clientX - startX, dy = ev.clientY - startY;
        if (!dragging) {
          if (Math.hypot(dx, dy) < UMBRAL_ARRASTRE_PX) return;
          dragging = true;
          onDragLejos(true);
          canvas.classList.add('thumb-dragging');
          indicator = document.createElement('div');
          indicator.className = 'thumb-drop-indicator';
          this.thumbsEl.appendChild(indicator);
        }
        const hijas = miniaturas();
        let nuevoTarget = hijas.length;
        for (let i = 0; i < hijas.length; i++) {
          const rect = hijas[i]!.getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) { nuevoTarget = i; break; }
        }
        if (nuevoTarget !== target) { target = nuevoTarget; posicionarIndicador(); }
      },
      onUp: () => {
        const huboArrastre = dragging;
        const destino = target;
        limpiarVistaPrevia();
        if (!huboArrastre || destino === null) return;
        // Soltar justo donde ya estaba (antes o justo después de sí misma): no-op.
        if (destino === sourceIndex || destino === sourceIndex + 1) return;
        const to = destino > sourceIndex ? destino - 1 : destino;
        void this.commitReorder(sourceIndex, to);
      },
      onCancel: () => {
        // Escape o pointercancel (E-034): ningún MovePageCmd, solo se deshace la vista previa.
        limpiarVistaPrevia();
      }
    });
  }

  /** Aplica el reordenamiento (un único MovePageCmd) y sigue a la página movida. */
  private async commitReorder(fromIndex: number, toIndex: number): Promise<void> {
    if (!this.bus) return;
    await this.bus.execute(new MovePageCmd(fromIndex, toIndex));
    this.goToPage(toIndex);
    this.setStatus('Página reordenada.');
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

  /**
   * `#btn-fit-width`: calcula la escala para que la página ACTUAL ocupe el
   * ancho útil del visor (su `clientWidth` —ya sin la barra de scroll— menos
   * el padding CSS a los lados) y la aplica. También se llama al abrir un
   * documento (ver `openBytes`).
   *
   * Unidades: `page.sizePt.widthPt` es la anchura de la página en PUNTOS PDF;
   * `disponible` es px CSS del visor. La escala que iguala ambos en px CSS es
   * `disponible / widthPt` (mismo significado que `PageGeometry.scale`, que
   * multiplica puntos PDF por esta escala para obtener px CSS).
   */
  private fitWidth(): void {
    const s = this.session;
    const page = s?.model.pages[this.currentPage];
    if (!s || !this.viewer || !page) return;
    const cs = getComputedStyle(this.viewerEl);
    const paddingX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    const disponible = this.viewerEl.clientWidth - paddingX;
    if (disponible <= 0) return;
    this.scale = Math.min(4, Math.max(0.25, Math.round((disponible / page.sizePt.widthPt) * 100) / 100));
    this.viewer.setScale(this.scale);
    this.setStatus(`Ajustado al ancho (${Math.round(this.scale * 100)}%).`);
  }

  /**
   * `#btn-print`: genera el PDF actual (`engine.save`, sobre una copia — no
   * muta el documento vivo, igual que `save()`), lo carga en un `<iframe>`
   * oculto vía blob: y llama a `iframe.contentWindow.print()`. El visor PDF
   * NATIVO del navegador imprime así el PDF VECTORIAL real: mejor que
   * `window.print()` a secas, que solo pintaría el DOM y esta app únicamente
   * pinta las páginas visibles (visor virtualizado, ver `Viewer.renderVisible`).
   *
   * Pendiente de permiso del dueño (AGENTS.md §5, no se toca la CSP en este
   * PR): la CSP de producción (`vercel.json`) no declara `frame-src`, que cae
   * en `default-src 'self'` — no está confirmado si eso basta para navegar un
   * iframe a un blob: del propio origen o si el navegador lo bloquea. Por eso
   * hay dos redes de seguridad, ninguna de las cuales requiere tocar la CSP:
   * el oyente de `securitypolicyviolation` (el bloqueo no lanza excepción, así
   * que sin esto el usuario vería un iframe vacío y ningún diálogo) y el
   * `catch` de la llamada a `print()`. Ambas caen a abrir el PDF en una
   * pestaña nueva, desde donde el usuario imprime con el propio visor del
   * navegador (Ctrl/Cmd+P).
   *
   * Limpieza (revisión de PR #52, dos bugs corregidos):
   * - Revocar la blob: URL se retrasa un margen largo (60s) en TODOS los
   *   caminos, incluido el de respaldo: revocarla de inmediato, como antes,
   *   le arrancaba el PDF a la pestaña nueva de `window.open` antes de que
   *   terminara de cargarlo — recibía una blob: URL ya muerta y no mostraba
   *   nada. Quitar el iframe y sus oyentes es lo único que ocurre "ya".
   * - El iframe se retira cuando el navegador avisa con `afterprint` (se
   *   escucha en la ventana del propio iframe Y en la ventana principal, lo
   *   que llegue antes — algunos navegadores lo emiten en la que llamó a
   *   `print()`, otros en la de arriba), nunca con un temporizador corto: en
   *   un navegador donde `print()` no bloquea hasta cerrar el diálogo, un
   *   temporizador de pocos segundos podía vaciar la vista previa o cancelar
   *   la impresión a medio camino. Un respaldo largo (60s) evita dejar el
   *   iframe (y sus oyentes) para siempre si `afterprint` nunca llega.
   * - Una impresión nueva limpia primero cualquier intento anterior sin
   *   terminar (`limpiarImpresionAnterior`), para no ir acumulando iframes
   *   ocultos ni oyentes globales (E-014/E-020, AGENTS.md §2.6).
   */
  private print(): void {
    const s = this.session;
    if (!s) { this.setStatus('Abre un documento antes de imprimir.'); return; }

    this.limpiarImpresionAnterior?.();
    this.limpiarImpresionAnterior = null;

    const bytes = s.engine.save(s.doc);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));

    const iframe = document.createElement('iframe');
    iframe.className = 'print-frame'; // identifica el iframe de impresión (limpieza de intentos previos, tests)
    Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
    iframe.setAttribute('aria-hidden', 'true');

    let limpiado = false;
    let winImpresion: Window | null = null; // capturado tras 'load'; usado por quitarTodo para desengancharse de él
    const onAfterPrint = (): void => quitarTodo();
    const quitarTodo = (): void => {
      if (limpiado) return;
      limpiado = true;
      winImpresion?.removeEventListener?.('afterprint', onAfterPrint);
      window.removeEventListener('afterprint', onAfterPrint);
      document.removeEventListener('securitypolicyviolation', onCsp);
      iframe.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (this.limpiarImpresionAnterior === quitarTodo) this.limpiarImpresionAnterior = null;
    };
    this.limpiarImpresionAnterior = quitarTodo;

    const abrirEnPestana = (motivo: string): void => {
      quitarTodo();
      window.open(url, '_blank');
      this.setStatus(motivo);
    };
    const onCsp = (e: SecurityPolicyViolationEvent): void => {
      if (!e.blockedURI.startsWith('blob')) return; // otro recurso, no el nuestro
      abrirEnPestana('La política de seguridad bloqueó la vista previa; se abrió el PDF en una pestaña nueva para imprimir desde ahí.');
    };
    document.addEventListener('securitypolicyviolation', onCsp);

    iframe.addEventListener('load', () => {
      try {
        winImpresion = iframe.contentWindow;
        winImpresion?.focus();
        winImpresion?.print();
      } catch {
        abrirEnPestana('No se pudo imprimir desde el visor embebido; se abrió el PDF en una pestaña nueva.');
        return;
      }
      winImpresion?.addEventListener?.('afterprint', onAfterPrint);
      window.addEventListener('afterprint', onAfterPrint);
      setTimeout(onAfterPrint, 60_000); // respaldo si `afterprint` nunca llega
    });

    // `src` ANTES de insertar en el DOM: si se insertara primero sin `src`,
    // el iframe dispara un `load` inicial para `about:blank` y el manejador
    // de arriba llamaría a `print()` demasiado pronto, sobre un frame vacío.
    iframe.src = url;
    document.body.appendChild(iframe);
    this.setStatus('Abriendo el diálogo de impresión…');
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

  private download(data: BlobPart, filename: string, mimeType = 'application/pdf'): void {
    descargarArchivo(data, filename, mimeType);
  }

  /** Runs de texto de TODAS las páginas, agrupados en líneas de lectura (`estructura.ts`), en orden de página. */
  private allPagesLineas(): Linea[][] {
    const s = this.session;
    if (!s) return [];
    return s.model.pages.map((page) => agruparLineas(s.engine.getPageText(s.doc, page.index)));
  }

  /** `#btn-extract-text`: abre el diálogo de texto plano de todo el documento (#27 de la tabla de paridad, §9). */
  private openTextPanel(): void {
    if (!this.session) { this.setStatus('Abre un documento antes de extraer texto.'); return; }
    const texto = aTextoPlano(this.allPagesLineas());
    TextPanel.open(texto, this.docName.replace(/\.pdf$/i, ''));
  }

  /** `#btn-export-md`: descarga el Markdown estructurado de todo el documento (#31 de la tabla de paridad, §9). */
  private exportMarkdown(): void {
    if (!this.session) { this.setStatus('Abre un documento antes de exportar Markdown.'); return; }
    const md = aMarkdown(this.allPagesLineas());
    this.download(md, `${this.docName.replace(/\.pdf$/i, '')}.md`, 'text/markdown;charset=utf-8');
    this.setStatus('Markdown exportado.');
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
