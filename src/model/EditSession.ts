import { PdfError } from '../engine/errores';
import type { PdfEngine, DocHandle, TextRun, CharBox, RectPt } from '../engine/PdfEngine';
import { DocumentModel } from './DocumentModel';
import type { PageModel } from './types';
import { contarGetPageText } from '../diagnostico';
import { tamanoPaginaValido, TAMANO_PAGINA_SUSTITUTO } from '../engine/limiteBitmap';
import { ordenLecturaCaracteres } from '../texto/seleccionTexto';
import { cajaVisible } from '../texto/visibilidad';

/**
 * Sesión de edición: une motor + documento abierto + modelo, y sabe
 * reconstruir el modelo desde el documento (refresh) o recargar el documento
 * desde unos bytes (reload) — la base del deshacer por snapshot para las
 * operaciones que cambian el conjunto de objetos (borrar/insertar).
 *
 * Cumple el contrato Ctx que consumen los comandos.
 *
 * Texto perezoso (E-043, docs/ERRORES-CONOCIDOS.md): `getPageText()` es la
 * llamada más cara por página del motor (recorre cada objeto de texto de la
 * página y lee varias cadenas de PDFium por cada uno, E-028). Pedirla para
 * las 500 páginas de un documento grande al simplemente ABRIRLO —o al
 * refrescar el modelo entero tras UN comando de una sola página, como hacía
 * antes `refresh()`— es trabajo que casi nunca hace falta: el usuario solo
 * puede EDITAR o BUSCAR en las páginas que ha visto. `buildPages()` deja
 * `runs: []` sin cargar; `ensureText(pageIndex)` la carga (y cachea) la
 * primera vez que de verdad hace falta, y `invalidateText`/`refreshPage`
 * limpian el caché de UNA página sin tocar las demás.
 */
export class EditSession {
  /** Páginas cuyo texto YA se cargó del motor (cacheado en `model.pages[i].runs`). */
  private loadedText = new Set<number>();
  /** Caracteres con caja por página (T12), perezosos y cacheados igual que el texto. */
  private chars = new Map<number, CharBox[]>();

  private constructor(
    readonly engine: PdfEngine,
    public doc: DocHandle,
    readonly model: DocumentModel
  ) {}

  /**
   * Metadatos ligeros de cada página (tamaño, rotación) SIN el texto —
   * `runs` queda vacío hasta que `ensureText()` lo pida. `sizePt`/`rotation`
   * siguen siendo eager: son un único getter barato por página (una carga y
   * cierre de página en el motor, sin recorrer objetos), y el resto del
   * visor (maquetación de las N páginas, altura del scroll) los necesita
   * desde el primer render, no perezosos.
   */
  static buildPages(engine: PdfEngine, doc: DocHandle): PageModel[] {
    const pages: PageModel[] = [];
    const count = engine.pageCount(doc);
    for (let i = 0; i < count; i++) {
      pages.push({
        index: i,
        ...EditSession.tamanoPagina(engine, doc, i),
        origenPt: engine.pageBox(doc, i).origenPt,
        rotation: engine.pageRotation(doc, i),
        runs: []
      });
    }
    return pages;
  }

  /**
   * `sizePt` + `userUnit` (+ `tamanoInvalido`) de una página. Un tamaño absurdo (E-129: NaN, ≤ 0, > 14400 pt × UserUnit)
   * no se propaga a la maquetación ni al render: se sustituye por un A4 para poder pintar el marcador de error y que el
   * resto del documento siga funcionando.
   */
  private static tamanoPagina(engine: PdfEngine, doc: DocHandle, i: number): Pick<PageModel, 'sizePt' | 'userUnit' | 'tamanoInvalido'> {
    const sizePt = engine.pageSize(doc, i);
    const userUnit = engine.userUnit(doc, i);
    if (tamanoPaginaValido(sizePt.widthPt, sizePt.heightPt, userUnit)) return { sizePt, userUnit };
    return { sizePt: { ...TAMANO_PAGINA_SUSTITUTO }, userUnit: 1, tamanoInvalido: true };
  }

  static async open(engine: PdfEngine, bytes: Uint8Array, password?: string): Promise<EditSession> {
    const doc = await engine.open(bytes, password);
    try {
      const pages = EditSession.buildPages(engine, doc);
      // Un PDF sin páginas (árbol cíclico o vacío) no se puede mostrar: error tipado, no pantalla en blanco.
      if (pages.length === 0) throw new PdfError('PAGE', 'El PDF no tiene páginas que mostrar');
      return new EditSession(engine, doc, new DocumentModel(pages));
    } catch (err) {
      engine.close(doc); // §2.6: si la carga de la sesión falla, el documento recién abierto no se filtra
      if (err instanceof PdfError) throw err;
      throw new PdfError('PAGE', 'No se pudo cargar una página del PDF');
    }
  }

