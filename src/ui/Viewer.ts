import { PageGeometry } from '../coords/PageGeometry';
import type { EditSession } from '../model/EditSession';
import { visiblePageIndices } from './layout';
import { TextLayer, type EditRequest } from './TextLayer';
import { ImageLayer } from './ImageLayer';
import type { PtPoint } from '../coords/PageGeometry';
import type { RectPt } from '../engine/PdfEngine';
import { pathMasCercano, normalizeRect, type PathCandidate } from './toolGeometry';
import { contarRenderPage, fijarPaginasPintadas } from '../diagnostico';
import { hayGestoEnCurso } from './gesto';
import { SeleccionTexto } from './SeleccionTexto';
import { marcadoBajoPunto, ordenLecturaMarcados, type MarcadoHit, type QuadPt } from '../coords/quads';
import { textoDeMarcado } from '../texto/seleccionTexto';

const GAP = 16;
/** E-068: espera máxima hasta el PRIMER evento de scroll de `scrollToPage` (con la CPU cargada tarda más de 150 ms). */
const ESPERA_INICIO_SCROLL_MS = 1500;

/**
 * Desalojo de páginas lejanas (E-045, docs/ERRORES-CONOCIDOS.md): el visor
 * ya era perezoso al PINTAR (`renderVisible` solo renderiza lo visible +
 * `RENDER_OVERSCAN`), pero `this.rendered` solo CRECÍA — recorrer un
 * documento de 500 páginas acababa con los 500 `<canvas>` (más su
 * `TextLayer`, notas, formularios e imágenes) vivos en memoria a la vez. Dos
 * cotas independientes: un "colchón" de páginas alrededor de lo visible que
 * NUNCA se desaloja (evita parpadeo en un scroll corto) y un tope duro sobre
 * el total pintado (para que el colchón mismo no crezca sin límite en un
 * viewport muy alto o páginas muy pequeñas).
 */
const EVICT_OVERSCAN = 6;
const MAX_PAGINAS_PINTADAS = 12;

/** Herramienta activa del visor: excluyentes entre sí (App.setTool es el único punto de entrada). */
/** Anotaciones que se pueden seleccionar y borrar con un clic (T14). */
export type MarcadoKind = 'note' | 'highlight' | 'underline' | 'strikeout';

export type ToolMode = 'none' | 'insert' | 'pen' | 'note' | 'rect' | 'eraser';

export const ETIQUETA_MARCADO: Record<MarcadoKind, string> = { note: 'Nota', highlight: 'Resaltado', underline: 'Subrayado', strikeout: 'Tachado' };

/** Radio de "casi encima" del borrador, en px CSS (se convierte a pt con la escala real de cada página). */
const RADIO_BORRADOR_CSS = 6;

export interface ViewerCallbacks {
  onEdit: (req: EditRequest) => void;
  onSelect: (pageIndex: number, runId: number) => void;
  onBackgroundClick: (pageIndex: number, at: PtPoint) => void;
  onMove: (pageIndex: number, runId: number, dxPt: number, dyPt: number) => void;
  onPageChange?: (pageIndex: number) => void;
  onStroke?: (pageIndex: number, points: PtPoint[]) => void;
  /** Fin de un arrastre en modo rectángulo (#16): rect ya normalizado, en puntos PDF. */
  onDrawRect?: (pageIndex: number, rect: RectPt) => void;
  /** Clic en modo borrador (#17) que encontró un path (trazo/rectángulo) cerca: su objIndex en el motor. */
  onErase?: (pageIndex: number, objIndex: number) => void;
  /** Campo de texto AcroForm confirmado (evento 'change', no tecla a tecla). */
  onFormText?: (pageIndex: number, annotIndex: number, value: string, oldValue: string) => void;
  /** Casilla AcroForm marcada/desmarcada. */
  onFormChecked?: (pageIndex: number, annotIndex: number, checked: boolean) => void;
  /** Selección de un combo o una lista confirmada (evento 'change'). `values` son las etiquetas elegidas. */
  onFormChoice?: (pageIndex: number, annotIndex: number, values: string[]) => void;
  /** Widget de un grupo de radio marcado. */
  onFormRadio?: (pageIndex: number, annotIndex: number) => void;
  /** Clic (sin arrastre) sobre el marco de una imagen: la selecciona. */
  onImageSelect?: (pageIndex: number, objIndex: number) => void;
  /** Fin de un gesto de mover/redimensionar una imagen: rect final en puntos PDF. */
  onImageChangeRect?: (pageIndex: number, objIndex: number, newRectPt: RectPt, oldRectPt: RectPt) => void;
  /** Clic en modo borrador sobre un resaltado, subrayado, tachado o nota (sin trazo cerca): su índice entre todas las anotaciones de la página. */
  onEraseMarcado?: (pageIndex: number, annotIndex: number, kind: MarcadoKind) => void;
  /** Cambia la anotación de marcado seleccionada con un clic (herramienta "ninguna"); `null` = ya no hay ninguna. */
  onMarcadoSelect?: (sel: { pageIndex: number; annotIndex: number; kind: MarcadoKind } | null) => void;
  /** Empieza un arrastre de selección de texto: la selección de línea/imagen vigente ya no vale. */
  onTextSelectionStart?: () => void;
}

