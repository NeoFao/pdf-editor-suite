import type { PdfEngine, DocHandle, TextRun, CharBox } from '../engine/PdfEngine';
import { DocumentModel } from './DocumentModel';
import type { PageModel } from './types';
import { contarGetPageText } from '../diagnostico';

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
        sizePt: engine.pageSize(doc, i),
        rotation: engine.pageRotation(doc, i),
        runs: []
      });
    }
    return pages;
  }

  static async open(engine: PdfEngine, bytes: Uint8Array): Promise<EditSession> {
    const doc = await engine.open(bytes);
    return new EditSession(engine, doc, new DocumentModel(EditSession.buildPages(engine, doc)));
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
      page.runs = this.engine.getPageText(this.doc, pageIndex);
      this.loadedText.add(pageIndex);
      contarGetPageText();
    }
    return page.runs;
  }

  /** Caracteres de la página con su caja (selección de texto), cargados del motor la primera vez y cacheados. */
  ensureChars(pageIndex: number): CharBox[] {
    if (!this.model.pages[pageIndex]) return [];
    let c = this.chars.get(pageIndex);
    if (!c) { c = this.engine.getCharBoxes(this.doc, pageIndex); this.chars.set(pageIndex, c); }
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
      sizePt: this.engine.pageSize(this.doc, pageIndex),
      rotation: this.engine.pageRotation(this.doc, pageIndex),
      runs: this.engine.getPageText(this.doc, pageIndex)
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
    this.engine.close(this.doc);
    this.doc = await this.engine.open(bytes);
    this.refresh();
  }
}
