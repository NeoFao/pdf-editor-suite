import { PdfiumEngine } from '../engine/pdfium/PdfiumEngine';
import { EditSession } from '../model/EditSession';
import { CommandBus } from '../commands/Command';
import { EditTextRunCmd } from '../commands/EditTextRun';
import { ReplaceRunFontCmd } from '../commands/ReplaceRunFont';
import { ReemplazarTextoCmd, type CambioTexto } from '../commands/ReemplazarTexto';
import { buscarEnRuns, aplicarReemplazos, type Coincidencia, type OpcionesBusqueda } from '../texto/buscarReemplazar';
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
import { AddMarkupCmd } from '../commands/AddMarkup';
import { quadsPorLinea } from '../coords/quads';
import type { MarkupKind } from '../engine/PdfEngine';
import { DrawStrokeCmd } from '../commands/DrawStroke';
import { DrawRectCmd } from '../commands/DrawRect';
import { OcrPageCmd } from '../commands/OcrPage';
import { TesseractOcr } from '../ocr/TesseractOcr';
import { FiltrarPaginaCmd, type TipoFiltro } from '../commands/FiltrarPagina';
import { ComprimirDocumentoCmd } from '../commands/ComprimirDocumento';
import { AnadirEncabezadoMarcaCmd, QuitarEncabezadosMarcasCmd } from '../commands/EncabezadoMarcaAgua';
import { EncabezadoPanel } from './EncabezadoPanel';
import { SignaturePad } from './SignaturePad';
import { CompressPanel } from './CompressPanel';
import { TextPanel } from './TextPanel';
import { agruparLineas, aTextoPlano, aMarkdown, type Linea } from '../texto/estructura';
import { conversorPara, registrarConversor } from '../convert/ConversorDocumento';
import { ConversorMarkdownNavegador } from '../convert/ConversorMarkdownNavegador';
import { ConversorDocxNavegador } from '../convert/ConversorDocxNavegador';
import { DocxError } from '../convert/docx/DocxError';
import { descargarArchivo } from './descargarArchivo';
import { quitarFondo } from './quitarFondo';
import { formatoBytes } from './formatoBytes';
import { registrarGesto } from './gesto';
import { resolverAtajo, esCampoEditable, type AccionAtajo } from './atajos';
import { AtajosPanel } from './AtajosPanel';
import { parseRange } from './pageRange';
import { Viewer, type ToolMode } from './Viewer';
import { calcularEscalaAjusteAncho } from './layout';
import type { EditRequest } from './TextLayer';
import { PageGeometry, type PtPoint } from '../coords/PageGeometry';
import type { RectPt } from '../engine/PdfEngine';
import { PanelMarcadores } from './PanelMarcadores';
import { SetOutlineCmd } from '../commands/SetOutline';
import { STANDARD_FONTS } from '../engine/standardFontFor';
import { stripSubsetPrefix } from '../engine/fontClassify';
import { ComentariosPanel } from './ComentariosPanel';
import { SetNoteTextCmd } from '../commands/SetNoteText';
import { RemoveNoteCmd } from '../commands/RemoveNote';
import { crearIcono, type NombreIcono } from './iconos';
import { contarRenderPage } from '../diagnostico';

/**
 * Pestañas de herramientas (rediseño de interfaz, §1 del encargo): agrupan
 * los controles de edición al estilo Acrobat, en vez de una única barra larga
 * de botones de texto. Cada pestaña tiene su `.context-bar` (§3), y solo la
 * de la pestaña activa se muestra en escritorio — en móvil todas se apilan
 * bajo el menú "⋯" heredado del PR #62 (ver el CSS, `estilos.css`).
 */
type PestanaId = 'editar' | 'comentar' | 'organizar' | 'firmar' | 'convertir';
const PESTANAS: { id: PestanaId; etiqueta: string }[] = [
  { id: 'editar', etiqueta: 'Editar' },
  { id: 'comentar', etiqueta: 'Comentar' },
  { id: 'organizar', etiqueta: 'Organizar' },
  { id: 'firmar', etiqueta: 'Rellenar y firmar' },
  { id: 'convertir', etiqueta: 'Convertir' }
];
/** Recuerda la pestaña activa entre sesiones (§1, "envuelto en try/catch": un origen con `localStorage` bloqueado no debe romper la app). */
const CLAVE_PESTANA_ACTIVA = 'pdf-editor:pestana-activa';
function leerPestanaGuardada(): PestanaId | null {
  try {
    const v = window.localStorage.getItem(CLAVE_PESTANA_ACTIVA);
    return PESTANAS.some((p) => p.id === v) ? (v as PestanaId) : null;
  } catch {
    return null;
  }
}
function guardarPestanaActiva(id: PestanaId): void {
  try { window.localStorage.setItem(CLAVE_PESTANA_ACTIVA, id); } catch { /* almacenamiento no disponible: no-op */ }
}

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

/**
 * Nº de páginas entre cada cesión del hilo principal en una operación de
 * documento completo (búsqueda, Texto…, Markdown — E-043,
 * docs/ERRORES-CONOCIDOS.md). Un valor bajo cede más a menudo (interfaz más
 * responsiva) a costa de más idas y vueltas al bucle de eventos; 20 mantiene
 * la sobrecarga baja (25 cesiones para 500 páginas) sin dejar de ceder con
 * frecuencia suficiente para que la interfaz responda.
 */
const PAGE_YIELD_CHUNK = 20;