/** Renderiza páginas visibles (canvas del motor) con su capa de texto encima. */
export class Viewer {
  private wrappers: HTMLElement[] = [];
  private geoms: PageGeometry[] = [];
  private rendered = new Set<number>();
  private scale = 1;
  private highlights = new Map<number, RectPt[]>();
  /** Coincidencia ACTUAL de buscar y reemplazar (la que reemplazará el próximo "Reemplazar"), en puntos PDF; se pinta más fuerte que el resto. */
  private currentMatch: { pageIndex: number; rect: RectPt } | null = null;
  private observer: IntersectionObserver | null = null;
  private currentPage = 0;
  /**
   * Página fijada por una navegación EXPLÍCITA (`scrollToPage`, ver E-032).
   * Mientras no sea `null`, el `IntersectionObserver` no puede reafirmar otra
   * página, aunque calcule que "la más visible" es otra. Solo se libera
   * cuando el USUARIO desplaza el visor de verdad — por cualquier vía:
   * rueda, gesto táctil, teclado (flechas/PageUp/PageDown/Home/End/espacio
   * con el visor enfocado) o arrastrando la barra de scroll. Sin este freno,
   * el scroll que `scrollToPage` dispara (o su ausencia, si el destino ya
   * cabía en el viewport) deja que el observer decida por su cuenta cuál es
   * "la más visible" y pise la selección explícita del usuario.
   */
  private pinnedPage: number | null = null;
  /**
   * `true` mientras un `scrollToPage()` está "en vuelo": distingue el scroll
   * que ese propio método dispara (o que no dispara nada, si el destino ya
   * cabía) de un scroll real del usuario. El listener de `scroll` usa este
   * flag para decidir si lo que ve es programático (lo ignora) o del usuario
   * (libera `pinnedPage`) — así el teclado y el arrastre de la barra, que no
   * emiten `wheel` ni `touchmove`, también liberan el pin (ver corrección
   * de revisión de E-032: antes solo `wheel`/`touchmove` lo hacían, y
   * PageDown/flechas/Home/End/arrastrar la barra dejaban el indicador
   * congelado tras una navegación explícita — la misma familia de defecto
   * que E-032, con otro disparador).
   */
  private programmaticScroll = false;
  /**
   * E-068: `scrollTop` (px CSS de scroll) al que debe llegar el scroll de `scrollToPage`, o `null`
   * si no hay navegación pendiente. Es la referencia que distingue "scroll programático que llega
   * tarde" de "scroll del usuario", en vez de fiarse solo de un temporizador.
   */
  private pinTop: number | null = null;
  /** Respaldo de `scrollend` (no todos los navegadores lo emiten todavía) y red de seguridad para cuando el scroll programático no mueve nada. */
  private scrollEndFallback: ReturnType<typeof setTimeout> | null = null;
  /** Herramienta activa (§1 del lote D): fijada SIEMPRE por `App.setTool` vía `setTool()`. */
  private tool: ToolMode = 'none';
  /** Color de herramienta (§2, #18): usado por la vista previa de la pluma y del rectángulo mientras se arrastra. */
  private toolColor: [number, number, number] = [220, 20, 20];
  /**
   * Imagen actualmente seleccionada (marco con tiradores, #20/#21), o `null`.
   * Igual que la selección de un run (ver `TextLayer`/`App.selection`), no
   * sobrevive a un `rebuild()` completo salvo que se reafirme explícitamente
   * con `selectImage()` — lo hace `App` tras insertar una firma desde
   * imagen, para que quede lista para reposicionarla sin un segundo clic.
   */
  private selectedImage: { pageIndex: number; objIndex: number } | null = null;

  /**
   * Selección de texto por arrastre (T12). Solo con la herramienta "ninguna";
   * pinta únicamente mientras existe (en reposo no hay nodos, E-029). Se descarta
   * al re-pintar o desalojar su página y al reconstruir el visor: los índices de
   * carácter solo valen para el texto que había al seleccionar.
   */
  private readonly textoSel = new SeleccionTexto({
    wrapper: (i) => this.wrappers[i],
    geom: (i) => this.geoms[i]!,
    pagina: (i) => {
      const p = this.session.model.pages[i]!;
      return { sizePt: p.sizePt, rotation: p.rotation };
    },
    chars: (i) => this.session.ensureChars(i),
    activa: () => this.tool === 'none',
    alEmpezar: () => {
      // La selección de texto sustituye a la de una línea o imagen.
      this.root.querySelectorAll('.run.selected').forEach((el) => el.classList.remove('selected'));
      this.cb.onTextSelectionStart?.();
    }
  });

  /** Texto y quads de la selección de texto vigente (con ratón), o `null` si no hay. */
  seleccionTexto(): { pageIndex: number; texto: string; quads: QuadPt[] } | null {
    const pageIndex = this.textoSel.pageIndex;
    if (pageIndex === null) return null;
    return { pageIndex, texto: this.textoSel.texto(), quads: this.textoSel.quads() };
  }

  limpiarSeleccionTexto(): void { this.textoSel.limpiar(); }

  /**
   * Mayús+flecha desde la línea enfocada `runId` de la página `pageIndex` (T16): amplía o reduce la selección
   * de texto un carácter o una línea. Devuelve el texto seleccionado ('' si queda vacía) o `null` si no
   * procede (otra herramienta activa, línea desconocida o sin caracteres).
   */
  extenderSeleccionTeclado(pageIndex: number, runId: number, mov: 'caracter' | 'linea', dir: 1 | -1): string | null {
    if (this.tool !== 'none') return null;
    const run = this.session.model.pages[pageIndex]?.runs.find((r) => r.runId === runId);
    if (!run) return null;
    this.limpiarMarcadoSeleccionado(); // la selección de texto sustituye a la de una anotación
    return this.textoSel.extender(pageIndex, run.boxPt, mov, dir) ? this.textoSel.texto() : null;
  }

  /**
   * Alt+↓/↑ (T16): selecciona la anotación siguiente/anterior de la página `pageIndex` en ORDEN DE LECTURA,
   * con el mismo estado que un clic (contorno, `aria-selected`, Supr/Escape). Sin ninguna seleccionada
   * empieza por la primera (↓) o la última (↑); al llegar al final da la vuelta. Devuelve lo necesario para
   * anunciarla, o `null` si la página no tiene anotaciones (o hay otra herramienta activa).
   */
  seleccionarMarcadoPorTeclado(pageIndex: number, dir: 1 | -1): { kind: MarcadoKind; posicion: number; total: number; texto: string } | null {
    if (this.tool !== 'none' || !this.geoms[pageIndex]) return null;
    const hits = ordenLecturaMarcados(this.marcadosDePagina(pageIndex), this.geoms[pageIndex]!);
    if (hits.length === 0) return null;
    const actual = this.marcadoSel?.pageIndex === pageIndex ? hits.findIndex((h) => h.index === this.marcadoSel!.annotIndex) : -1;
    const i = actual < 0 ? (dir > 0 ? 0 : hits.length - 1) : (actual + dir + hits.length) % hits.length;
    const hit = hits[i]!;
    this.limpiarMarcadoSeleccionado();
    this.textoSel.limpiar();
    this.root.querySelectorAll('.run.selected').forEach((el) => el.classList.remove('selected'));
    this.marcadoSel = { pageIndex, annotIndex: hit.index, kind: hit.kind };
    this.pintarMarcadoSel(hit);
    this.wrappers[pageIndex]?.querySelector('.marcado-sel-quad')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    this.cb.onMarcadoSelect?.(this.marcadoSel);
    const texto = hit.kind === 'note' ? (hit.contenido ?? '') : textoDeMarcado(this.session.ensureChars(pageIndex), hit);
    return { kind: hit.kind, posicion: i + 1, total: hits.length, texto };
  }