  /**
   * Devuelve los runs de texto de una página, cargándolos del motor la
   * primera vez (o tras una invalidación) y sirviendo el caché el resto. Es
   * el ÚNICO sitio del árbol de `src/` que debe llamar a `engine.getPageText`
   * fuera del propio motor (regla `texto-perezoso-via-editsession`) — todo
   * consumidor (TextLayer vía Viewer, selección de props, búsqueda,
   * exportar texto/Markdown) pasa por aquí para que la misma página no se
   * relea dos veces sin necesidad.
   */
  ensureText(pageIndex: number): TextRun[] {
    const page = this.model.pages[pageIndex];
    if (!page) return [];
    if (!this.loadedText.has(pageIndex)) {
      page.runs = this.soloVisibles(pageIndex, this.engine.getPageText(this.doc, pageIndex));
      this.loadedText.add(pageIndex);
      contarGetPageText();
    }
    return page.runs;
  }

  /**
   * E-123: descarta del texto/caracteres ofrecidos los que quedan fuera de la caja visible (CropBox). No toca el PDF.
   * Los `runId` no cambian (son el índice del objeto en la página), así que lo demás sigue direccionable igual.
   */
  private soloVisibles<T extends { boxPt: RectPt }>(pageIndex: number, items: T[]): T[] {
    if (this.model.pages[pageIndex]?.tamanoInvalido) return items; // E-129: caja absurda (NaN/1e9), no hay recorte fiable
    const v = this.engine.pageBox(this.doc, pageIndex);
    return items.filter((it) => cajaVisible(it.boxPt, v));
  }

  /** Caracteres de la página con su caja (selección de texto), cargados del motor la primera vez y cacheados. */
  ensureChars(pageIndex: number): CharBox[] {
    if (!this.model.pages[pageIndex]) return [];
    let c = this.chars.get(pageIndex);
    if (!c) {
      // Primero se descartan los caracteres fuera de la CropBox (E-123) y DESPUÉS se reordena (E-122): el orden de
      // lectura se decide con las líneas que de verdad se ven (la primera y la última visibles), no con texto recortado.
      // PDFium entrega las líneas al revés en /Rotate 90; se normaliza aquí, una sola vez.
      const visibles = this.soloVisibles(pageIndex, this.engine.getCharBoxes(this.doc, pageIndex));
      c = ordenLecturaCaracteres(visibles, this.model.pages[pageIndex]!.rotation);
      this.chars.set(pageIndex, c);
    }
    return c;
  }

  /** ¿Ya se cargó (y no se invalidó desde entonces) el texto de esta página? Solo para tests/diagnóstico. */
  hasLoadedText(pageIndex: number): boolean {
    return this.loadedText.has(pageIndex);
  }

  /** Olvida el texto cacheado de una página: la próxima `ensureText()` lo vuelve a pedir al motor. */
  invalidateText(pageIndex: number): void {
    this.loadedText.delete(pageIndex);
    this.chars.delete(pageIndex);
  }

  /**
   * Reconstruye SOLO la página `pageIndex` (tamaño, rotación y texto) y
   * notifica el cambio con el alcance de esa única página — la mitad del
   * arreglo de E-043/E-044: un comando que toca una página (rotar, insertar
   * texto/imagen, resaltar, formulario…) ya no fuerza reconstruir las N
   * páginas del documento. Se carga el texto EAGER aquí (a diferencia de
   * `buildPages`) porque la página que acaba de cambiar es, casi siempre, la
   * que el usuario tiene delante — cargarla de inmediato es una sola llamada
   * al motor, y evita un parpadeo de "texto vacío" hasta el próximo
   * `ensureText`.
   */
  refreshPage(pageIndex: number): void {
    if (pageIndex < 0 || pageIndex >= this.model.pages.length) return;
    const page: PageModel = {
      index: pageIndex,
      ...EditSession.tamanoPagina(this.engine, this.doc, pageIndex),
      origenPt: this.engine.pageBox(this.doc, pageIndex).origenPt,
      rotation: this.engine.pageRotation(this.doc, pageIndex),
      runs: this.soloVisibles(pageIndex, this.engine.getPageText(this.doc, pageIndex))
    };
    this.loadedText.add(pageIndex);
    this.chars.delete(pageIndex);
    contarGetPageText();
    this.model.refreshPage(pageIndex, page);
  }

  /**
   * Reconstruye TODO el modelo desde el estado actual del documento — para
   * comandos que cambian el CONJUNTO de páginas (borrar/mover/duplicar/
   * insertar PDF), donde los índices de todas las páginas posteriores a la
   * tocada se desplazan. Sigue siendo perezosa en el texto (`buildPages` no
   * llama a `getPageText`): el coste que queda es releer `sizePt`/
   * `rotation` de cada página, mucho más barato que el texto.
   */
  refresh(): void {
    this.loadedText.clear();
    this.chars.clear();
    this.model.reset(EditSession.buildPages(this.engine, this.doc));
  }

  /** Notifica a la UI que cambió el outline (ver `DocumentModel.onOutlineChange`). */
  refreshOutline(): void {
    this.model.notifyOutlineChanged();
  }

  /** Recarga el documento desde unos bytes (snapshot) y reconstruye el modelo. */
  async reload(bytes: Uint8Array): Promise<void> {
    // Primero el nuevo y solo después se cierra el viejo: si `open` falla, la sesión sigue en un documento vivo (E-125).
    const nuevo = await this.engine.open(bytes);
    this.engine.close(this.doc);
    this.doc = nuevo;
    this.refresh();
  }
}