/** Cede el hilo principal al bucle de eventos (deja pintar un frame, atender `pointermove`, etc.) antes de continuar. */
function cederHilo(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Resultado de recorrer el documento buscando para reemplazar: runs con coincidencias propias + nº de coincidencias que cruzan runs. */
interface EscaneoReemplazo {
  runs: { pageIndex: number; runId: number; texto: string; coincidencias: Coincidencia[] }[];
  cruzan: number;
}

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
   * pluma; `highlight` conserva el amarillo que ya traía el resaltador
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
  /** Ancho CSS (px) con el que se renderizaron las miniaturas la última vez — ver `buildThumbnails`/el `ResizeObserver` de `#thumbs`. */
  private thumbsRenderedWidthCss = 0;
  /** Ancho de RENDER (px de bitmap, ya × devicePixelRatio) fijado en el último `buildThumbnails()` — lo reutiliza `refreshThumbnail` para que una miniatura repintada sola no quede con otra resolución que sus vecinas. */
  private thumbsAnchoRenderPx = 0;
  /** Miniaturas perezosas (E-043, docs/ERRORES-CONOCIDOS.md): observador que pinta el bitmap de una miniatura la primera vez que entra (o casi entra, ver `rootMargin`) en el viewport de `#thumbs`. */
  private thumbObserver: IntersectionObserver | null = null;
  /** Páginas cuya miniatura YA tiene bitmap pintado (no placeholder). */
  private thumbRendered = new Set<number>();
  /** Orden en que se pintaron las miniaturas ya renderizadas — para desalojar las más antiguas si se acumulan demasiadas (`maybeEvictFarThumbs`). */
  private thumbRenderOrder: number[] = [];
  private readonly outlineEl: HTMLElement;
  private readonly outlineBarEl: HTMLElement;
  private panelMarcadores: PanelMarcadores | null = null;
  private readonly tabPages: HTMLButtonElement;
  private readonly tabOutline: HTMLButtonElement;
  private readonly tabComments: HTMLButtonElement;
  private readonly commentsEl: HTMLElement;
  private readonly comentarios: ComentariosPanel;
  private readonly status: HTMLElement;
  /** Aviso visible (no solo `#status`/consola) con las advertencias de una conversión Word/Markdown -> PDF (§9 fila #4: "no se pierde en silencio"). Oculto (`hidden`) cuando no hay advertencias pendientes. */
  private readonly avisoConversionEl: HTMLElement;
  private readonly avisoConversionLista: HTMLElement;
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
  /** Incrementado en cada `search()`: una búsqueda vieja que sigue en vuelo se abandona en cuanto detecta que ya no es la última (ver `search`). */
  private searchSeq = 0;
  // ── Buscar y reemplazar (Ctrl/Cmd+H) ──
  private replaceBar!: HTMLElement;
  private replaceInput!: HTMLInputElement;
  private optCase!: HTMLInputElement;
  private optWord!: HTMLInputElement;
  private btnReplace!: HTMLButtonElement;
  private btnReplaceAll!: HTMLButtonElement;
  private replaceResult!: HTMLElement;
  private btnReplaceToggle!: HTMLButtonElement;
  /** true mientras corre un reemplazo: evita solapar dos operaciones de documento completo. */
  private reemplazando = false;
  /** Posición tras la última coincidencia reemplazada (página, run, desplazamiento UTF-16): el siguiente "Reemplazar" busca A PARTIR de aquí, para no re-reemplazar lo recién escrito si contiene la consulta. */
  private cursorReemplazo: { pageIndex: number; runId: number; pos: number } | null = null;
  private readonly rangeInput: HTMLInputElement;
  private currentPage = 0;
  /** `#file-input`: se guarda como campo para poder disparar `.click()` desde el atajo Ctrl/Cmd+O (§9, #34). */
  private readonly fileInput: HTMLInputElement;
  /**
   * Cajón móvil (#35 de la tabla de paridad, §9): en escritorio `#sidebar`
   * (miniaturas/marcadores) es siempre visible, como hoy; en ≤768px pasa a
   * ser un cajón deslizante (ver el `<style>` de `index.next.html`) que
   * `#btn-drawer` abre/cierra. `drawerOpen` es el único punto de verdad de
   * su estado — todo lo que lo cierra (telón, Escape, elegir página) pasa
   * por `closeDrawer()`.
   */
  private drawerOpen = false;
  private readonly sidebarEl: HTMLElement;
  private readonly backdropEl: HTMLElement;
  private readonly btnDrawer: HTMLButtonElement;
  /** Foco a devolver al cerrar el cajón (normalmente `#btn-drawer`), como pide un diálogo modal accesible. */
  private drawerReturnFocus: HTMLElement | null = null;
  /**
   * Menú "⋯" móvil (`#toolbar-more`, #35): agrupa los controles secundarios
   * de la barra para que la barra principal no supere 2 filas en 390px (en
   * escritorio `#toolbar-more` es `display: contents` — sus hijos se ven
   * exactamente igual que si fueran hijos directos de `#toolbar`, sin cambio
   * visual respecto a antes de este PR).
   */
  private moreOpen = false;
  private readonly toolbarMoreEl: HTMLElement;
  private readonly btnMore: HTMLButtonElement;
  /** Pestaña de herramientas activa (§1 del rediseño de interfaz) — único punto de verdad, ver `activarPestana`. */
  private tabActiva: PestanaId = 'editar';
  private readonly tabButtons: Record<PestanaId, HTMLButtonElement> = {} as Record<PestanaId, HTMLButtonElement>;
  private readonly contextBars: Record<PestanaId, HTMLElement> = {} as Record<PestanaId, HTMLElement>;
  private readonly tablistEl: HTMLElement;
  private readonly docNameEl: HTMLElement;
  private readonly zoomPctEl: HTMLElement;

  constructor(rootEl: HTMLElement) {
    rootEl.textContent = '';

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'application/pdf,.md,.markdown,text/markdown,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.doc,application/msword';
    file.id = 'file-input';
    file.addEventListener('change', () => { const f = file.files?.[0]; if (f) void this.openFile(f); });
    file.style.display = 'none';
    this.fileInput = file;

    const btnNew = this.iconBoton('documento-nuevo', 'Nuevo', 'btn-new', () => void this.newBlank());

    const openImg = document.createElement('input');
    openImg.type = 'file'; openImg.accept = 'image/*'; openImg.id = 'btn-open-image';
    openImg.addEventListener('change', () => { const f = openImg.files?.[0]; if (f) void this.openImage(f).finally(() => { openImg.value = ''; }); });
    const btnOpenImg = this.campoArchivo(openImg, 'imagen', 'Abrir una imagen como PDF', 'btn-open-image-trigger');

    this.btnInsert = this.iconBoton('insertar-texto', 'Insertar texto', 'btn-insert', () => this.setTool(this.tool === 'insert' ? 'none' : 'insert'), { mostrarEtiqueta: true });
    const btnDelete = this.iconBoton('redactar', 'Borrar', 'btn-delete', () => this.deleteSelected(), { mostrarEtiqueta: true });
    const btnHighlight = this.iconBoton('resaltar', 'Resaltar', 'btn-highlight', () => this.highlightSelected(), { mostrarEtiqueta: true });
    const btnUnderline = this.iconBoton('subrayar', 'Subrayar', 'btn-underline', () => this.underlineSelected(), { mostrarEtiqueta: true });
    const btnStrike = this.iconBoton('tachar', 'Tachar', 'btn-strike', () => this.strikeSelected(), { mostrarEtiqueta: true });
    const btnSign = this.iconBoton('firmar', 'Firmar', 'btn-sign', () => this.openSignature(), { mostrarEtiqueta: true });
    const signUpload = document.createElement('input');
    signUpload.type = 'file'; signUpload.accept = 'image/*'; signUpload.id = 'btn-sign-upload';
    signUpload.addEventListener('change', () => {
      const f = signUpload.files?.[0];
      if (f) void this.handleSignUpload(f).finally(() => { signUpload.value = ''; });
    });
    const btnSignUpload = this.campoArchivo(signUpload, 'firma-imagen', 'Firma desde imagen', 'btn-sign-upload-trigger', { mostrarEtiqueta: true });
    btnSignUpload.title = 'Firma desde imagen (quita el fondo blanco automáticamente)';
    this.btnPen = this.iconBoton('pluma', 'Pluma', 'btn-pen', () => this.setTool(this.tool === 'pen' ? 'none' : 'pen'), { mostrarEtiqueta: true });
    this.btnNote = this.iconBoton('nota', 'Nota', 'btn-note', () => this.setTool(this.tool === 'note' ? 'none' : 'note'), { mostrarEtiqueta: true });
    this.btnRect = this.iconBoton('rectangulo', 'Rectángulo', 'btn-rect', () => this.setTool(this.tool === 'rect' ? 'none' : 'rect'), { mostrarEtiqueta: true });
    this.btnEraser = this.iconBoton('borrador', 'Borrador', 'btn-eraser', () => this.setTool(this.tool === 'eraser' ? 'none' : 'eraser'), { mostrarEtiqueta: true });
    this.btnOcr = this.iconBoton('ocr', 'OCR', 'btn-ocr', () => void this.runOcr(), { mostrarEtiqueta: true });
    // Texto plano de todo el documento (#27 de la tabla de paridad, §9): abre
    // el diálogo de copiar/descargar .txt (TextPanel), mismo espíritu que el
    // modal de OCR de la app vieja. También sirve para leer el texto que un
    // OCR acaba de reconocer, sin que el diálogo se abra solo (ver el estado
    // que deja `runOcr`).
    const btnExtractText = this.iconBoton('texto-panel', 'Texto…', 'btn-extract-text', () => void this.openTextPanel(), { mostrarEtiqueta: true });
    // Exportar Markdown estructurado de todo el documento (#31 de la tabla de
    // paridad, §9): descarga directa, sin diálogo previo — como
    // `exportPDFToMarkdown` en la app vieja.
    const btnExportMd = this.iconBoton('exportar-md', 'Exportar Markdown', 'btn-export-md', () => void this.exportMarkdown(), { mostrarEtiqueta: true });

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
    this.btnFilter = this.iconBoton('filtro', 'Aplicar filtro', 'btn-filter', () => void this.applyImageFilter(), { mostrarEtiqueta: true });

    // Comprimir documento (#26 → #29 de la tabla de paridad, §9): abre un
    // panel pequeño (calidad + dpi máximo) y comprime solo los objetos
    // imagen de TODAS las páginas.
    this.btnCompress = this.iconBoton('comprimir', 'Comprimir', 'btn-compress', () => this.openCompressPanel(), { mostrarEtiqueta: true });

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
        // A-07 (WCAG 2.5.8): área clicable de 24x24 px CSS; el cuadro de color que se
        // ve sigue siendo de 18x18 (24 - 2*3 de padding, `background-clip: content-box`).
        width: '24px', height: '24px', padding: '3px', boxSizing: 'border-box', borderRadius: '3px', cursor: 'pointer',
        background: color, backgroundClip: 'content-box', border: '0'
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

    const fontLabel = document.createElement('label');
    fontLabel.append('Fuente:');
    this.propFont = document.createElement('select');
    this.propFont.id = 'prop-font';
    this.propFont.title = 'Fuente de la línea seleccionada';
    this.propFont.addEventListener('change', () => void this.applyFont());
    fontLabel.appendChild(this.propFont);

    const sizeLabel = document.createElement('label');
    sizeLabel.append('Tamaño:');
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
    this.searchInput.addEventListener('input', () => void this.search());
    const searchBox = document.createElement('div');
    searchBox.className = 'search-box';
    searchBox.appendChild(crearIcono('buscar'));
    searchBox.appendChild(this.searchInput);

    this.searchInput.addEventListener('input', () => { this.cursorReemplazo = null; });
    this.construirBarraReemplazo();

    const btnPrev = this.iconBoton('flecha-izq', 'Página anterior', 'btn-prev', () => this.goToPage(this.currentPage - 1));
    const btnNext = this.iconBoton('flecha-der', 'Página siguiente', 'btn-next', () => this.goToPage(this.currentPage + 1));
    const btnRotate = this.iconBoton('rotar', 'Rotar', 'btn-rotate', () => { if (this.bus) void this.bus.execute(new RotatePageCmd(this.currentPage, 90)); }, { mostrarEtiqueta: true });
    const btnDeletePage = this.iconBoton('eliminar-pagina', 'Eliminar página', 'btn-delete-page', () => this.deleteCurrentPage(), { mostrarEtiqueta: true });
    const btnDuplicate = this.iconBoton('duplicar', 'Duplicar', 'btn-duplicate', () => { if (this.bus) void this.bus.execute(new DuplicatePageCmd(this.currentPage)); }, { mostrarEtiqueta: true });
    const btnPageUp = this.iconBoton('subir', 'Subir', 'btn-page-up', () => this.moveCurrentPage(-1), { mostrarEtiqueta: true });
    const btnPageDown = this.iconBoton('bajar', 'Bajar', 'btn-page-down', () => this.moveCurrentPage(1), { mostrarEtiqueta: true });

    const btnEncabezado = this.iconBoton('encabezado', 'Encabezado y marca', 'btn-encabezado', () => this.abrirEncabezado(), { mostrarEtiqueta: true });
    btnEncabezado.title = 'Encabezado, pie, numeración y marca de agua';

    const insertPdf = document.createElement('input');
    insertPdf.type = 'file'; insertPdf.accept = 'application/pdf'; insertPdf.id = 'btn-insert-pdf';
    insertPdf.addEventListener('change', () => { const f = insertPdf.files?.[0]; if (f) void this.handleInsertPdf(f).finally(() => { insertPdf.value = ''; }); });
    const btnInsertPdf = this.campoArchivo(insertPdf, 'insertar-pdf', 'Insertar PDF', 'btn-insert-pdf-trigger', { mostrarEtiqueta: true });
    btnInsertPdf.title = 'Insertar otro PDF tras la página actual';

    const insertImage = document.createElement('input');
    insertImage.type = 'file'; insertImage.accept = 'image/*'; insertImage.id = 'btn-insert-image';
    insertImage.addEventListener('change', () => { const f = insertImage.files?.[0]; if (f) void this.handleInsertImage(f).finally(() => { insertImage.value = ''; }); });
    const btnInsertImage = this.campoArchivo(insertImage, 'imagen', 'Insertar imagen', 'btn-insert-image-trigger', { mostrarEtiqueta: true });
    btnInsertImage.title = 'Insertar una imagen en la página actual';

    this.pageIndicator = document.createElement('span');
    this.pageIndicator.id = 'page-indicator'; this.pageIndicator.textContent = '– / –';

    this.zoomPctEl = document.createElement('span');
    this.zoomPctEl.id = 'zoom-pct'; this.zoomPctEl.className = 'zoom-pct'; this.zoomPctEl.textContent = '100%';
    const btnZoomOut = this.iconBoton('menos', 'Alejar', 'btn-zoom-out', () => this.zoom(1 / 1.25));
    const btnZoomIn = this.iconBoton('mas', 'Acercar', 'btn-zoom-in', () => this.zoom(1.25));
    const btnFitWidth = this.iconBoton('ajustar-ancho', 'Ajustar al ancho', 'btn-fit-width', () => this.fitWidth());
    const btnExtract = this.iconBoton('extraer', 'Extraer', 'btn-extract', () => this.extractCurrent(), { mostrarEtiqueta: true });
    this.rangeInput = document.createElement('input');
    this.rangeInput.type = 'text'; this.rangeInput.id = 'btn-range'; this.rangeInput.placeholder = '1-3,5'; this.rangeInput.size = 6;
    this.rangeInput.title = 'Rango de páginas a dividir (ej.: 1-3,5)';
    const btnSplit = this.iconBoton('dividir', 'Dividir', 'btn-split', () => this.splitByRange(), { mostrarEtiqueta: true });
    const btnSave = this.iconBoton('guardar', 'Guardar', 'btn-save', () => { void this.save(); });
    const btnPrint = this.iconBoton('imprimir', 'Imprimir', 'btn-print', () => { void this.print(); });
    const btnUndo = this.iconBoton('deshacer', 'Deshacer', 'btn-undo', () => { void this.bus?.undo(); });
    const btnRedo = this.iconBoton('rehacer', 'Rehacer', 'btn-redo', () => { void this.bus?.redo(); });

    this.status = document.createElement('span');
    this.status.id = 'status';
    // A-01 (WCAG 4.1.3): los cambios de estado se anuncian a los lectores de pantalla.
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');

    const btnShortcuts = document.createElement('button');
    btnShortcuts.type = 'button'; btnShortcuts.id = 'btn-shortcuts'; btnShortcuts.className = 'icon-btn';
    btnShortcuts.textContent = '?';
    btnShortcuts.title = 'Atajos de teclado';
    btnShortcuts.setAttribute('aria-label', 'Mostrar los atajos de teclado');
    btnShortcuts.addEventListener('click', () => AtajosPanel.open());

    // Cajón móvil (§9 #35): abre/cierra `#sidebar` en ≤768px. Oculto por
    // completo en escritorio (CSS), donde el panel lateral ya es siempre
    // visible y este botón no tendría nada que hacer.
    this.btnDrawer = this.iconBoton('menu', 'Páginas y marcadores', 'btn-drawer', () => this.toggleDrawer());
    this.btnDrawer.setAttribute('aria-controls', 'sidebar');
    this.btnDrawer.setAttribute('aria-expanded', 'false');

    // Menú "⋯" móvil (§9 #35, reutilizado en el rediseño para agrupar TODAS
    // las barras contextuales en móvil, ver estilos.css): revela
    // `#toolbar-more`. Oculto en escritorio, donde las pestañas ya cumplen
    // ese papel.
    this.btnMore = this.iconBoton('mas-opciones', 'Más herramientas', 'btn-more', () => this.toggleMore());
    this.btnMore.setAttribute('aria-controls', 'toolbar-more');
    this.btnMore.setAttribute('aria-expanded', 'false');

    // Disparador compacto de `#file-input` (oculto siempre, §5 del encargo):
    // el mismo botón sirve en escritorio y en móvil — antes de este PR solo
    // existía la versión móvil (el input nativo se veía en escritorio).
    const btnOpenMobile = this.iconBoton('carpeta-abrir', 'Abrir un archivo', 'btn-open-mobile', () => this.fileInput.click());

    // ── Barra superior (§1 del rediseño): nombre del documento, abrir/
    // nuevo/guardar/imprimir/deshacer/rehacer, zoom, búsqueda y ayuda. Se ve
    // siempre, sin importar la pestaña de herramientas activa.
    this.docNameEl = document.createElement('span');
    this.docNameEl.className = 'doc-name';
    this.docNameEl.textContent = 'Sin documento';

    const topbar = document.createElement('div');
    topbar.className = 'topbar';
    const grupoAbrir = document.createElement('div');
    grupoAbrir.className = 'topbar-group';
    grupoAbrir.append(file, btnOpenMobile, btnOpenImg, openImg, btnNew);
    const grupoDeshacer = document.createElement('div');
    grupoDeshacer.className = 'topbar-group';
    grupoDeshacer.append(btnUndo, btnRedo);
    const grupoGuardar = document.createElement('div');
    grupoGuardar.className = 'topbar-group';
    grupoGuardar.append(btnSave, btnPrint);
    const grupoZoom = document.createElement('div');
    grupoZoom.className = 'topbar-group';
    grupoZoom.append(btnZoomOut, this.zoomPctEl, btnZoomIn, btnFitWidth);
    // `#btn-drawer`/`#btn-more` viven FUERA de `.topbar-scroll` a propósito
    // (revisión de PR #63): en móvil, `.topbar-scroll` es la que desplaza
    // horizontalmente (`overflow-x: auto`) — si los botones fijos fueran
    // `position: sticky` DENTRO de esa fila, se solapan con el contenido de
    // al lado en vez de reservarle hueco (un `sticky` en un flex que
    // desborda no aparta espacio en su posición fija, así que "engancha" por
    // encima del elemento que le quede debajo, p. ej. taba el "100%" del
    // zoom). Como hijos normales de `.topbar` (que no desplaza) a los lados
    // de `.topbar-scroll` (`flex: 1`, la única que desplaza), quedan
    // SIEMPRE en su sitio sin tapar nada — sin necesidad de `sticky`.
    const topbarScroll = document.createElement('div');
    topbarScroll.className = 'topbar-scroll';
    topbarScroll.append(
      this.docNameEl, this.separador('topbar-sep'),
      grupoAbrir, this.separador('topbar-sep'),
      grupoDeshacer, this.separador('topbar-sep'),
      grupoGuardar,
      Object.assign(document.createElement('div'), { className: 'topbar-spacer' }),
      grupoZoom, this.separador('topbar-sep'),
      searchBox, this.btnReplaceToggle, this.separador('topbar-sep'),
      btnShortcuts
    );
    topbar.append(this.btnDrawer, topbarScroll, this.btnMore);

    // ── Pestañas de herramientas (role="tablist", §1): flechas izq/der
    // mueven el foco entre pestañas (patrón WAI-ARIA de pestañas).
    this.tablistEl = document.createElement('div');
    this.tablistEl.className = 'tablist';
    this.tablistEl.setAttribute('role', 'tablist');
    this.tablistEl.setAttribute('aria-label', 'Herramientas');
    for (const p of PESTANAS) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.id = `tab-${p.id}`;
      tab.className = 'tab';
      tab.textContent = p.etiqueta;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', 'false');
      tab.setAttribute('aria-controls', `panel-${p.id}`);
      tab.addEventListener('click', () => this.activarPestana(p.id));
      this.tabButtons[p.id] = tab;
      this.tablistEl.appendChild(tab);
    }
    this.tablistEl.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const i = PESTANAS.findIndex((p) => p.id === this.tabActiva);
      const siguiente = e.key === 'ArrowRight' ? (i + 1) % PESTANAS.length : (i - 1 + PESTANAS.length) % PESTANAS.length;
      const destino = PESTANAS[siguiente]!.id;
      this.activarPestana(destino);
      this.tabButtons[destino].focus();
    });

    const crearBarraContextual = (id: PestanaId, hijos: (HTMLElement | undefined)[]): HTMLElement => {
      const bar = document.createElement('div');
      bar.className = 'context-bar';
      bar.id = `panel-${id}`;
      bar.dataset.tab = id;
      bar.setAttribute('role', 'tabpanel');
      bar.setAttribute('aria-labelledby', `tab-${id}`);
      bar.append(...hijos.filter((h): h is HTMLElement => !!h));
      this.contextBars[id] = bar;
      return bar;
    };

    const barraEditar = crearBarraContextual('editar', [
      this.btnInsert, btnDelete, insertImage, btnInsertImage, this.btnOcr,
      this.separador(), this.propsPanel
    ]);
    const barraComentar = crearBarraContextual('comentar', [
      btnHighlight, btnUnderline, btnStrike, this.btnNote, this.btnPen, this.btnRect, this.btnEraser,
      this.separador(), swatchesEl
    ]);
    const barraOrganizar = crearBarraContextual('organizar', [
      btnEncabezado, btnRotate, btnDeletePage, btnDuplicate, btnPageUp, btnPageDown,
      insertPdf, btnInsertPdf, btnExtract,
      this.separador(), this.rangeInput, btnSplit
    ]);
    const barraFirmar = crearBarraContextual('firmar', [btnSign, signUpload, btnSignUpload]);
    const barraConvertir = crearBarraContextual('convertir', [
      btnExtractText, btnExportMd, this.separador(), this.filterSelect, this.btnFilter, this.btnCompress
    ]);

    // `#toolbar-more` agrupa pestañas + barras contextuales (ver el
    // comentario junto a `.tablist`/`#toolbar-more` en estilos.css: en móvil
    // es el mismo contenedor que revela `#btn-more`).
    this.toolbarMoreEl = document.createElement('div');
    this.toolbarMoreEl.id = 'toolbar-more';
    this.toolbarMoreEl.append(this.tablistEl, barraEditar, barraComentar, barraOrganizar, barraFirmar, barraConvertir);

    const toolbarWrap = document.createElement('div');
    toolbarWrap.id = 'toolbar';
    toolbarWrap.append(topbar, this.replaceBar, this.toolbarMoreEl);
    rootEl.appendChild(toolbarWrap);

    // Aviso de advertencias de conversión (§9 fila #4: "NO se pierde en
    // silencio"): una franja visible bajo la barra de herramientas, oculta
    // hasta que `mostrarAvisoConversion()` la rellena. `textContent` en cada
    // advertencia (nunca `innerHTML`: son cadenas propias, pero el patrón se
    // mantiene uniforme en todo el archivo — AGENTS.md §2.2).
    this.avisoConversionEl = document.createElement('div');
    this.avisoConversionEl.id = 'conversion-warnings';
    this.avisoConversionEl.className = 'conversion-warnings';
    this.avisoConversionEl.hidden = true;
    this.avisoConversionEl.setAttribute('role', 'status');
    this.avisoConversionEl.setAttribute('aria-live', 'polite'); // A-08
    const avisoCabecera = document.createElement('div');
    avisoCabecera.className = 'conversion-warnings-header';
    const avisoTitulo = document.createElement('strong');
    avisoTitulo.textContent = 'La conversión omitió algo del documento original:';
    const avisoCerrar = document.createElement('button');
    avisoCerrar.type = 'button';
    avisoCerrar.id = 'conversion-warnings-close';
    avisoCerrar.className = 'conversion-warnings-close';
    avisoCerrar.textContent = '×';
    avisoCerrar.title = 'Cerrar aviso';
    avisoCerrar.setAttribute('aria-label', 'Cerrar aviso de advertencias de conversión');
    avisoCerrar.addEventListener('click', () => { this.avisoConversionEl.hidden = true; });
    avisoCabecera.append(avisoTitulo, avisoCerrar);
    this.avisoConversionLista = document.createElement('ul');
    this.avisoConversionLista.className = 'conversion-warnings-list';
    this.avisoConversionEl.append(avisoCabecera, this.avisoConversionLista);
    rootEl.appendChild(this.avisoConversionEl);

    this.activarPestana(leerPestanaGuardada() ?? 'editar');

    // Telón de fondo del cajón móvil (§9 #35): clic cierra el cajón.
    // Colocado DENTRO de `area` (más abajo), no de `rootEl` — como `area`
    // (position: relative) empieza justo debajo de `#toolbar`, un
    // `position: absolute` anclado a ella nunca se sale por encima de la
    // barra: E-025 en la app vieja fue exactamente este defecto (el telón
    // tapaba la cabecera) pero con `position: fixed` a toda la ventana. Aquí
    // se evita por construcción, sin tener que medir la altura de la barra.
    this.backdropEl = document.createElement('div');
    this.backdropEl.id = 'drawer-backdrop';
    this.backdropEl.addEventListener('click', () => this.closeDrawer());

    // Área inferior: panel lateral (izquierda) + visor (derecha).
    const area = document.createElement('div');
    area.className = 'workarea';

    // Panel lateral: dos pestañas ("Páginas"/"Marcadores") que alternan entre
    // las miniaturas y el árbol de marcadores dentro del mismo hueco.
    const sidebar = document.createElement('div');
    sidebar.id = 'sidebar';
    // Atrapa el Tab dentro del cajón mientras está abierto (foco "razonable",
    // no exhaustivo): con el cajón cerrado el elemento ni siquiera es
    // alcanzable por tabulación normal en móvil salvo por script.
    sidebar.addEventListener('keydown', (e) => this.trapFocoCajon(e));
    this.sidebarEl = sidebar;

    const tabs = document.createElement('div');
    tabs.className = 'sidebar-tabs';
    tabs.setAttribute('role', 'tablist');
    this.tabPages = this.button('Páginas', 'tab-pages', () => this.showSidebarTab('pages'));
    this.tabOutline = this.button('Marcadores', 'tab-outline', () => this.showSidebarTab('outline'));
    this.tabComments = this.button('Comentarios', 'tab-comments', () => this.showSidebarTab('comments'));
    this.tabPages.className = 'tab';
    this.tabOutline.className = 'tab';
    this.tabComments.className = 'tab';
    tabs.append(this.tabPages, this.tabOutline, this.tabComments);

    this.thumbsEl = document.createElement('div');
    this.thumbsEl.id = 'thumbs';

    this.outlineEl = document.createElement('div');
    this.outlineEl.id = 'outline-panel';
    this.outlineEl.style.display = 'none';

    this.commentsEl = document.createElement('div');
    this.commentsEl.id = 'comments-panel';
    this.commentsEl.style.display = 'none';
    this.comentarios = new ComentariosPanel(this.commentsEl, {
      totalPaginas: () => this.session?.model.pages.length ?? 0,
      leerPagina: (i) => (this.session ? this.session.engine.getComments(this.session.doc, i) : []),
      irAPagina: (i) => this.goToPage(i),
      resaltar: (p, a) => this.viewer?.resaltarNota(p, a),
      editar: (p, a, t) => { void this.bus?.execute(new SetNoteTextCmd(p, a, t)); this.setStatus('Comentario editado.'); },
      borrar: (p, a) => { void this.bus?.execute(new RemoveNoteCmd(p, a)); this.setStatus('Comentario borrado.'); }
    });

    this.outlineBarEl = document.createElement('div');
    this.outlineBarEl.id = 'outline-toolbar';
    this.outlineBarEl.style.display = 'none';
    sidebar.append(tabs, this.outlineBarEl, this.thumbsEl, this.outlineEl, this.commentsEl);

    this.viewerEl = document.createElement('div');
    this.viewerEl.id = 'viewer';
    // Focuseable por script (sin entrar en el orden de tabulación) para que,
    // tras hacer clic sobre él o sobre una página, PageUp/PageDown/flechas/
    // Home/End/espacio puedan desplazarlo: el navegador solo aplica el
    // scroll por teclado a un contenedor desplazable con foco (E-032, ver
    // Viewer.programmaticScroll).
    this.viewerEl.tabIndex = -1;

    area.append(sidebar, this.backdropEl, this.viewerEl);
    rootEl.appendChild(area);
    this.showSidebarTab('pages');

    // Revisión de PR #63: las miniaturas se renderizaban a una resolución
    // fija (120/90 px) y luego se estiraban con CSS (`width: 100%`) al ancho
    // real del panel — hasta 320px en el cajón móvil — así que en cualquier
    // pantalla con `devicePixelRatio` > 1 (la inmensa mayoría de móviles) se
    // veían borrosas. `buildThumbnails()` ahora mide el ancho REAL en que se
    // muestran (`anchoUtilThumbs()`) y renderiza a ese ancho × `devicePixelRatio`
    // (con un tope). Ese ancho cambia si la ventana cambia de tamaño (o de
    // orientación) — nunca por abrir/cerrar el cajón, que solo mueve
    // `#sidebar` con `transform` (no toca su `width`, así que no dispara este
    // observer) — así que un `ResizeObserver` sobre `#thumbs` vuelve a
    // construirlas cuando el ancho cambia de verdad. Sin riesgo de bucle:
    // `buildThumbnails()` solo cambia el CONTENIDO de `#thumbs`, nunca su
    // ancho (fijado por el flex/grid de `#sidebar`), así que reconstruir
    // nunca dispara este mismo observer.
    new ResizeObserver(() => {
      if (!this.session) return;
      const anchoActual = this.anchoUtilThumbs();
      if (Math.abs(anchoActual - this.thumbsRenderedWidthCss) > 4) this.buildThumbnails();
    }).observe(this.thumbsEl);

    // ── Barra de estado inferior (§1): `#status` a la izquierda, indicador
    // de página + prev/next a la derecha.
    const statusbar = document.createElement('div');
    statusbar.className = 'statusbar';
    const pageNav = document.createElement('div');
    pageNav.className = 'page-nav';
    pageNav.append(btnPrev, this.pageIndicator, btnNext);
    statusbar.append(this.status, pageNav);
    rootEl.appendChild(statusbar);

    // Atajos de teclado (§9 #34): la tabla declarativa y la regla de oro del
    // foco editable viven en `atajos.ts` (testeadas en Node, sin DOM); aquí
    // solo se normaliza el `KeyboardEvent` y se ejecuta la acción resuelta.
    document.addEventListener('keydown', (e) => {
      // El cajón/menú móviles cierran con Escape ANTES que cualquier otro
      // atajo — si el cajón está abierto, Escape es "cerrar cajón", no
      // "salir de herramienta" ni ninguna otra cosa.
      if (e.key === 'Escape' && this.drawerOpen) { e.preventDefault(); this.closeDrawer(); return; }
      if (e.key === 'Escape' && this.moreOpen) { e.preventDefault(); this.closeMore(); return; }

      const def = resolverAtajo({
        key: e.key,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        shift: e.shiftKey,
        alt: e.altKey,
        editable: esCampoEditable(e.target)
      });
      if (def) this.ejecutarAtajo(def.accion, e);
    });

    // Arrastrar y soltar un fichero (PDF o imagen) sobre la ventana entera.
    // `dragover` necesita `preventDefault()` para que el navegador permita el
    // `drop` (si no, su acción por defecto es navegar al fichero); la clase
    // `drop-activo` (ver src/ui/estilos.css) es la única indicación
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

  /** Un PDF abre normal; un Markdown o un .docx se convierten a PDF (vía `openFile`); una imagen se convierte a PDF de una página (mismo flujo que `#btn-open-image`). Un `.doc` antiguo o cualquier otro tipo: aviso en `#status`, sin romper nada. */
  private async handleDroppedFile(file: File): Promise<void> {
    const esPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (esPdf) { await this.openFile(file); return; }
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (ext === 'doc' || conversorPara(ext)) { await this.openFile(file); return; }
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
   * Botón de icono (rediseño de interfaz, §3/§4 del encargo): icono SVG
   * propio (`iconos.ts`) + `title`/`aria-label` siempre, etiqueta visible
   * opcional (la barra contextual la muestra debajo del icono, al estilo
   * Acrobat; la barra superior solo el icono, con el mismo texto en
   * `title`/`aria-label` para lectores de pantalla y el tooltip nativo).
   */
  private iconBoton(icono: NombreIcono, etiqueta: string, id: string, onClick: () => void, opts?: { mostrarEtiqueta?: boolean }): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.id = id;
    b.className = 'icon-btn';
    b.title = etiqueta;
    b.setAttribute('aria-label', etiqueta);
    b.appendChild(crearIcono(icono));
    if (opts?.mostrarEtiqueta) {
      const span = document.createElement('span');
      span.className = 'etiqueta';
      span.textContent = etiqueta;
      b.appendChild(span);
    }
    b.addEventListener('click', onClick);
    return b;
  }

  /**
   * Un `<input type="file">` oculto (id conservado — varios tests lo llenan
   * directamente con `setInputFiles`, que funciona con el input oculto: no
   * necesita visibilidad, a diferencia de `.click()`) más el botón de icono
   * que lo dispara (§5 del encargo: "ningún input nativo visible").
   */
  private campoArchivo(input: HTMLInputElement, icono: NombreIcono, etiqueta: string, idBoton: string, opts?: { mostrarEtiqueta?: boolean }): HTMLButtonElement {
    input.style.display = 'none';
    return this.iconBoton(icono, etiqueta, idBoton, () => input.click(), opts);
  }

  private separador(clase: 'topbar-sep' | 'context-sep' = 'context-sep'): HTMLElement {
    const s = document.createElement('div');
    s.className = clase;
    return s;
  }

  /**
   * Único punto de entrada para cambiar la pestaña de herramientas activa
   * (§1 del rediseño de interfaz): actualiza `aria-selected`/clase de las
   * pestañas, muestra solo la `.context-bar` correspondiente (en escritorio;
   * en móvil el CSS las apila todas bajo "⋯", ver `estilos.css`) y persiste
   * la elección en `localStorage` (envuelto en try/catch, `guardarPestanaActiva`).
   */
  private activarPestana(id: PestanaId): void {
    this.tabActiva = id;
    for (const p of PESTANAS) {
      const activa = p.id === id;
      const tab = this.tabButtons[p.id];
      tab.setAttribute('aria-selected', String(activa));
      tab.tabIndex = activa ? 0 : -1;
      this.contextBars[p.id].classList.toggle('activa', activa);
    }
    guardarPestanaActiva(id);
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
      // Conversor .docx (§9 fila #4, fase 1): mismo puerto, mismo motor —
      // una futura app de escritorio podrá registrar aquí OTRA
      // implementación (LibreOffice/Word instalados) sin tocar `App.ts`.
      registrarConversor(new ConversorDocxNavegador(this.engine));
    }
    return this.engine;
  }

  /**
   * Punto de entrada único para abrir un fichero desde `#file-input` o
   * soltarlo en la ventana (`handleDroppedFile`). Un PDF se abre tal cual;
   * si la extensión la acepta algún conversor registrado (`.md`/
   * `.markdown`/`.docx`), se convierte primero y se abre el PDF resultante
   * como documento normal — el nombre sugerido para guardar pasa a ser
   * `<nombre>.pdf`. `.doc` (Word 97 binario, no es un ZIP): mensaje claro en
   * vez de intentar convertirlo. Si la conversión falla (`.docx` corrupto u
   * hostil, ver `DocxError`), el aviso se muestra en `#status` y el
   * documento actual no se toca.
   */
  async openFile(file: File): Promise<void> {
    const engine = await this.ensureEngine();
    const ext = (file.name.split('.').pop() ?? '').toLowerCase();
    if (ext === 'doc') {
      this.setStatus('Formato .doc antiguo no soportado; guárdalo como .docx.');
      return;
    }
    const conversor = conversorPara(ext);
    if (conversor) {
      this.setStatus('Convirtiendo…');
      const bytes = new Uint8Array(await file.arrayBuffer());
      let resultado;
      try {
        resultado = await conversor.convertir(file.name, bytes);
      } catch (err) {
        if (err instanceof DocxError) { this.setStatus(err.message); return; }
        throw err;
      }
      const pdfName = file.name.replace(/\.[^./\\]+$/, '') + '.pdf';
      await this.openBytes(resultado.pdf, pdfName);
      const n = this.session ? engine.pageCount(this.session.doc) : 0;
      this.setStatus(`Convertido desde ${conversor.nombreFuente} (${n} páginas).`);
      if (resultado.advertencias.length > 0) this.mostrarAvisoConversion(resultado.advertencias);
      return;
    }
    await this.openBytes(new Uint8Array(await file.arrayBuffer()), file.name || 'documento.pdf');
  }

  /** Rellena y muestra el aviso visible de advertencias de conversión (ver el campo `avisoConversionEl`). */
  private mostrarAvisoConversion(advertencias: string[]): void {
    this.avisoConversionLista.textContent = '';
    for (const texto of advertencias) {
      const li = document.createElement('li');
      li.textContent = texto;
      this.avisoConversionLista.appendChild(li);
    }
    this.avisoConversionEl.hidden = false;
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
    // Cualquier carga de documento nueva empieza sin el aviso de la
    // conversión anterior visible; `openFile` lo vuelve a mostrar justo
    // después de esta llamada si la conversión que acaba de terminar trae
    // advertencias.
    this.avisoConversionEl.hidden = true;
    const engine = await this.ensureEngine();
    if (this.session) engine.close(this.session.doc);
    this.docName = name;
    this.docNameEl.textContent = name;
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
    // Tras una operación que cambia el CONJUNTO de páginas (eliminar/mover/
    // duplicar/insertar PDF → EditSession.refresh(), onReload), rehacer
    // miniaturas y marcadores enteros — sus índices ya no significan lo
    // mismo. `buildThumbnails()` es perezosa (E-043): esto NO vuelve a
    // renderizar las N páginas de golpe, solo recrea los placeholders.
    this.session.model.onReload(() => {
      const total = this.session?.model.pages.length ?? 0;
      if (this.currentPage >= total) this.currentPage = Math.max(0, total - 1);
      this.buildThumbnails();
      this.buildOutline();
      this.comentarios.invalidarTodo();
      this.setActiveThumb(this.currentPage);
      this.updateIndicator();
    });
    // Tras un cambio de UNA sola página (`EditSession.refreshPage`, E-043/
    // E-044 — rotar, insertar texto/imagen, resaltar, formulario…): el
    // conjunto de páginas no cambió, así que basta con refrescar la
    // miniatura de esa página (nunca las 500) — `refreshThumbnail` no hace
    // nada si esa miniatura seguía sin pintar (placeholder fuera de vista).
    this.session.model.on('change', (pageIndex) => { this.refreshThumbnail(pageIndex); this.comentarios.invalidarPagina(pageIndex); });
    // Tras CUALQUIER recarga del modelo (deshacer/rehacer de un cambio de
    // fuente/tamaño/página, que recrean el documento desde una copia —
    // `EditSession.reload`—, lo reconstruyen en sitio —`refresh()`— o tocan
    // solo una página —`refreshPage()`—) el panel de propiedades puede
    // haber quedado desincronizado del documento real: `appliedFontLabel`
    // recordaba la última fuente elegida por el usuario para la selección
    // ANTERIOR al cambio, y `this.selection.runId` puede haber dejado de
    // existir (el objeto de texto se recreó con otro índice, o
    // desapareció). Sin esto, deshacer un cambio de fuente volvía el
    // DOCUMENTO a la fuente original pero el panel seguía mostrando la
    // fuente descartada — mentía sobre el estado real (bug de revisión de
    // PR #51). Único punto de enganche para AMBAS señales ('change' y
    // onReload): cubre execute Y undo/redo de todos los comandos que
    // reindexan runs, tanto los de una sola página (`refreshPage`, la
    // mayoría desde E-043/E-044) como los de todo el documento (`refresh`/
    // `reload`).
    this.session.model.onReload(() => this.reconcileSelectionAfterReload());
    this.session.model.onPageRebuilt(() => this.reconcileSelectionAfterReload());
    const sesion = this.session;
    this.panelMarcadores = new PanelMarcadores({
      contenedor: this.outlineEl,
      barra: this.outlineBarEl,
      obtenerArbol: () => sesion.engine.getOutline(sesion.doc),
      paginaActual: () => this.currentPage,
      ir: (pageIndex) => this.goToPage(pageIndex),
      aplicar: async (antes, despues, etiqueta) => { await this.bus?.execute(new SetOutlineCmd(antes, despues, etiqueta)); },
      estado: (m) => this.setStatus(m)
    });
    // Crear/renombrar/borrar/mover… y su deshacer/rehacer repintan el panel.
    this.session.model.onOutlineChange(() => this.buildOutline());
    this.buildThumbnails();
    this.buildOutline();
    this.comentarios.invalidarTodo();
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

  /**
   * Ejecuta la acción resuelta por `resolverAtajo` (§9 #34). `preventDefault`
   * se llama aquí, no en `atajos.ts` (que es puro, sin DOM) — cada rama
   * decide si de verdad hace falta (p. ej. "suprimir" solo si hay una imagen
   * seleccionada, igual que el comportamiento de antes de este PR: sin
   * imagen seleccionada, Backspace no debe robarle al navegador su acción
   * por defecto).
   */
  private ejecutarAtajo(accion: AccionAtajo, e: KeyboardEvent): void {
    switch (accion) {
      case 'deshacer':
        e.preventDefault();
        void this.bus?.undo();
        break;
      case 'rehacer':
        e.preventDefault();
        void this.bus?.redo();
        break;
      case 'guardar':
        e.preventDefault();
        void this.save();
        break;
      case 'abrir':
        e.preventDefault();
        this.fileInput.click();
        break;
      case 'imprimir':
        e.preventDefault();
        void this.print();
        break;
      case 'buscar':
        e.preventDefault();
        this.searchInput.focus();
        this.searchInput.select();
        break;
      case 'reemplazar':
        e.preventDefault();
        this.abrirReemplazo();
        break;
      case 'zoom-in':
        e.preventDefault();
        this.zoom(1.25);
        break;
      case 'zoom-out':
        e.preventDefault();
        this.zoom(1 / 1.25);
        break;
      case 'zoom-ajustar':
        e.preventDefault();
        this.fitWidth();
        break;
      case 'primera-pagina':
        e.preventDefault();
        this.goToPage(0);
        break;
      case 'ultima-pagina':
        e.preventDefault();
        this.goToPage((this.session?.model.pages.length ?? 0) - 1);
        break;
      case 'pagina-anterior':
        e.preventDefault();
        this.goToPage(this.currentPage - 1);
        break;
      case 'pagina-siguiente':
        e.preventDefault();
        this.goToPage(this.currentPage + 1);
        break;
      case 'suprimir':
        // Igual que antes de este PR: solo si hay una imagen seleccionada
        // (#20/#21) — si no, no hay nada que hacer aquí y el navegador
        // conserva su comportamiento por defecto.
        if (this.selectedImage) { e.preventDefault(); void this.deleteSelectedImage(); }
        break;
      case 'escape':
        // Sale de cualquier herramienta activa (§1). No interfiere con el
        // Escape que ya maneja TextLayer para cancelar una edición en curso:
        // ese no llega aquí con ninguna herramienta activa (edición y modo
        // herramienta no coinciden), y si `tool` ya es 'none' esto es un no-op.
        if (this.tool !== 'none') this.setTool('none');
        break;
      case 'ayuda':
        e.preventDefault();
        AtajosPanel.open();
        break;
      // Atajos de una letra (§6 del rediseño de interfaz, paridad con E-017
      // de la app vieja: V/T/P/R/E/N). Todos pasan por `setTool()` (único
      // punto de verdad, §1) — botón y cursor se sincronizan solos. Si la
      // herramienta vive en una pestaña distinta de la activa, el atajo
      // activa también esa pestaña (`activarPestana`), para que el botón
      // recién resaltado sea visible sin un clic adicional.
      case 'tool-none':
        e.preventDefault();
        this.setTool('none');
        break;
      case 'tool-insert':
        e.preventDefault();
        this.setTool(this.tool === 'insert' ? 'none' : 'insert');
        this.activarPestana('editar');
        break;
      case 'tool-pen':
        e.preventDefault();
        this.setTool(this.tool === 'pen' ? 'none' : 'pen');
        this.activarPestana('comentar');
        break;
      case 'tool-rect':
        e.preventDefault();
        this.setTool(this.tool === 'rect' ? 'none' : 'rect');
        this.activarPestana('comentar');
        break;
      case 'tool-eraser':
        e.preventDefault();
        this.setTool(this.tool === 'eraser' ? 'none' : 'eraser');
        this.activarPestana('comentar');
        break;
      case 'tool-note':
        e.preventDefault();
        this.setTool(this.tool === 'note' ? 'none' : 'note');
        this.activarPestana('comentar');
        break;
    }
  }

  /** `#btn-drawer` (§9 #35): abre/cierra el cajón móvil según su estado actual. */
  private toggleDrawer(): void {
    if (this.drawerOpen) this.closeDrawer(); else this.openDrawer();
  }

  private openDrawer(): void {
    this.drawerOpen = true;
    this.sidebarEl.classList.add('abierto');
    this.backdropEl.classList.add('visible');
    this.btnDrawer.setAttribute('aria-expanded', 'true');
    this.drawerReturnFocus = document.activeElement as HTMLElement | null;
    this.tabPages.focus();
  }

  /** Cierra el cajón y devuelve el foco a quien lo tenía antes de abrirlo (normalmente `#btn-drawer`). */
  private closeDrawer(): void {
    if (!this.drawerOpen) return;
    this.drawerOpen = false;
    this.sidebarEl.classList.remove('abierto');
    this.backdropEl.classList.remove('visible');
    this.btnDrawer.setAttribute('aria-expanded', 'false');
    (this.drawerReturnFocus ?? this.btnDrawer).focus();
    this.drawerReturnFocus = null;
  }

  /** `#btn-more` (§9 #35): revela/oculta `#toolbar-more` en móvil. */
  private toggleMore(): void {
    this.moreOpen = !this.moreOpen;
    this.toolbarMoreEl.classList.toggle('open', this.moreOpen);
    this.btnMore.setAttribute('aria-expanded', String(this.moreOpen));
  }

  private closeMore(): void {
    this.moreOpen = false;
    this.toolbarMoreEl.classList.remove('open');
    this.btnMore.setAttribute('aria-expanded', 'false');
  }

  /**
   * Foco "razonable" atrapado dentro del cajón (§9 #35): con Tab en el
   * último elemento focuseable vuelve al primero, y con Mayús+Tab en el
   * primero salta al último. No pretende cubrir cada borde posible (p. ej.
   * un elemento que se deshabilita mientras el cajón está abierto), solo
   * evitar que Tab saque el foco del cajón hacia la barra o el visor de
   * detrás mientras está abierto.
   */
  private trapFocoCajon(e: KeyboardEvent): void {
    if (e.key !== 'Tab' || !this.drawerOpen) return;
    const focusables = Array.from(this.sidebarEl.querySelectorAll<HTMLElement>('button, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !el.hasAttribute('disabled') && el.offsetParent !== null);
    if (focusables.length === 0) return;
    const primero = focusables[0]!;
    const ultimo = focusables[focusables.length - 1]!;
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
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

  /**
   * Resaltar/subrayar/tachar la línea seleccionada como anotación PDF REAL
   * (T11): un quad por línea visual, calculado con la geometría común (E-053).
   * Los resaltados antiguos (paths de contenido, de PDFs ya editados con
   * versiones previas) se quedan como están: son contenido de la página.
   */
  private marcarSeleccion(tipo: MarkupKind, color: [number, number, number], verbo: string, hecho: string): void {
    const run = this.selectedRun();
    if (!run || !this.bus || !this.selection || !this.session) { this.setStatus(`Selecciona una línea para ${verbo}.`); return; }
    const page = this.session.model.pages[this.selection.pageIndex]!;
    // Escala 1: px CSS == pt visuales; las cajas del run están en pt de usuario.
    const geo = PageGeometry.desdeTamanoVisual(page.sizePt.widthPt, page.sizePt.heightPt, 1, page.rotation);
    const quads = quadsPorLinea([{ boxPt: run.boxPt, sizePt: run.sizePt }], geo);
    // Autor: no hay nombre de usuario configurable todavía; /T queda vacío.
    void this.bus.execute(new AddMarkupCmd(this.selection.pageIndex, tipo, quads, color));
    this.setStatus(hecho);
  }

  private highlightSelected(): void { this.marcarSeleccion('highlight', this.toolColors.highlight, 'resaltarla', 'Resaltado.'); }
  private underlineSelected(): void { this.marcarSeleccion('underline', [0, 0, 0], 'subrayarla', 'Subrayado.'); }
  private strikeSelected(): void { this.marcarSeleccion('strikeout', [0, 0, 0], 'tacharla', 'Tachado.'); }

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

  /** `#btn-encabezado`: diálogo de encabezado/pie/numeración y marca de agua, con vista previa sobre la página actual. */
  private abrirEncabezado(): void {
    const s = this.session, bus = this.bus;
    if (!s || !bus) { this.setStatus('Abre un documento antes de añadir encabezados o marcas de agua.'); return; }
    const actual = this.currentPage;
    const total = s.engine.pageCount(s.doc);
    EncabezadoPanel.abrir({
      totalPaginas: total,
      paginaActual: actual,
      pagina: () => {
        const d = this.viewer?.paginaDom(actual);
        const sz = s.model.pages[actual]?.sizePt;
        return d && sz ? { el: d.el, escala: d.escala, anchoPt: sz.widthPt, altoPt: sz.heightPt } : null;
      },
      medir: (fuente, sizePt, texto) => s.engine.measureText(fuente, sizePt, texto),
      onAplicar: async (op, progreso) => {
        const cmd = new AnadirEncabezadoMarcaCmd(op, progreso);
        await bus.execute(cmd);
        this.setStatus('encabezado' in op ? 'Encabezado y pie añadidos.' : 'Marca de agua añadida.');
      },
      onQuitar: async (progreso) => {
        const cmd = new QuitarEncabezadosMarcasCmd(progreso);
        await bus.execute(cmd);
        this.setStatus(cmd.quitados === 0 ? 'No había encabezados ni marcas de agua añadidos por este editor.' : `Quitados ${cmd.quitados} objeto(s) añadidos por este editor.`);
        return cmd.quitados;
      }
    });
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
    // Cajón móvil (§9 #35): "elegir una página" es una de las formas
    // explícitas de cerrarlo. Único punto de entrada para navegar (E-032,
    // regla `navegacion-por-gotopage`), así que cubre miniatura, marcador,
    // prev/next y los atajos de teclado de una sola vez. No-op en
    // escritorio (el cajón nunca llega a abrirse ahí).
    this.closeDrawer();
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
  private showSidebarTab(which: 'pages' | 'outline' | 'comments'): void {
    this.thumbsEl.style.display = which === 'pages' ? 'block' : 'none';
    this.outlineEl.style.display = which === 'outline' ? 'block' : 'none';
    this.outlineBarEl.style.display = which === 'outline' ? 'flex' : 'none';
    this.commentsEl.style.display = which === 'comments' ? 'block' : 'none';
    this.tabPages.setAttribute('aria-selected', String(which === 'pages'));
    this.tabOutline.setAttribute('aria-selected', String(which === 'outline'));
    this.tabComments.setAttribute('aria-selected', String(which === 'comments'));
    // Lectura perezosa: el panel solo toca el motor mientras está a la vista.
    this.comentarios.setVisible(which === 'comments');
  }

  /** Repinta el panel de marcadores (al abrir otro documento, tras cualquier `onReload` —borrar/mover página cambia los índices— y tras cada cambio del outline). */
  private buildOutline(): void {
    this.panelMarcadores?.render();
  }

  /** Miniaturas: un canvas pequeño por página; clic desplaza el visor, arrastrar reordena (ver beginThumbDrag). */
  /** Ancho útil REAL de `#thumbs` (su `clientWidth` menos el padding CSS a los lados) — el ancho en que las miniaturas se MUESTRAN, ver `buildThumbnails`. */
  private anchoUtilThumbs(): number {
    const cs = getComputedStyle(this.thumbsEl);
    const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    return Math.max(1, this.thumbsEl.clientWidth - pad);
  }

  /**
   * Miniaturas perezosas (E-043, docs/ERRORES-CONOCIDOS.md): antes se
   * renderizaba (llamaba a `engine.renderPage`, la operación cara del
   * motor) TODAS las páginas de golpe al abrir el documento — en uno de 500
   * páginas eso es 500 renders síncronos antes de que el panel se pudiera
   * ni pintar. Ahora se crea un `<canvas>` PLACEHOLDER por página, del
   * tamaño y proporción EXACTOS que tendrá su bitmap (`canvas.width`/
   * `height` fijados desde `page.sizePt`, sin llamar al motor) — así el
   * scroll del panel mide lo mismo desde el primer instante, sin saltos — y
   * un `IntersectionObserver` (`observeThumbs`) pinta el bitmap real la
   * primera vez que la miniatura entra (o casi entra, `rootMargin`) en el
   * viewport de `#thumbs`. `renderThumb` hace el trabajo de verdad.
   */
  private buildThumbnails(): void {
    this.thumbsEl.textContent = '';
    this.thumbObserver?.disconnect();
    this.thumbRendered = new Set();
    this.thumbRenderOrder = [];
    const s = this.session;
    if (!s) return;
    // Renderiza al ancho en que se MUESTRAN (`anchoUtilThumbs()`, nunca a un
    // objetivo fijo en px) × `devicePixelRatio` — así una pantalla retina/
    // móvil no estira un bitmap de baja resolución con CSS (`width: 100%`
    // en `.thumb`, ver estilos.css) y se ve borrosa. Tope en `dpr` (3×) y en
    // el ancho final de render (900px): un `devicePixelRatio` de 3-4 sobre
    // un cajón de hasta 320px ya cubriría de sobra sin el tope; sin él, un
    // documento con muchas páginas en un dispositivo de dpr alto tardaría
    // más de lo razonable en pintar cada miniatura que sí llega a verse.
    const anchoCss = this.anchoUtilThumbs();
    this.thumbsRenderedWidthCss = anchoCss;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const anchoRenderPx = Math.min(anchoCss * dpr, 900);
    this.thumbsAnchoRenderPx = anchoRenderPx;
    for (const page of s.model.pages) {
      const scale = anchoRenderPx / page.sizePt.widthPt;
      const width = Math.max(1, Math.round(page.sizePt.widthPt * scale));
      const height = Math.max(1, Math.round(page.sizePt.heightPt * scale));
      const canvas = document.createElement('canvas');
      // Tamaño intrínseco correcto DESDE YA (proporción real de la página):
      // el panel mide bien su scroll sin haber pintado un solo píxel.
      canvas.width = width; canvas.height = height;
      canvas.dataset.page = String(page.index);
      canvas.dataset.scale = String(scale);
      canvas.className = 'thumb';
      Object.assign(canvas.style, { display: 'block', width: '100%', height: 'auto', marginBottom: '8px', cursor: 'pointer', background: '#fff', boxSizing: 'border-box' });

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
      // Alcanzable por teclado (Tab): necesario para que el atrapado de foco
      // del cajón móvil (§9 #35, `trapFocoCajon`) tenga más de dos paradas
      // dentro del cajón, y para poder navegar sin ratón/tacto.
      canvas.tabIndex = 0;
      canvas.setAttribute('role', 'button');
      canvas.setAttribute('aria-label', `Ir a la página ${page.index + 1}`);
      canvas.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.goToPage(page.index); }
      });
      this.thumbsEl.appendChild(canvas);
    }
    // `this.currentPage`, no un 0 fijo: reconstruir (p. ej. el
    // `ResizeObserver` de arriba, al cambiar el ancho del panel) no debe
    // saltar la miniatura activa de vuelta a la primera página.
    this.setActiveThumb(this.currentPage);
    this.observeThumbs();
  }

  /** Observa cada placeholder de `#thumbs`: en cuanto entra (o casi, `rootMargin` es un margen POR DELANTE en px del propio panel) en el viewport del panel, pinta su bitmap real. */
  private observeThumbs(): void {
    this.thumbObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        const i = Number(canvas.dataset.page);
        if (Number.isFinite(i)) this.renderThumb(canvas, i);
      }
    }, { root: this.thumbsEl, rootMargin: '600px 0px' });
    for (const el of Array.from(this.thumbsEl.children)) this.thumbObserver.observe(el);
  }

  /** Pinta el bitmap real de una miniatura (si no lo tenía ya) y desaloja las más antiguas si hay demasiadas pintadas a la vez. */
  private renderThumb(canvas: HTMLCanvasElement, i: number): void {
    if (this.thumbRendered.has(i)) return;
    const s = this.session;
    if (!s) return;
    const scale = Number(canvas.dataset.scale);
    contarRenderPage();
    const { width, height, data } = s.engine.renderPage(s.doc, i, scale);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const img = new ImageData(width, height);
    img.data.set(data);
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    this.thumbRendered.add(i);
    this.thumbRenderOrder.push(i);
    // Ya no hace falta seguir observando esta miniatura salvo que se
    // descarte por memoria (`maybeEvictFarThumbs` la vuelve a observar en
    // ese caso).
    this.thumbObserver?.unobserve(canvas);
    this.maybeEvictFarThumbs(i);
  }

  /**
   * Descarta (vuelve a placeholder) el bitmap de las miniaturas pintadas
   * MÁS ANTIGUAS cuando hay más de `MAX_MINIATURAS_PINTADAS` a la vez, salvo
   * las que sigan cerca de la que se acaba de pintar — así un documento de
   * 500 páginas no acumula 500 bitmaps en memoria si el usuario se ha
   * paseado por todo el panel. Las descartadas vuelven a observarse: si el
   * usuario regresa a esa zona, se repintan solas.
   */
  private maybeEvictFarThumbs(justRendered: number): void {
    const MAX_MINIATURAS_PINTADAS = 120;
    const MARGEN_CERCANIA = 30;
    if (this.thumbRenderOrder.length <= MAX_MINIATURAS_PINTADAS) return;
    while (this.thumbRenderOrder.length > MAX_MINIATURAS_PINTADAS) {
      const victima = this.thumbRenderOrder[0]!;
      if (Math.abs(victima - justRendered) < MARGEN_CERCANIA) break; // no descartes lo que sigue cerca: para aquí
      this.thumbRenderOrder.shift();
      if (!this.thumbRendered.has(victima)) continue;
      const canvas = this.thumbsEl.querySelector<HTMLCanvasElement>(`canvas.thumb[data-page="${victima}"]`);
      if (!canvas) continue;
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      this.thumbRendered.delete(victima);
      this.thumbObserver?.observe(canvas);
    }
  }

  /**
   * Refresca UNA miniatura tras un cambio de esa página (`refreshPage`,
   * E-043/E-044): recalcula su tamaño (la rotación puede cambiar la
   * proporción) con el MISMO ancho de render que el resto del panel
   * (`thumbsAnchoRenderPx`) y, si ya tenía bitmap pintado, la repinta de
   * inmediato — si todavía era un placeholder sin pintar, se deja así (el
   * observer la pintará si/cuando entre en el viewport, nunca antes).
   */
  private refreshThumbnail(pageIndex: number): void {
    const s = this.session;
    if (!s) return;
    const canvas = this.thumbsEl.querySelector<HTMLCanvasElement>(`canvas.thumb[data-page="${pageIndex}"]`);
    const page = s.model.pages[pageIndex];
    if (!canvas || !page || this.thumbsAnchoRenderPx <= 0) return;
    const scale = this.thumbsAnchoRenderPx / page.sizePt.widthPt;
    canvas.width = Math.max(1, Math.round(page.sizePt.widthPt * scale));
    canvas.height = Math.max(1, Math.round(page.sizePt.heightPt * scale));
    canvas.dataset.scale = String(scale);
    const pintadaAntes = this.thumbRendered.has(pageIndex);
    this.thumbRendered.delete(pageIndex);
    this.thumbRenderOrder = this.thumbRenderOrder.filter((i) => i !== pageIndex);
    if (pintadaAntes) this.renderThumb(canvas, pageIndex);
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

  /**
   * Busca `q` en TODAS las páginas. Operación de documento completo
   * (E-043, docs/ERRORES-CONOCIDOS.md): en un documento grande, recorrer
   * cientos de páginas de una sentada bloquearía el hilo principal, así que
   * cede el hilo cada `PAGE_YIELD_CHUNK` páginas (`cederHilo`) y muestra el
   * avance en `#status`. `searchSeq` es la "cancelación" de esta operación:
   * si el usuario teclea de nuevo antes de que termine, la búsqueda vieja se
   * abandona sin pintar sus resultados (ni seguir gastando ciclos en
   * `#status`) — no hay forma de abortar `findText` a media página, pero
   * dejar de continuar el bucle y de aplicar el resultado es equivalente
   * desde fuera.
   */
  private async search(): Promise<void> {
    if (!this.session || !this.viewer) return;
    const token = ++this.searchSeq;
    const q = this.searchInput.value.trim();
    const byPage = new Map<number, RectPt[]>();
    let total = 0;
    if (q) {
      const pages = this.session.model.pages;
      for (let i = 0; i < pages.length; i++) {
        if (this.searchSeq !== token) return; // una búsqueda más reciente ya la reemplazó
        const page = pages[i]!;
        const rects = this.session.engine.findText(this.session.doc, page.index, q, this.opcionesBusqueda());
        if (rects.length) { byPage.set(page.index, rects); total += rects.length; }
        if ((i + 1) % PAGE_YIELD_CHUNK === 0 || i === pages.length - 1) {
          if (pages.length > PAGE_YIELD_CHUNK) this.setStatus(`Buscando… ${i + 1}/${pages.length}`);
          await cederHilo();
        }
      }
    }
    if (this.searchSeq !== token) return;
    this.viewer.setHighlights(byPage);
    this.setStatus(q ? `${total} coincidencia(s)` : '');
  }

  // ───────────────────────── Buscar y reemplazar ─────────────────────────

  private construirBarraReemplazo(): void {
    this.btnReplaceToggle = document.createElement('button');
    this.btnReplaceToggle.type = 'button';
    this.btnReplaceToggle.id = 'btn-replace-toggle';
    this.btnReplaceToggle.className = 'icon-btn';
    this.btnReplaceToggle.textContent = 'Reemplazar…';
    this.btnReplaceToggle.title = 'Buscar y reemplazar (Ctrl/Cmd+H)';
    this.btnReplaceToggle.setAttribute('aria-expanded', 'false');
    this.btnReplaceToggle.setAttribute('aria-controls', 'replace-bar');
    this.btnReplaceToggle.addEventListener('click', () => {
      if (this.replaceBar.hidden) this.abrirReemplazo(); else this.cerrarReemplazo();
    });

    const bar = document.createElement('div');
    bar.id = 'replace-bar';
    bar.className = 'replace-bar';
    bar.hidden = true;
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Buscar y reemplazar');
    this.replaceBar = bar;

    this.replaceInput = document.createElement('input');
    this.replaceInput.type = 'text';
    this.replaceInput.id = 'replace-input';
    this.replaceInput.placeholder = 'Reemplazar con…';
    this.replaceInput.setAttribute('aria-label', 'Reemplazar con');
    this.replaceInput.autocomplete = 'off';
    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); void this.reemplazarActual(); }
    });

    const casilla = (id: string, etiqueta: string): [HTMLLabelElement, HTMLInputElement] => {
      const l = document.createElement('label');
      l.className = 'replace-opt';
      const i = document.createElement('input');
      i.type = 'checkbox'; i.id = id;
      i.addEventListener('change', () => { this.cursorReemplazo = null; void this.search(); });
      l.append(i, document.createTextNode(etiqueta));
      return [l, i];
    };
    const [lblCase, optCase] = casilla('opt-case', 'Distinguir mayúsculas');
    const [lblWord, optWord] = casilla('opt-word', 'Palabra completa');
    this.optCase = optCase; this.optWord = optWord;

    this.btnReplace = document.createElement('button');
    this.btnReplace.type = 'button'; this.btnReplace.id = 'btn-replace'; this.btnReplace.className = 'replace-btn';
    this.btnReplace.textContent = 'Reemplazar';
    this.btnReplace.addEventListener('click', () => void this.reemplazarActual());
    this.btnReplaceAll = document.createElement('button');
    this.btnReplaceAll.type = 'button'; this.btnReplaceAll.id = 'btn-replace-all'; this.btnReplaceAll.className = 'replace-btn';
    this.btnReplaceAll.textContent = 'Reemplazar todo';
    this.btnReplaceAll.addEventListener('click', () => void this.reemplazarTodo());

    const cerrar = document.createElement('button');
    cerrar.type = 'button'; cerrar.id = 'btn-replace-close'; cerrar.className = 'replace-btn';
    cerrar.textContent = '×';
    cerrar.title = 'Cerrar buscar y reemplazar';
    cerrar.setAttribute('aria-label', 'Cerrar buscar y reemplazar');
    cerrar.addEventListener('click', () => this.cerrarReemplazo());

    this.replaceResult = document.createElement('span');
    this.replaceResult.id = 'replace-result';
    this.replaceResult.className = 'replace-result';
    this.replaceResult.setAttribute('role', 'status');
    this.replaceResult.setAttribute('aria-live', 'polite');

    bar.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); this.cerrarReemplazo(); } });
    bar.append(this.replaceInput, lblCase, lblWord, this.btnReplace, this.btnReplaceAll, this.replaceResult, cerrar);
  }

  /** Ctrl/Cmd+H o el botón: muestra la barra y deja el foco donde falta algo (consulta vacía -> buscar; si no -> reemplazo). */
  private abrirReemplazo(): void {
    this.replaceBar.hidden = false;
    this.btnReplaceToggle.setAttribute('aria-expanded', 'true');
    if (!this.searchInput.value.trim()) { this.searchInput.focus(); this.searchInput.select(); }
    else { this.replaceInput.focus(); this.replaceInput.select(); }
  }

  private cerrarReemplazo(): void {
    this.replaceBar.hidden = true;
    this.btnReplaceToggle.setAttribute('aria-expanded', 'false');
    this.btnReplaceToggle.focus();
  }

  private opcionesBusqueda(): OpcionesBusqueda {
    return { mayusculas: this.optCase.checked, palabraCompleta: this.optWord.checked };
  }

  private anunciarReemplazo(msg: string): void {
    this.replaceResult.textContent = msg;
    this.setStatus(msg);
  }

  private ocupadoReemplazo(ocupado: boolean): void {
    this.reemplazando = ocupado;
    this.btnReplace.disabled = ocupado;
    this.btnReplaceAll.disabled = ocupado;
  }

  /**
   * Recorre TODAS las páginas buscando `q` en el texto de sus runs (operación
   * de documento completo: cede el hilo cada `PAGE_YIELD_CHUNK` páginas y
   * muestra el avance — E-043). Devuelve los runs con coincidencias propias
   * (reemplazables) y cuántas coincidencias cruzan runs (no reemplazables).
   */
  private async escanearReemplazo(q: string): Promise<EscaneoReemplazo | null> {
    const s = this.session;
    if (!s) return null;
    const opts = this.opcionesBusqueda();
    const out: EscaneoReemplazo['runs'] = [];
    let cruzan = 0;
    const total = s.model.pages.length;
    for (let i = 0; i < total; i++) {
      if (this.session !== s) return null; // se abrió otro documento mientras tanto
      const runs = s.ensureText(i);
      const r = buscarEnRuns(runs, q, opts);
      cruzan += r.cruzan;
      const porRun = new Map<number, Coincidencia[]>();
      for (const c of r.dentro) {
        let l = porRun.get(c.runId);
        if (!l) { l = []; porRun.set(c.runId, l); }
        l.push(c);
      }
      for (const run of runs) {
        const l = porRun.get(run.runId);
        if (l) out.push({ pageIndex: i, runId: run.runId, texto: run.text, coincidencias: l });
      }
      if ((i + 1) % PAGE_YIELD_CHUNK === 0 || i === total - 1) {
        if (total > PAGE_YIELD_CHUNK) this.setStatus(`Buscando… ${i + 1}/${total}`);
        await cederHilo();
      }
    }
    return { runs: out, cruzan };
  }

  private textoAvisoCruces(n: number): string {
    return n === 1
      ? '1 coincidencia no reemplazada porque abarca varias líneas o tramos'
      : `${n} coincidencias no reemplazadas porque abarcan varias líneas o tramos`;
  }

  /** Avisos del comando (fuente estándar / runs que ningún tipo de letra cubre) y de coincidencias entre runs. */
  private avisosReemplazo(cmd: ReemplazarTextoCmd, cruzan: number): string {
    const r = cmd.resumen;
    const partes: string[] = [];
    if (r.sustituidos > 0) partes.push(`${r.sustituidos} con fuente estándar (${r.fuentes.join(', ')}) porque la original no tenía algún carácter`);
    if (r.fallidos > 0) partes.push(`${r.fallidos} sin cambiar porque ninguna fuente tiene esos caracteres`);
    if (cruzan > 0) partes.push(this.textoAvisoCruces(cruzan));
    return partes.join('; ');
  }

  /** "Reemplazar": cambia la PRÓXIMA coincidencia (desde la página actual o desde la última reemplazada) y avisa de las que no puede tocar. */
  private async reemplazarActual(): Promise<void> {
    const s = this.session;
    if (!s || !this.bus || this.reemplazando) return;
    const q = this.searchInput.value.trim();
    if (!q) { this.anunciarReemplazo('Escribe primero qué buscar.'); this.searchInput.focus(); return; }
    this.ocupadoReemplazo(true);
    try {
      const esc = await this.escanearReemplazo(q);
      if (!esc) return;
      const cur = this.cursorReemplazo ?? { pageIndex: this.currentPage, runId: -1, pos: 0 };
      interface Hit { pageIndex: number; runId: number; texto: string; c: Coincidencia }
      const hits: Hit[] = [];
      for (const r of esc.runs) for (const c of r.coincidencias) hits.push({ pageIndex: r.pageIndex, runId: r.runId, texto: r.texto, c });
      const despues = (h: Hit): boolean =>
        h.pageIndex > cur.pageIndex ||
        (h.pageIndex === cur.pageIndex && (h.runId > cur.runId || (h.runId === cur.runId && h.c.inicio >= cur.pos)));
      const hit = hits.find(despues) ?? hits[0];
      if (!hit) {
        this.anunciarReemplazo(esc.cruzan > 0 ? `0 reemplazos; ${this.textoAvisoCruces(esc.cruzan)}.` : 'No hay coincidencias.');
        return;
      }
      const reemplazo = this.replaceInput.value;
      const cambio: CambioTexto = {
        pageIndex: hit.pageIndex, runId: hit.runId, oldText: hit.texto,
        newText: aplicarReemplazos(hit.texto, [hit.c], reemplazo)
      };
      const cmd = new ReemplazarTextoCmd([cambio], 'Reemplazar');
      await this.bus.execute(cmd);
      this.cursorReemplazo = cmd.resumen.sustituidos > 0
        ? { pageIndex: hit.pageIndex, runId: -1, pos: 0 } // el run se recreó con otro runId
        : { pageIndex: hit.pageIndex, runId: hit.runId, pos: hit.c.inicio + reemplazo.length };
      this.goToPage(hit.pageIndex);
      await this.search();
      await this.marcarActual(q);
      const avisos = this.avisosReemplazo(cmd, esc.cruzan);
      this.anunciarReemplazo(cmd.resumen.fallidos > 0
        ? `0 reemplazos; ${avisos}.`
        : `1 reemplazo (quedan ${hits.length - 1})${avisos ? '; ' + avisos : ''}.`);
    } finally {
      this.ocupadoReemplazo(false);
    }
  }

  /**
   * Selecciona y resalta (naranja) la coincidencia ACTUAL: la siguiente a
   * `cursorReemplazo`, la misma que cambiará el próximo "Reemplazar". Lleva
   * la vista a su página. Su caja sale de `findText` (mismo criterio y mismas
   * opciones que el resaltado): la k-ésima caja, de izquierda a derecha, dentro
   * de la caja del run, siendo k el orden de la coincidencia dentro de su run.
   */
  private async marcarActual(q: string): Promise<void> {
    const s = this.session;
    if (!s || !this.viewer) return;
    const esc = await this.escanearReemplazo(q);
    if (!esc || this.session !== s) return;
    const cur = this.cursorReemplazo ?? { pageIndex: this.currentPage, runId: -1, pos: 0 };
    interface Cand { pageIndex: number; runId: number; k: number; inicio: number }
    const cands: Cand[] = [];
    for (const r of esc.runs) r.coincidencias.forEach((c, k) => cands.push({ pageIndex: r.pageIndex, runId: r.runId, k, inicio: c.inicio }));
    const h = cands.find((c) => c.pageIndex > cur.pageIndex ||
      (c.pageIndex === cur.pageIndex && (c.runId > cur.runId || (c.runId === cur.runId && c.inicio >= cur.pos)))) ?? cands[0];
    if (!h) { this.viewer.setCurrentMatch(null); return; }
    const run = s.ensureText(h.pageIndex).find((x) => x.runId === h.runId);
    if (!run) return;
    const b = run.boxPt;
    const cajas = s.engine.findText(s.doc, h.pageIndex, q, this.opcionesBusqueda())
      .filter((r) => {
        const cx = r.xPt + r.wPt / 2, cy = r.yPt + r.hPt / 2;
        return cx >= b.xPt && cx <= b.xPt + b.wPt && cy >= b.yPt && cy <= b.yPt + b.hPt;
      })
      .sort((p1, p2) => p1.xPt - p2.xPt);
    this.goToPage(h.pageIndex);
    this.selection = { pageIndex: h.pageIndex, runId: h.runId };
    this.reflectPropsPanel();
    this.viewer.setCurrentMatch({ pageIndex: h.pageIndex, rect: cajas[h.k] ?? b });
  }

  /** "Reemplazar todo": UN comando compuesto (un solo paso de deshacer) sobre todo el documento. */
  private async reemplazarTodo(): Promise<void> {
    const s = this.session;
    if (!s || !this.bus || this.reemplazando) return;
    const q = this.searchInput.value.trim();
    if (!q) { this.anunciarReemplazo('Escribe primero qué buscar.'); this.searchInput.focus(); return; }
    this.ocupadoReemplazo(true);
    try {
      const esc = await this.escanearReemplazo(q);
      if (!esc) return;
      const reemplazo = this.replaceInput.value;
      const cambios: CambioTexto[] = [];
      const coincidenciasPorRun = new Map<string, number>();
      let n = 0;
      for (const r of esc.runs) {
        n += r.coincidencias.length;
        coincidenciasPorRun.set(`${r.pageIndex}:${r.runId}`, r.coincidencias.length);
        cambios.push({ pageIndex: r.pageIndex, runId: r.runId, oldText: r.texto, newText: aplicarReemplazos(r.texto, r.coincidencias, reemplazo) });
      }
      if (cambios.length === 0) {
        this.anunciarReemplazo(esc.cruzan > 0 ? `0 reemplazos; ${this.textoAvisoCruces(esc.cruzan)}.` : 'No hay coincidencias.');
        return;
      }
      const cmd = new ReemplazarTextoCmd(cambios, 'Reemplazar todo', {
        onProgress: (hechas, t) => { if (t > PAGE_YIELD_CHUNK) this.setStatus(`Reemplazando… ${hechas}/${t}`); },
        ceder: cederHilo,
        paginasPorTanda: PAGE_YIELD_CHUNK
      });
      await this.bus.execute(cmd);
      this.cursorReemplazo = null;
      // Los runs que no se pudieron escribir quedaron intactos: no cuentan como reemplazos.
      for (const f of cmd.fallidosCambios) n -= coincidenciasPorRun.get(`${f.pageIndex}:${f.runId}`) ?? 0;
      await this.search();
      const avisos = this.avisosReemplazo(cmd, esc.cruzan);
      this.anunciarReemplazo(`${n} reemplazo${n === 1 ? '' : 's'}${avisos ? '; ' + avisos : ''}.`);
    } finally {
      this.ocupadoReemplazo(false);
    }
  }

  private zoom(factor: number): void {
    this.scale = Math.min(4, Math.max(0.25, Math.round(this.scale * factor * 100) / 100));
    this.viewer?.setScale(this.scale);
    this.zoomPctEl.textContent = `${Math.round(this.scale * 100)}%`;
    this.setStatus(`Zoom ${Math.round(this.scale * 100)}%`);
  }

  /**
   * `#btn-fit-width`: calcula la escala para que la página ACTUAL ocupe el
   * ancho útil del visor (su `clientWidth` —ya sin la barra de scroll
   * vertical, que `clientWidth` excluye por definición, a diferencia de
   * `offsetWidth`— menos el padding CSS a los lados) y la aplica. También se
   * llama al abrir un documento (ver `openBytes`).
   *
   * Unidades: `page.sizePt.widthPt` es la anchura de la página en PUNTOS PDF;
   * `disponible` es px CSS del visor. La escala que iguala ambos en px CSS es
   * `disponible / widthPt` (mismo significado que `PageGeometry.scale`, que
   * multiplica puntos PDF por esta escala para obtener px CSS).
   *
   * Revisión de PR #63: `Math.round` a la centésima más cercana puede
   * redondear la escala HACIA ARRIBA, dejando la página hasta ~0,3 pt más
   * ancha que `disponible` — en pantalla, unos px de más que bastan para que
   * el visor (`overflow: auto`) abra una barra de scroll HORIZONTAL. Con esa
   * barra presente, los márgenes automáticos de `.page` (`margin: 0 auto` en
   * `Viewer.layout`) dejan de repartirse simétricos: la página queda pegada
   * al borde derecho y el hueco gris solo se ve a la izquierda — exactamente
   * el defecto reportado en la revisión, visible en las capturas 03/04.
   * `Math.floor` (a la milésima, para no perder precisión de más) garantiza
   * `cssWidth <= disponible` siempre, a costa de una holgura de como mucho
   * ~0,1 % del ancho de página (bien por debajo de 1 px) — imperceptible, y
   * el `%` mostrado (`zoomPctEl`) sigue redondeando al entero más cercano.
   */
  private fitWidth(): void {
    const s = this.session;
    const page = s?.model.pages[this.currentPage];
    if (!s || !this.viewer || !page) return;
    const cs = getComputedStyle(this.viewerEl);
    const paddingX = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
    const disponible = this.viewerEl.clientWidth - paddingX;
    if (disponible <= 0) return;
    this.scale = calcularEscalaAjusteAncho(disponible, page.sizePt.widthPt);
    this.viewer.setScale(this.scale);
    this.zoomPctEl.textContent = `${Math.round(this.scale * 100)}%`;
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
   * Desde el endurecimiento de CSP del 2026-09-29 (autorización del dueño,
   * AGENTS.md §5, docs/ERRORES-CONOCIDOS.md E-046), `vercel.json`/`server.js`
   * declaran `frame-src 'self' blob:`, así que este camino funciona
   * directamente en producción. Se conservan igualmente DOS redes de
   * seguridad, por si acaso (otro entorno con una CSP más estricta, un
   * navegador que interprete `frame-src` de forma distinta, etc.): el oyente
   * de `securitypolicyviolation` (el bloqueo no lanza excepción, así que sin
   * esto el usuario vería un iframe vacío y ningún diálogo) y el `catch` de
   * la llamada a `print()`. Ambas caen a abrir el PDF en una pestaña nueva,
   * desde donde el usuario imprime con el propio visor del navegador
   * (Ctrl/Cmd+P). Cubierto bajo la CSP real por
   * `tests/e2e/deploy/csp.spec.ts`.
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
  private async print(): Promise<void> {
    const s = this.session;
    if (!s) { this.setStatus('Abre un documento antes de imprimir.'); return; }

    this.limpiarImpresionAnterior?.();
    this.limpiarImpresionAnterior = null;

    // saveCompact (E-038, docs/ERRORES-CONOCIDOS.md): guardado de cara al
    // usuario, no un snapshot interno de deshacer — descarta los streams de
    // contenido huérfanos que fue dejando cada edición.
    const bytes = await s.engine.saveCompact(s.doc);
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

  private async save(): Promise<void> {
    const s = this.session;
    if (!s) return;
    // saveCompact (E-038): guardado de cara al usuario, descarta huérfanos.
    const bytes = await s.engine.saveCompact(s.doc);
    this.download(bytes, this.docName.replace(/\.pdf$/i, '') + '_editado.pdf');
    this.setStatus('Guardado.');
  }

  private splitByRange(): void {
    const s = this.session;
    if (!s) return;
    const idx = parseRange(this.rangeInput.value, s.model.pages.length);
    if (idx.length === 0) { this.setStatus('Rango no válido (ej.: 1-3,5).'); return; }
    // extractPages ya construye un documento NUEVO importando solo las
    // páginas pedidas: al analizarlas solo trae los objetos alcanzables
    // desde ellas, así que no arrastra los streams huérfanos del documento
    // origen (E-038) — no hace falta saveCompact aquí (verificado con un
    // test del motor).
    this.download(s.engine.extractPages(s.doc, idx), `${this.docName.replace(/\.pdf$/i, '')}_seleccion.pdf`);
    this.setStatus(`${idx.length} página(s) extraídas.`);
  }

  private extractCurrent(): void {
    const s = this.session;
    if (!s) return;
    // Igual que splitByRange: extractPages ya es inmune a E-038 por construcción.
    const bytes = s.engine.extractPages(s.doc, [this.currentPage]);
    this.download(bytes, `${this.docName.replace(/\.pdf$/i, '')}_pagina_${this.currentPage + 1}.pdf`);
    this.setStatus(`Página ${this.currentPage + 1} extraída.`);
  }

  private download(data: BlobPart, filename: string, mimeType = 'application/pdf'): void {
    descargarArchivo(data, filename, mimeType);
  }

  /**
   * Runs de texto de TODAS las páginas, agrupados en líneas de lectura
   * (`estructura.ts`), en orden de página. Operación de documento completo
   * (E-043, docs/ERRORES-CONOCIDOS.md): en un documento de cientos de
   * páginas, extraer el texto de todas de golpe bloquearía el hilo
   * principal, así que cede el hilo cada `PAGE_YIELD_CHUNK` páginas
   * (`cederHilo`) e informa el avance en `#status`. Usa `session.ensureText`
   * (nunca `engine.getPageText` directo, regla `texto-perezoso-via-
   * editsession`): las páginas ya vistas en el visor no se vuelven a leer
   * del motor.
   */
  private async allPagesLineas(onProgreso?: (hechas: number, total: number) => void): Promise<Linea[][]> {
    const s = this.session;
    if (!s) return [];
    const pages = s.model.pages;
    const out: Linea[][] = [];
    for (let i = 0; i < pages.length; i++) {
      out.push(agruparLineas(s.ensureText(pages[i]!.index)));
      if ((i + 1) % PAGE_YIELD_CHUNK === 0 || i === pages.length - 1) {
        onProgreso?.(i + 1, pages.length);
        await cederHilo();
      }
    }
    return out;
  }

  /** `#btn-extract-text`: abre el diálogo de texto plano de todo el documento (#27 de la tabla de paridad, §9). */
  private async openTextPanel(): Promise<void> {
    if (!this.session) { this.setStatus('Abre un documento antes de extraer texto.'); return; }
    const total = this.session.model.pages.length;
    this.setStatus(total > PAGE_YIELD_CHUNK ? `Extrayendo texto… 0/${total}` : 'Extrayendo texto…');
    const lineas = await this.allPagesLineas((hechas, t) => this.setStatus(`Extrayendo texto… ${hechas}/${t}`));
    const texto = aTextoPlano(lineas);
    TextPanel.open(texto, this.docName.replace(/\.pdf$/i, ''));
    this.setStatus(`Texto extraído (${lineas.length} página(s)).`);
  }

  /** `#btn-export-md`: descarga el Markdown estructurado de todo el documento (#31 de la tabla de paridad, §9). */
  private async exportMarkdown(): Promise<void> {
    if (!this.session) { this.setStatus('Abre un documento antes de exportar Markdown.'); return; }
    const total = this.session.model.pages.length;
    this.setStatus(total > PAGE_YIELD_CHUNK ? `Generando Markdown… 0/${total}` : 'Generando Markdown…');
    const lineas = await this.allPagesLineas((hechas, t) => this.setStatus(`Generando Markdown… ${hechas}/${t}`));
    const md = aMarkdown(lineas);
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