  /**
   * Anotación de marcado seleccionada con un clic (T14), o `null`. Solo con la herramienta
   * "ninguna". Se descarta al repintar su página (los índices de anotación pueden haberse
   * desplazado), al reconstruir el visor y al cambiar de herramienta.
   */
  private marcadoSel: { pageIndex: number; annotIndex: number; kind: MarcadoKind } | null = null;

  marcadoSeleccionado(): { pageIndex: number; annotIndex: number; kind: MarcadoKind } | null { return this.marcadoSel; }

  /** Quita la selección de anotación y su contorno; avisa a la app solo si había una. */
  limpiarMarcadoSeleccionado(): void {
    const s = this.marcadoSel;
    if (!s) return;
    this.marcadoSel = null;
    this.wrappers[s.pageIndex]?.querySelector('.marcado-sel-layer')?.remove();
    this.cb.onMarcadoSelect?.(null);
  }

  /** Anotaciones seleccionables de la página `i`, con sus quads (pt de usuario). */
  private marcadosDePagina(i: number): MarcadoHit[] {
    const eng = this.session.engine, doc = this.session.doc;
    const out: MarcadoHit[] = [];
    for (const c of eng.getComments(doc, i)) {
      if (c.kind !== 'note' && c.kind !== 'highlight' && c.kind !== 'underline' && c.kind !== 'strikeout') continue;
      out.push({ index: c.index, kind: c.kind, rectPt: c.rectPt, contenido: c.text, quads: c.kind === 'note' ? [] : eng.getMarkupQuads(doc, i, c.index) });
    }
    return out;
  }

  /**
   * Clic en la página `i` (fase de CAPTURA, antes que el `click` de una línea): con la herramienta "ninguna",
   * un clic sobre una anotación la selecciona y NO llega a la línea de debajo (así no entra a editar).
   * PRECEDENCIA con una línea resaltada debajo:
   *  - arrastrar (> 4 px) selecciona TEXTO (T12): `SeleccionTexto` traga el `click` posterior en `window`,
   *    que corre antes que este listener, así que aquí ni se ve;
   *  - clic corto sobre la anotación: selecciona la ANOTACIÓN (es lo visible bajo el puntero, como en Acrobat) y
   *    deja además la línea de debajo seleccionada, sin editarla (para encadenar Resaltar/Subrayar/Tachar);
   *  - segundo clic sobre la anotación ya seleccionada: la deselecciona y deja pasar el clic, que edita la
   *    línea (la edición sigue siendo posible; también con Enter desde el teclado).
   * Tirador de mover, línea en edición, marco de imagen y controles de formulario quedan fuera.
   */
  private alClicMarcado(pageIndex: number, wrapper: HTMLElement, e: MouseEvent): void {
    if (this.tool !== 'none') return;
    const t = e.target as HTMLElement | null;
    if (t?.closest('.run-drag, .run.editing, .image-box, input, select, textarea, button')) return;
    const r = wrapper.getBoundingClientRect();
    const p = this.geoms[pageIndex]!.cssToPt(e.clientX - r.left, e.clientY - r.top); // px CSS de página -> pt de usuario
    const hit = marcadoBajoPunto(this.marcadosDePagina(pageIndex), p.xPt, p.yPt);
    const actual = this.marcadoSel;
    if (!hit) { this.limpiarMarcadoSeleccionado(); return; }
    if (actual && actual.pageIndex === pageIndex && actual.annotIndex === hit.index) { this.limpiarMarcadoSeleccionado(); return; }
    e.stopPropagation(); e.preventDefault();
    this.limpiarMarcadoSeleccionado();
    this.textoSel.limpiar();
    this.root.querySelectorAll('.run.selected').forEach((el) => el.classList.remove('selected'));
    this.marcadoSel = { pageIndex, annotIndex: hit.index, kind: hit.kind };
    this.pintarMarcadoSel(hit);
    this.cb.onMarcadoSelect?.(this.marcadoSel);
    // La línea bajo el puntero queda SELECCIONADA (sin entrar a editarla): así Resaltar/Subrayar/Tachar siguen
    // aplicándose a ella aunque ya tenga una anotación (varios marcados sobre la misma línea).
    const run = t?.closest<HTMLElement>('.run');
    const runId = run ? Number(run.dataset.runId) : NaN;
    if (run && Number.isFinite(runId)) {
      run.classList.add('selected');
      this.cb.onSelect(pageIndex, runId);
    }
  }

  /** Contorno visible de la anotación seleccionada: un recuadro por quad (px CSS de página, vía la geometría real). */
  private pintarMarcadoSel(hit: MarcadoHit): void {
    const s = this.marcadoSel;
    const wrapper = s ? this.wrappers[s.pageIndex] : undefined;
    if (!s || !wrapper) return;
    wrapper.querySelector('.marcado-sel-layer')?.remove();
    const geom = this.geoms[s.pageIndex]!;
    const capa = document.createElement('div');
    capa.className = 'marcado-sel-layer';
    capa.setAttribute('role', 'listbox');
    capa.setAttribute('aria-label', 'Anotación seleccionada');
    Object.assign(capa.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    const opcion = document.createElement('div');
    opcion.className = 'marcado-sel';
    opcion.setAttribute('role', 'option');
    opcion.setAttribute('aria-selected', 'true');
    opcion.dataset.tipo = hit.kind;
    const o = hit.kind === 'note' ? 'a' : 'o';
    opcion.setAttribute('aria-label', `${ETIQUETA_MARCADO[hit.kind]} seleccionad${o}. Pulsa Supr para borrarl${o} o Escape para soltarl${o}.`);
    const cajas = hit.quads.length > 0
      ? hit.quads.map((q) => {
        const pts = [0, 2, 4, 6].map((k) => geom.ptToCss(q[k]!, q[k + 1]!));
        const left = Math.min(...pts.map((pp) => pp.x)), top = Math.min(...pts.map((pp) => pp.y));
        return { left, top, width: Math.max(...pts.map((pp) => pp.x)) - left, height: Math.max(...pts.map((pp) => pp.y)) - top };
      })
      : [geom.rectPtToCss(hit.rectPt)];
    for (const c of cajas) {
      const caja = document.createElement('div');
      caja.className = 'marcado-sel-quad';
      caja.setAttribute('aria-hidden', 'true');
      Object.assign(caja.style, { position: 'absolute', left: `${c.left}px`, top: `${c.top}px`, width: `${c.width}px`, height: `${c.height}px` });
      opcion.appendChild(caja);
    }
    capa.appendChild(opcion);
    wrapper.appendChild(capa);
  }

  constructor(
    private readonly root: HTMLElement,
    private readonly session: EditSession,
    private readonly cb: ViewerCallbacks
  ) {
    this.layout();
    this.root.addEventListener('scroll', () => {
      this.renderVisible();
      if (this.programmaticScroll) {
        // Sigue en vuelo el scroll que disparó `scrollToPage`. Si ya está en el destino, se cierra
        // aquí; si no, el respaldo se reinicia (~150ms tras el ÚLTIMO evento, no del primero).
        if (this.llegoAlPin()) this.finishProgrammaticScroll();
        else this.armScrollEndFallback();
        return;
      }
      // E-068: un evento de scroll "rezagado" que deja el visor exactamente donde la navegación
      // explícita lo quería (p. ej. el que provoca el vaciado del DOM en `rebuild`) no es del usuario.
      if (this.pinnedPage !== null && this.llegoAlPin()) return;
      // No hay ningún scroll programático en curso: esto es scroll real del
      // usuario (teclado, arrastre de la barra de scroll, rueda que
      // `wheel` ya liberó más abajo, gesto táctil que `touchmove` ya
      // liberó...). Libera el pin.
      this.pinnedPage = null; this.pinTop = null;
    });
    // `wheel`/`touchmove` liberan el pin de inmediato, incluso si ocurren
    // DURANTE un scroll programático en curso: también son intención real
    // del usuario (p. ej. mueve la rueda mientras el smooth-scroll de
    // `scrollToPage` todavía está animando).
    const liberarPin = (): void => { this.pinnedPage = null; this.pinTop = null; };
    this.root.addEventListener('wheel', liberarPin, { passive: true });
    this.root.addEventListener('touchmove', liberarPin, { passive: true });
    // Fin real del scroll programático (Chromium/Firefox): cierra la ventana
    // antes de que expire el respaldo de 150ms.
    this.root.addEventListener('scrollend', () => this.finishProgrammaticScroll());
    this.renderVisible();
    this.session.model.on('change', (pageIndex) => { this.rendered.delete(pageIndex); this.renderVisible(); });
    // Recarga completa (deshacer de borrar/insertar): reconstruir todo.
    this.session.model.onReload(() => this.rebuild());
  }

  /** Reinicia el temporizador de respaldo de `scrollend` (~150ms sin nuevos eventos `scroll`). */
  private armScrollEndFallback(ms = 150): void {
    if (this.scrollEndFallback !== null) clearTimeout(this.scrollEndFallback);
    this.scrollEndFallback = setTimeout(() => this.finishProgrammaticScroll(), ms);
  }

  /** true si `scrollTop` ya está (±1 px CSS) en el destino de la navegación explícita pendiente. */
  private llegoAlPin(): boolean {
    return this.pinTop !== null && Math.abs(this.root.scrollTop - this.pinTop) <= 1;
  }

  /** Cierra la ventana de "scroll programático en curso". Idempotente. */
  private finishProgrammaticScroll(): void {
    if (this.scrollEndFallback !== null) { clearTimeout(this.scrollEndFallback); this.scrollEndFallback = null; }
    this.programmaticScroll = false;
  }

  /**
   * Elemento `.page` de la página `i` y la escala actual (px CSS por pt), para capas
   * TEMPORALES de solo lectura (vista previa de encabezado/marca de agua): quien lo use
   * debe retirar su capa; el visor no la conoce.
   */
  paginaDom(i: number): { el: HTMLElement; escala: number } | null {
    const el = this.wrappers[i];
    return el ? { el, escala: this.scale } : null;
  }

  /** Cambia la escala (zoom) y vuelve a maquetar y renderizar. */
  setScale(scale: number): void {
    this.scale = scale;
    this.rebuild();
  }

  /**
   * Desplaza el visor hasta la página indicada tras una navegación explícita
   * (App.goToPage). Fija `currentPage` y `pinnedPage` de inmediato: si el
   * scroll no se mueve (la página ya era visible, o todo el documento cabe
   * en el viewport) no hay ningún otro mecanismo que vaya a corregir
   * `currentPage`, así que tiene que quedar bien aquí mismo (E-032).
   *
   * Marca `programmaticScroll` y arma el respaldo de inmediato (no solo al
   * primer evento `scroll`): si `scrollIntoView` no dispara ningún `scroll`
   * porque el destino ya era visible, nada más va a cerrar la ventana.
   */
  scrollToPage(i: number): void {
    this.currentPage = i;
    this.pinnedPage = i;
    const wrapper = this.wrappers[i];
    if (!wrapper) return;
    // Destino del scroll (px CSS de scroll de `root`), acotado como lo acota el navegador.
    const bruto = this.root.scrollTop + wrapper.getBoundingClientRect().top - this.root.getBoundingClientRect().top - this.root.clientTop;
    this.pinTop = Math.max(0, Math.min(bruto, this.root.scrollHeight - this.root.clientHeight));
    if (this.llegoAlPin()) {
      // Ya estamos ahí: no habrá scroll ni `scrollend`; no hay nada que esperar.
      this.finishProgrammaticScroll();
      return;
    }
    // E-068: el primer evento de un scroll suave puede tardar más de 150 ms con la CPU cargada. Hasta
    // que llegue, el respaldo es largo; después se reinicia con los 150 ms de siempre en cada evento.
    this.programmaticScroll = true;
    this.armScrollEndFallback(ESPERA_INICIO_SCROLL_MS);
    wrapper.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /**
   * Selecciona una imagen sin reconstruir la página: la página ya tiene el
   * DOM fresco (llamar justo después de un comando que ya disparó
   * `c.refresh()`, p. ej. insertar una firma desde imagen), así que basta
   * alternar la clase `.selected` sobre los `.image-box` ya presentes.
   */
  selectImage(pageIndex: number, objIndex: number): void {
    this.selectedImage = { pageIndex, objIndex };
    const wrapper = this.wrappers[pageIndex];
    if (!wrapper) return;
    for (const el of Array.from(wrapper.querySelectorAll<HTMLElement>('.image-box'))) {
      el.classList.toggle('selected', el.dataset.objIndex === String(objIndex));
    }
  }

  /** Deselecciona cualquier imagen (clic fuera del marco). */
  deselectImage(): void {
    this.selectedImage = null;
    for (const w of this.wrappers) {
      w.querySelectorAll('.image-box.selected').forEach((el) => el.classList.remove('selected'));
    }
  }

  /**
   * Único punto de entrada para activar/desactivar la herramienta en el
   * visor (llamado siempre desde `App.setTool`, nunca al revés): pen/rect/
   * eraser capturan el puntero sobre la capa superior de cada página
   * (`.tool-layer`); insert/note/none la dejan pasar (pointer-events: none)
   * para que el clic llegue al fondo de la página (`onBackgroundClick`) o a
   * una `.run`/`.image-box` normalmente.
   */
  setTool(tool: ToolMode): void {
    if (tool !== this.tool) this.limpiarMarcadoSeleccionado();
    this.tool = tool;
    const activo = tool === 'pen' || tool === 'rect' || tool === 'eraser';
    const cursor = tool === 'eraser' ? 'cell' : 'crosshair';
    this.root.querySelectorAll<HTMLElement>('.tool-layer').forEach((el) => {
      el.style.pointerEvents = activo ? 'auto' : 'none';
      el.style.cursor = cursor;
    });
  }

  /** Color de herramienta (#18): pluma y rectángulo lo usan para su vista previa mientras se arrastra. */
  setToolColor(color: [number, number, number]): void {
    this.toolColor = color;
  }

  /**
   * Capa de captura superior de una página, común a pluma (#16), rectángulo
   * (#16) y borrador (#17) — un único elemento por página, nunca tres
   * superpuestos, para no repetir la gestión de pointer-events/z-order.
   * Pluma y rectángulo capturan el puntero con `setPointerCapture` sobre
   * ESTE elemento (no sobre `window`/`document`): la regla `gesto-con-
   * cancelacion` lo permite explícitamente, siempre que se trate
   * `pointercancel` como cancelación — aquí deshace la vista previa y no
   * dispara ningún comando, igual que exige `src/ui/gesto.ts`. El borrador
   * no necesita arrastre: actúa en el propio `pointerdown` (un clic).
   */
  private attachToolCapture(el: HTMLElement, pageIndex: number): void {
    let pts: Array<[number, number]> = [];
    let drawing = false;
    let preview: HTMLCanvasElement | null = null;
    let rectPreview: HTMLElement | null = null;
    let startCss: [number, number] | null = null;

    const at = (e: PointerEvent): [number, number] => {
      const r = el.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };

    const posicionarPreviewRect = (a: [number, number], b: [number, number]): void => {
      if (!rectPreview) return;
      const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
      Object.assign(rectPreview.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
    };

    const limpiarVistaPrevia = (): void => {
      preview?.remove(); preview = null;
      rectPreview?.remove(); rectPreview = null;
      pts = []; startCss = null;
    };

    el.addEventListener('pointerdown', (e) => {
      if (this.tool === 'eraser') { this.handleEraseClick(pageIndex, at(e)); return; }
      if (this.tool !== 'pen' && this.tool !== 'rect') return;
      drawing = true;
      el.setPointerCapture(e.pointerId);
      startCss = at(e);
      pts = [startCss];
      if (this.tool === 'pen') {
        preview = document.createElement('canvas');
        preview.width = el.clientWidth; preview.height = el.clientHeight;
        Object.assign(preview.style, { position: 'absolute', inset: '0' });
        el.appendChild(preview);
      } else {
        rectPreview = document.createElement('div');
        rectPreview.className = 'rect-preview';
        Object.assign(rectPreview.style, {
          position: 'absolute', boxSizing: 'border-box',
          border: `2px dashed rgb(${this.toolColor.join(',')})`,
          pointerEvents: 'none'
        });
        el.appendChild(rectPreview);
        posicionarPreviewRect(startCss, startCss);
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = at(e);
      if (this.tool === 'pen' && preview) {
        pts.push(p);
        const ctx = preview.getContext('2d')!;
        ctx.clearRect(0, 0, preview.width, preview.height);
        ctx.strokeStyle = `rgb(${this.toolColor.join(',')})`;
        ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath(); ctx.moveTo(pts[0]![0], pts[0]![1]);
        for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
        ctx.stroke();
      } else if (this.tool === 'rect' && startCss) {
        pts[1] = p;
        posicionarPreviewRect(startCss, p);
      }
    });

    const finish = (): void => {
      if (!drawing) return;
      drawing = false;
      if (this.tool === 'pen') {
        if (pts.length >= 2) {
          const geom = this.geoms[pageIndex]!;
          const ptPts = pts.map(([x, y]) => geom.cssToPt(x, y));
          this.cb.onStroke?.(pageIndex, ptPts);
        }
      } else if (this.tool === 'rect' && startCss) {
        const endCss = pts[1] ?? startCss;
        const geom = this.geoms[pageIndex]!;
        const a = geom.cssToPt(startCss[0], startCss[1]);
        const b = geom.cssToPt(endCss[0], endCss[1]);
        const rect = normalizeRect(a.xPt, a.yPt, b.xPt, b.yPt);
        // Menor de 3×3 pt: fue un clic, no un arrastre — ni siquiera se
        // emite el comando (drawRect también lo rechazaría, pero así no
        // queda un DrawRectCmd sin efecto en la pila de deshacer).
        if (rect.wPt >= 3 && rect.hPt >= 3) this.cb.onDrawRect?.(pageIndex, rect);
      }
      limpiarVistaPrevia();
    };
    el.addEventListener('pointerup', finish);
    // pointercancel: SIEMPRE cancelar (nunca aplicar), igual que gesto.ts —
    // aquí no hace falta reenganchar nada porque la captura está sobre este
    // propio elemento, no sobre window/document.
    el.addEventListener('pointercancel', () => { drawing = false; limpiarVistaPrevia(); });
  }

  /**
   * Borrador (#17): busca el path (trazo de pluma o rectángulo) cuya arista
   * más cercana al clic esté a ≤6px CSS (convertidos a pt con la escala real
   * de ESTA página) y lo borra. Solo entre los paths CON TRAZO
   * (`hasStroke`): un resaltado o un subrayado/tachado también son objetos de
   * tipo PATH para el motor (mismo tipo de objeto de rectángulo, solo que
   * con relleno y sin trazo — ver el contrato de `listPathObjects` en
   * PdfEngine.ts), y el motor no expone una forma de leer el modo de mezcla
   * de un objeto de página ya creado (solo de fijarlo), así que no hay forma
   * fiable de distinguir por lectura un resaltado (relleno en modo Multiply)
   * de un subrayado (relleno opaco normal) — pero "tiene trazo" sí se lee
   * con certeza y separa EXACTAMENTE lo que este borrador debe cubrir (pluma
   * y rectángulo, ninguno de los cuales lleva relleno) de lo que no debe
   * tocar.
   */
  private handleEraseClick(pageIndex: number, [cssX, cssY]: [number, number]): void {
    const geom = this.geoms[pageIndex]!;
    const click = geom.cssToPt(cssX, cssY);
    const maxDistPt = RADIO_BORRADOR_CSS / geom.scale;
    const candidatos: PathCandidate[] = this.session.engine
      .listPathObjects(this.session.doc, pageIndex)
      .filter((p) => p.hasStroke)
      .map((p) => ({ objIndex: p.objIndex, segments: this.session.engine.getPathSegments(this.session.doc, pageIndex, p.objIndex) }));
    const objIndex = pathMasCercano(click.xPt, click.yPt, candidatos, maxDistPt);
    if (objIndex !== null) { this.cb.onErase?.(pageIndex, objIndex); return; }
    // Sin trazo cerca: una anotación de marcado o nota bajo el puntero (por sus quads, no solo por /Rect).
    const marcado = marcadoBajoPunto(this.marcadosDePagina(pageIndex), click.xPt, click.yPt);
    if (marcado) this.cb.onEraseMarcado?.(pageIndex, marcado.index, marcado.kind);
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
      if (!Number.isFinite(i)) return;
      // Hay una navegación explícita pendiente (goToPage → scrollToPage) que
      // el usuario no ha contradicho con scroll real: el observer no la
      // puede pisar aunque calcule que "la más visible" es otra (E-032).
      if (this.pinnedPage !== null && i !== this.pinnedPage) return;
      if (i === this.currentPage) return;
      this.currentPage = i;
      this.cb.onPageChange?.(i);
    }, { root: this.root, threshold: [0.2, 0.6] });
    for (const w of this.wrappers) this.observer.observe(w);
  }

  /** Fija las coincidencias de búsqueda a resaltar por página y las repinta. */
  setHighlights(byPage: Map<number, RectPt[]>, conservarActual = false): void {
    this.highlights = byPage;
    if (!conservarActual) this.currentMatch = null;
    for (let i = 0; i < this.wrappers.length; i++) this.drawHighlights(i);
  }

  /** Marca (o, con null, desmarca) la coincidencia actual: caja naranja encima del resto de resaltados. */
  setCurrentMatch(m: { pageIndex: number; rect: RectPt } | null): void {
    const previa = this.currentMatch?.pageIndex;
    this.currentMatch = m;
    if (previa !== undefined && previa !== m?.pageIndex) this.drawHighlights(previa);
    if (m) this.drawHighlights(m.pageIndex);
  }

  /**
   * Caja CSS (px de página, ya con /Rotate: `geom.rectPtToCss`, E-053) de un
   * rect en puntos PDF, y su posición dentro del contenido desplazable de
   * `root` (px CSS de scroll). `null` si la página no existe.
   */
  private cajaEnScroll(pageIndex: number, rect: RectPt): { left: number; top: number; width: number; height: number } | null {
    const wrapper = this.wrappers[pageIndex];
    const geom = this.geoms[pageIndex];
    if (!wrapper || !geom) return null;
    const c = geom.rectPtToCss(rect);
    const w = wrapper.getBoundingClientRect();
    const r = this.root.getBoundingClientRect();
    return {
      left: w.left - r.left + this.root.scrollLeft + c.left,
      top: w.top - r.top + this.root.scrollTop + c.top,
      width: c.width, height: c.height
    };
  }

  /**
   * Centro, en puntos PDF de la página `pageIndex`, de la parte de esa página que el visor
   * muestra ahora (intersección de la página con el área visible de `root`, medida en px CSS
   * de viewport y pasada a pt con la geometría de la página). `null` si ninguna parte de la
   * página está a la vista. Sirve para colocar lo recién insertado donde el usuario mira (E-070).
   */
  centroVisiblePt(pageIndex: number): { xPt: number; yPt: number } | null {
    const wrapper = this.wrappers[pageIndex];
    const geom = this.geoms[pageIndex];
    if (!wrapper || !geom) return null;
    const w = wrapper.getBoundingClientRect();
    const r = this.root.getBoundingClientRect();
    const izq = Math.max(w.left, r.left), der = Math.min(w.right, r.right);
    const arr = Math.max(w.top, r.top), aba = Math.min(w.bottom, r.bottom);
    if (der <= izq || aba <= arr) return null;
    // px CSS dentro de la página (origen arriba-izquierda de la página).
    const p = geom.cssToPt((izq + der) / 2 - w.left, (arr + aba) / 2 - w.top);
    return { xPt: p.xPt, yPt: p.yPt };
  }

  /** true si la caja del rect (puntos PDF) está entera dentro de lo que el visor muestra ahora. */
  rectVisible(pageIndex: number, rect: RectPt): boolean {
    const b = this.cajaEnScroll(pageIndex, rect);
    if (!b) return false;
    const { scrollTop: st, scrollLeft: sl, clientHeight: ch, clientWidth: cw } = this.root;
    return b.top >= st && b.top + b.height <= st + ch && b.left >= sl && b.left + b.width <= sl + cw;
  }

  /**
   * Desplaza el visor para que la caja del rect (puntos PDF) quede visible,
   * centrada en el eje que haga falta. Tras `goToPage` (que fija el pin de la
   * página, E-032): el desplazamiento es inmediato y sustituye al suave de
   * `scrollToPage`. Funciona con páginas aún sin pintar (el wrapper conserva
   * su tamaño) y con /Rotate.
   */
  revelarRect(pageIndex: number, rect: RectPt): void {
    const b = this.cajaEnScroll(pageIndex, rect);
    if (!b) return;
    const { scrollTop: st, scrollLeft: sl, clientHeight: ch, clientWidth: cw } = this.root;
    const dentroV = b.top >= st && b.top + b.height <= st + ch;
    const dentroH = b.left >= sl && b.left + b.width <= sl + cw;
    this.programmaticScroll = true;
    this.armScrollEndFallback();
    this.root.scrollTo({
      top: dentroV ? st : Math.max(0, b.top + b.height / 2 - ch / 2),
      left: dentroH ? sl : Math.max(0, b.left + b.width / 2 - cw / 2),
      behavior: 'instant'
    });
  }

  private drawHighlights(i: number): void {
    const wrapper = this.wrappers[i];
    if (!wrapper) return;
    wrapper.querySelector('.hl-layer')?.remove();
    const rects = this.highlights.get(i) ?? [];
    const actual = this.currentMatch && this.currentMatch.pageIndex === i ? this.currentMatch.rect : null;
    if (rects.length === 0 && !actual) return;
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
    if (actual) {
      const c = geom.rectPtToCss(actual);
      const box = document.createElement('div');
      box.className = 'search-hl search-hl-current';
      Object.assign(box.style, {
        position: 'absolute', left: `${c.left}px`, top: `${c.top}px`,
        width: `${c.width}px`, height: `${c.height}px`,
        background: 'rgba(249, 115, 22, .5)', outline: '2px solid #c2410c'
      });
      layer.appendChild(box);
    }
    wrapper.appendChild(layer);
  }

  /** Nota marcada desde el panel Comentarios (página + índice de anotación); sobrevive a repintados. */
  private notaResaltada: { pageIndex: number; annotIndex: number } | null = null;

  /** Resalta en el visor la nota `annotIndex` de la página (clase `activa`); quita la marca de la anterior. */
  resaltarNota(pageIndex: number, annotIndex: number): void {
    const anterior = this.notaResaltada;
    this.notaResaltada = { pageIndex, annotIndex };
    if (anterior && anterior.pageIndex !== pageIndex) this.drawNotes(anterior.pageIndex);
    this.drawNotes(pageIndex);
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
      const r = this.notaResaltada;
      if (r && r.pageIndex === i && r.annotIndex === note.index) marker.classList.add('activa');
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

  /**
   * Marcos interactivos de las imágenes de la página (sello/firma
   * insertados, #20/#21). Se leen del motor, no del modelo (igual que
   * `drawNotes`/`drawFormFields`: no forman parte de `DocumentModel`). El
   * `.image-box` en reposo es invisible (sin borde, ver CSS en
   * index.next.html) — no interfiere con la prueba de oro de píxeles de
   * `fidelidad-reposo.spec.ts` (E-029) ni con la capa de texto.
   */
  private drawImages(i: number): void {
    const wrapper = this.wrappers[i];
    if (!wrapper) return;
    wrapper.querySelector('.image-layer')?.remove();
    const images = this.session.engine.listImageObjects(this.session.doc, i);
    if (images.length === 0) return;
    const geom = this.geoms[i]!;
    const layer = document.createElement('div');
    layer.className = 'image-layer';
    Object.assign(layer.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    const selectedHere = this.selectedImage && this.selectedImage.pageIndex === i ? this.selectedImage.objIndex : null;
    new ImageLayer(layer, i, images, geom, {
      onSelect: (pageIndex, objIndex) => {
        this.selectedImage = { pageIndex, objIndex };
        // Selección mutuamente excluyente con la de una línea de texto (ver TextLayer).
        wrapper.querySelectorAll('.run.selected').forEach((el) => el.classList.remove('selected'));
        this.cb.onImageSelect?.(pageIndex, objIndex);
      },
      onChangeRect: (pageIndex, objIndex, newRectPt, oldRectPt) => {
        this.cb.onImageChangeRect?.(pageIndex, objIndex, newRectPt, oldRectPt);
      }
    }, selectedHere);
    wrapper.appendChild(layer);
  }

  private rebuild(): void {
    this.root.textContent = '';
    this.wrappers = [];
    this.geoms = [];
    this.rendered = new Set();
    // Una operación de página (eliminar/insertar/deshacer) puede renumerar
    // las páginas: un pin apuntando al índice antiguo ya no significa nada.
    // `App.onReload` recalcula y vuelve a fijar `currentPage` por su cuenta.
    this.pinnedPage = null; this.pinTop = null;
    this.textoSel.limpiar();
    this.marcadoSel = null; // el DOM del visor se descarta entero justo debajo
    this.finishProgrammaticScroll(); // limpia también el temporizador de respaldo
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
      w.addEventListener('pointerdown', (e) => this.textoSel.alPulsar(page.index, e));
      w.addEventListener('click', (e) => this.alClicMarcado(page.index, w, e), true);
      // Clic en el fondo (no en un run ni en el marco de una imagen) → insertar en ese punto y deseleccionar la imagen activa.
      w.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('run')) return;
        if (target.closest('.image-box')) return;
        this.deselectImage();
        const rect = w.getBoundingClientRect();
        const geom = this.geoms[page.index]!;
        const at = geom.cssToPt(e.clientX - rect.left, e.clientY - rect.top);
        this.cb.onBackgroundClick(page.index, at);
      });
      this.root.appendChild(w);
      this.wrappers.push(w);
      // `page.sizePt` es el tamaño VISUAL (pt, ya girado); la fábrica lo devuelve al espacio de usuario (E-053).
      this.geoms.push(PageGeometry.desdeTamanoVisual(page.sizePt.widthPt, page.sizePt.heightPt, this.scale, page.rotation));
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
    this.evictFarPages();
    fijarPaginasPintadas(this.rendered.size);
  }

  /**
   * Desaloja (vuelve a "sin pintar") las páginas ya renderizadas que han
   * quedado lejos del viewport — ver el comentario de `EVICT_OVERSCAN`/
   * `MAX_PAGINAS_PINTADAS` (E-045). Nunca toca la página actual
   * (`currentPage`) ni la fijada por una navegación explícita (`pinnedPage`,
   * E-032): si el cálculo por overscan aun así las dejara fuera del
   * "colchón", se añaden de vuelta a mano.
   */
  private evictFarPages(): void {
    // E-034: nunca desalojar con un gesto en curso en cualquier página
    // (arrastrar una línea de texto, mover/redimensionar una imagen,
    // reordenar una miniatura) — destruir el DOM bajo un puntero capturado
    // rompería el gesto a medias. `hayGestoEnCurso()` es el único punto de
    // consulta del contador compartido de `src/ui/gesto.ts`.
    if (hayGestoEnCurso()) return;

    const heights = this.cssHeights();
    const keep = new Set(visiblePageIndices(heights, GAP, this.root.scrollTop, this.root.clientHeight, EVICT_OVERSCAN));
    keep.add(this.currentPage);
    if (this.pinnedPage !== null) keep.add(this.pinnedPage);

    // Tope duro: si el propio "colchón" (visible + overscan grande) ya
    // supera el máximo — viewport muy alto, páginas muy pequeñas — recorta
    // por lejanía a la página actual, sin tocar nunca currentPage/pinnedPage.
    if (keep.size > MAX_PAGINAS_PINTADAS) {
      const obligatorias = new Set<number>([this.currentPage]);
      if (this.pinnedPage !== null) obligatorias.add(this.pinnedPage);
      const resto = Array.from(keep)
        .filter((i) => !obligatorias.has(i))
        .sort((a, b) => Math.abs(a - this.currentPage) - Math.abs(b - this.currentPage));
      const cupo = Math.max(0, MAX_PAGINAS_PINTADAS - obligatorias.size);
      keep.clear();
      for (const i of obligatorias) keep.add(i);
      for (const i of resto.slice(0, cupo)) keep.add(i);
    }

    for (const i of Array.from(this.rendered)) {
      if (keep.has(i)) continue;
      this.evictPage(i);
    }
  }

  /**
   * Descarta el DOM pintado de una página (bitmap del canvas, `TextLayer`,
   * notas, formularios, imágenes, capa de herramienta) — el wrapper
   * conserva su `width`/`height` inline (fijados una vez en `layout()`), así
   * que el alto de scroll del panel no cambia ni un píxel. Al volver a
   * entrar en el viewport, `renderVisible()` la repinta desde cero, como la
   * primera vez.
   *
   * Tres excepciones — nunca se desaloja una página con estado vivo que se
   * perdería:
   * - una `.run` en edición (`contentEditable`): el texto a medio escribir
   *   se perdería sin pasar por `EditTextRunCmd`.
   * - una imagen seleccionada (`selectedImage`): sus tiradores quedarían
   *   huérfanos.
   * - un gesto de pluma/rectángulo en curso (`attachToolCapture` no pasa
   *   por `registrarGesto`, así que `hayGestoEnCurso()` no lo cubre — se
   *   detecta por la vista previa que deja en el DOM mientras dibuja).
   */
  private evictPage(i: number): void {
    const wrapper = this.wrappers[i];
    if (!wrapper) return;
    if (wrapper.querySelector('.run.editing')) return;
    if (this.selectedImage?.pageIndex === i) return;
    if (this.marcadoSel?.pageIndex === i) return; // anotación seleccionada: no se pierde al desalojar
    if (this.textoSel.pageIndex === i) return; // selección de texto viva: no se pierde al desalojar
    if (wrapper.querySelector('.tool-layer > canvas, .tool-layer > .rect-preview')) return;
    wrapper.textContent = '';
    this.rendered.delete(i);
  }

  private renderPage(i: number): void {
    const page = this.session.model.pages[i]!;
    // Texto perezoso (E-043, docs/ERRORES-CONOCIDOS.md): esta es la primera
    // vez que la página se pinta, así que es también el momento de cargar su
    // texto (si no lo estaba ya) — `ensureText` cachea, así que una página
    // que ya se vio no vuelve a pedirlo al motor. `page.runs` se muta EN
    // SITIO (mismo objeto que `this.session.model.pages[i]`), así que
    // `page` sigue viendo los runs recién cargados más abajo.
    this.session.ensureText(i);
    const wrapper = this.wrappers[i]!;
    if (this.textoSel.pageIndex === i) this.textoSel.limpiar();
    if (this.marcadoSel?.pageIndex === i) { this.marcadoSel = null; this.cb.onMarcadoSelect?.(null); }
    wrapper.textContent = '';
    contarRenderPage();
    const { width, height, data } = this.session.engine.renderPage(this.session.doc, i, this.scale);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    canvas.style.display = 'block';
    // A-06 (WCAG 1.1.1): el bitmap del motor es una imagen con nombre de página.
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', `Página ${i + 1}`);
    const img = new ImageData(width, height);
    img.data.set(data);
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    wrapper.appendChild(canvas);
    const layer = document.createElement('div');
    layer.className = 'text-layer';
    layer.setAttribute('role', 'group');
    layer.setAttribute('aria-label', `Texto de la página ${i + 1}`);
    Object.assign(layer.style, { position: 'absolute', inset: '0' });
    wrapper.appendChild(layer);
    const geom = this.geoms[i]!;
    new TextLayer(layer, page, geom, {
      onEdit: this.cb.onEdit,
      onSelect: (pageIndex, runId) => { this.textoSel.limpiar(); this.cb.onSelect(pageIndex, runId); },
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
    this.drawImages(i);

    // Capa de captura de herramienta (encima de todo; solo activa en pluma/rectángulo/borrador).
    const toolLayer = document.createElement('div');
    toolLayer.className = 'tool-layer';
    const activo = this.tool === 'pen' || this.tool === 'rect' || this.tool === 'eraser';
    Object.assign(toolLayer.style, {
      position: 'absolute', inset: '0',
      pointerEvents: activo ? 'auto' : 'none',
      cursor: this.tool === 'eraser' ? 'cell' : 'crosshair'
    });
    this.attachToolCapture(toolLayer, i);
    wrapper.appendChild(toolLayer);
  }
}
