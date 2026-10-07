import { PageGeometry } from '../coords/PageGeometry';
import type { QuadPt } from '../coords/quads';
import type { CharBox, RectPt, SizePt } from '../engine/PdfEngine';
import {
  caretInicioDe, caretLinea, caretSiguiente, caretsARango, indiceCaracterMasCercano, quadsDeRango, rangoACarets, textoDeRango
} from '../texto/seleccionTexto';
import { registrarGesto } from './gesto';

/** Lo que `SeleccionTexto` necesita del visor, sin conocer al visor. */
export interface DepsSeleccionTexto {
  /** Contenedor `.page` de la página `i` (si está en el DOM). */
  wrapper(i: number): HTMLElement | undefined;
  /** Geometría de la página `i` con la escala real del visor (px CSS). */
  geom(i: number): PageGeometry;
  /** Tamaño VISUAL (pt, ya girado) y rotación de la página `i`. */
  pagina(i: number): { sizePt: SizePt; rotation: 0 | 90 | 180 | 270; origenPt: { xPt: number; yPt: number } };
  /** Caracteres con caja de la página `i` (perezosos y cacheados por `EditSession`): vale también si la página no está pintada (E-100). */
  chars(i: number): CharBox[];
  /** Nº de páginas del documento. */
  numPaginas(): number;
  /** Contenedor con scroll del visor: el autoscroll del arrastre (E-100) lo desplaza cerca de su borde. */
  scroller(): HTMLElement;
  /** Solo se selecciona con la herramienta "ninguna" (V). */
  activa(): boolean;
  /** Se llama al empezar a arrastrar, antes de pintar nada (p. ej. para quitar la selección de una línea). */
  alEmpezar(): void;
}

/** Distancia (px CSS) a partir de la cual un pulsado pasa de "clic" a "arrastre de selección". */
const UMBRAL_ARRASTRE_PX = 4;

/** Distancia (px CSS) al borde del visor a partir de la cual el arrastre desplaza solo, y velocidad máxima (px por tick). */
const BORDE_AUTOSCROLL_PX = 36;
const VELOCIDAD_AUTOSCROLL_PX = 24;
const TICK_AUTOSCROLL_MS = 16;

/**
 * Selección de texto: desde el carácter `ancla` de la página `paginaAncla` hasta el carácter `foco` de la
 * `paginaFoco` (índices de carácter inclusivos; el foco puede quedar antes que el ancla). Una selección de una
 * sola página es el caso `paginaAncla === paginaFoco` (E-100: ya no está limitada a una página).
 */
interface Seleccion { paginaAncla: number; ancla: number; paginaFoco: number; foco: number }

/** Tramo de una página dentro de la selección: caracteres `desde`..`hasta` (inclusive, ya en orden). */
export interface TramoSeleccion { pageIndex: number; desde: number; hasta: number }

/**
 * Selección de texto por arrastre del ratón, como Acrobat (T12).
 *
 * El gesto pasa por `registrarGesto` (E-034). Solo arranca con un pulsado
 * primario sobre una línea (`.run`) con la herramienta "ninguna"; el tirador de
 * mover (`.run-drag`), una línea en edición y cualquier otro control quedan
 * fuera. Un clic corto SIN arrastre no hace nada aquí: el `click` de la línea
 * sigue entrando a editar. Si hubo arrastre, el `click` posterior se traga
 * (si no, entraría a editar la línea donde se soltó o insertaría texto).
 *
 * Unidades: el puntero se convierte a PUNTOS PDF con `geom.cssToPt` y se busca
 * el carácter más cercano (`indiceCaracterMasCercano`). La selección SOLO pinta
 * mientras existe: en reposo no hay ningún nodo en el DOM (E-029). Se dibuja un
 * `.sel-rect` por línea visual, a partir de los mismos quads que se guardan.
 */
export class SeleccionTexto {
  private sel: Seleccion | null = null;

  constructor(private readonly deps: DepsSeleccionTexto) {}

  /** Pulsado sobre la página `pageIndex`: arma el gesto si procede y, si no, descarta la selección vigente. */
  alPulsar(pageIndex: number, e: PointerEvent): void {
    this.limpiar();
    const t = e.target as HTMLElement | null;
    if (!this.deps.activa() || e.button !== 0 || !t) return;
    if (!t.closest('.run') || t.closest('.run-drag') || t.closest('.run.editing')) return;
    const wrapper = this.deps.wrapper(pageIndex);
    if (!wrapper) return;
    const chars = this.deps.chars(pageIndex);
    if (chars.length === 0) return;

    const geom0 = this.deps.geom(pageIndex);
    const r0 = wrapper.getBoundingClientRect(); // px CSS de página = clientX - r.left
    const inicio = geom0.cssToPt(e.clientX - r0.left, e.clientY - r0.top);
    const ancla = indiceCaracterMasCercano(chars, inicio.xPt, inicio.yPt);
    if (ancla < 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let arrastrando = false;
    let ultimo = { x: e.clientX, y: e.clientY };
    let temporizador: ReturnType<typeof setInterval> | null = null;
    const pararAutoscroll = (): void => { if (temporizador !== null) { clearInterval(temporizador); temporizador = null; } };

    /** Actualiza el foco con el puntero en (clientX, clientY): la página destino es la que está bajo él (o la más cercana). */
    const actualizarFoco = (clientX: number, clientY: number): void => {
      const destino = this.paginaBajo(clientY);
      const w = destino === null ? undefined : this.deps.wrapper(destino);
      if (destino === null || !w) return;
      const cs = this.deps.chars(destino);
      const rect = w.getBoundingClientRect();
      const p = this.deps.geom(destino).cssToPt(clientX - rect.left, clientY - rect.top);
      const foco = indiceCaracterMasCercano(cs, p.xPt, p.yPt);
      if (foco < 0) return;
      const previa = this.sel;
      this.sel = { paginaAncla: pageIndex, ancla, paginaFoco: destino, foco };
      this.repintarTodo(previa);
    };
    /** Autoscroll (E-100): el puntero quieto cerca del borde del visor sigue desplazando; tras cada paso se recalcula el foco. */
    const autoscroll = (): void => {
      const sc = this.deps.scroller();
      const r = sc.getBoundingClientRect();
      const dentroArriba = r.top + BORDE_AUTOSCROLL_PX - ultimo.y, dentroAbajo = ultimo.y - (r.bottom - BORDE_AUTOSCROLL_PX);
      const dy = dentroArriba > 0 ? -Math.min(1, dentroArriba / BORDE_AUTOSCROLL_PX) : dentroAbajo > 0 ? Math.min(1, dentroAbajo / BORDE_AUTOSCROLL_PX) : 0;
      if (dy === 0) return;
      const antes = sc.scrollTop;
      sc.scrollTop += dy * VELOCIDAD_AUTOSCROLL_PX;
      if (sc.scrollTop !== antes) actualizarFoco(ultimo.x, ultimo.y);
    };

    registrarGesto({
      onMove: (ev) => {
        ultimo = { x: ev.clientX, y: ev.clientY };
        if (!arrastrando) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < UMBRAL_ARRASTRE_PX) return;
          arrastrando = true;
          this.deps.alEmpezar();
          temporizador = setInterval(autoscroll, TICK_AUTOSCROLL_MS);
        }
        actualizarFoco(ev.clientX, ev.clientY);
      },
      onUp: () => { if (arrastrando) tragarSiguienteClic(); },
      onCancel: () => { if (arrastrando) this.limpiar(); },
      onSettle: pararAutoscroll
    });
  }

  /**
   * Índice de la página bajo la altura `clientY` (px de ventana), o la más cercana si cae en el hueco entre
   * páginas o fuera de la primera/última. Los contenedores están en orden vertical: búsqueda binaria.
   */
  private paginaBajo(clientY: number): number | null {
    let lo = 0, hi = this.deps.numPaginas() - 1;
    if (hi < 0) return null;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const w = this.deps.wrapper(mid);
      if (!w) return null;
      if (w.getBoundingClientRect().bottom < clientY) lo = mid + 1; else hi = mid;
    }
    // `lo` es la primera página cuyo borde inferior no queda por encima del puntero; si el puntero está en el
    // hueco antes de ella, elige la más cercana de las dos.
    const w = this.deps.wrapper(lo);
    if (!w) return null;
    if (lo > 0 && clientY < w.getBoundingClientRect().top) {
      const previa = this.deps.wrapper(lo - 1);
      if (previa && clientY - previa.getBoundingClientRect().bottom < w.getBoundingClientRect().top - clientY) return lo - 1;
    }
    return lo;
  }

  /**
   * Selección por TECLADO (T16): Mayús+→/← (`caracter`) o Mayús+↓/↑ (`linea`) desde la línea enfocada,
   * cuya caja es `cajaLinea` (pt de usuario). Sin selección en esa página, el ancla es el inicio de la
   * línea (hacia delante) o su final (hacia atrás); con selección vigente se mueve solo el FOCO y el ancla
   * se conserva, también si la selección venía del ratón. Si el foco vuelve al ancla la selección queda
   * vacía y se descarta. Devuelve false si no hay nada que seleccionar (línea sin caracteres con caja).
   * Solo extiende selecciones de UNA página: una selección multipágina del ratón se sustituye por una nueva.
   */
  extender(pageIndex: number, cajaLinea: RectPt, mov: 'caracter' | 'linea', dir: 1 | -1): boolean {
    const chars = this.deps.chars(pageIndex);
    let car: { ancla: number; foco: number };
    const s = this.sel;
    if (s && s.paginaAncla === pageIndex && s.paginaFoco === pageIndex) {
      car = rangoACarets(s);
    } else {
      const c0 = caretInicioDe(chars, cajaLinea, dir > 0 ? 'inicio' : 'final');
      if (c0 < 0) return false;
      this.limpiar();
      this.deps.alEmpezar();
      car = { ancla: c0, foco: c0 };
    }
    const foco = mov === 'caracter' ? caretSiguiente(chars, car.foco, dir) : caretLinea(chars, car.foco, dir, this.geoUnidad(pageIndex));
    const r = caretsARango(car.ancla, foco);
    if (!r) { this.limpiar(); return true; }
    const previa = this.sel;
    this.sel = { paginaAncla: pageIndex, ancla: r.ancla, paginaFoco: pageIndex, foco: r.foco };
    this.repintarTodo(previa);
    return true;
  }

  /** ¿Hay una selección con algún carácter? */
  get activa(): boolean { return this.sel !== null; }

  /** Primera página de la selección (en orden de lectura), o `null` si no hay. */
  get pageIndex(): number | null { return this.sel ? Math.min(this.sel.paginaAncla, this.sel.paginaFoco) : null; }

  /** ¿Pertenece la página `i` a la selección vigente (extremos o intermedia)? */
  incluye(i: number): boolean {
    return this.sel !== null && i >= Math.min(this.sel.paginaAncla, this.sel.paginaFoco) && i <= Math.max(this.sel.paginaAncla, this.sel.paginaFoco);
  }

  /** ¿Es `i` la primera o la última página de la selección? Esas dos no se desalojan; las intermedias sí (se repintan al volver). */
  esExtremo(i: number): boolean { return this.sel !== null && (i === this.sel.paginaAncla || i === this.sel.paginaFoco); }

  /**
   * Tramos por página en orden de lectura: el resto de la primera página desde el punto inicial, las
   * intermedias enteras y el principio de la última hasta el punto final (E-100). Una página sin
   * caracteres con caja se omite. Pide los caracteres al modelo (`deps.chars`), no al DOM: las páginas
   * intermedias pueden no estar pintadas.
   */
  tramos(): TramoSeleccion[] {
    const s = this.sel;
    if (!s) return [];
    if (s.paginaAncla === s.paginaFoco) return [{ pageIndex: s.paginaAncla, desde: Math.min(s.ancla, s.foco), hasta: Math.max(s.ancla, s.foco) }];
    const directo = s.paginaAncla < s.paginaFoco;
    const [pIni, cIni, pFin, cFin] = directo ? [s.paginaAncla, s.ancla, s.paginaFoco, s.foco] : [s.paginaFoco, s.foco, s.paginaAncla, s.ancla];
    const out: TramoSeleccion[] = [];
    for (let p = pIni; p <= pFin; p++) {
      const n = this.deps.chars(p).length;
      if (n === 0) continue;
      out.push({ pageIndex: p, desde: p === pIni ? cIni : 0, hasta: p === pFin ? cFin : n - 1 });
    }
    return out;
  }

  /** Texto seleccionado (saltos de línea como \n; las páginas se unen con un salto de línea), o '' si no hay selección. */
  texto(): string {
    return this.tramos().map((t) => textoDeRango(this.deps.chars(t.pageIndex), t.desde, t.hasta)).join('\n');
  }

  /** Quads (pt PDF de usuario) de la selección, uno por línea visual, agrupados por página; [] si no hay selección. */
  quadsPorPagina(): { pageIndex: number; quads: QuadPt[] }[] {
    return this.tramos()
      .map((t) => ({ pageIndex: t.pageIndex, quads: quadsDeRango(this.deps.chars(t.pageIndex), t.desde, t.hasta, this.geoUnidad(t.pageIndex)) }))
      .filter((p) => p.quads.length > 0);
  }

  /** Quita la selección y su capa del DOM (de todas las páginas que abarcaba). */
  limpiar(): void {
    const s = this.sel;
    this.sel = null;
    if (s) this.quitarCapas(s, () => true);
  }

  /**
   * Una página del rango se acaba de pintar de nuevo (su DOM se vació): una selección de una página o con esa
   * página como extremo se descarta (los índices pueden ya no valer, E-057); una página INTERMEDIA solo recupera
   * su capa, porque el desalojo la quitó y su texto no ha cambiado.
   */
  alRepintarPagina(i: number): void {
    if (!this.incluye(i)) return;
    if (this.esExtremo(i)) this.limpiar(); else this.pintarPagina(i);
  }

  private quitarCapas(s: Seleccion, cuales: (p: number) => boolean): void {
    for (let p = Math.min(s.paginaAncla, s.paginaFoco); p <= Math.max(s.paginaAncla, s.paginaFoco); p++) {
      if (cuales(p)) this.deps.wrapper(p)?.querySelector('.seleccion-texto')?.remove();
    }
  }

  /** Geometría a escala 1 (px CSS = pt visuales) que pide `quadsPorLinea`. */
  private geoUnidad(pageIndex: number): PageGeometry {
    const p = this.deps.pagina(pageIndex);
    return PageGeometry.desdePagina(p, 1);
  }

  /** Repinta la selección entera; quita antes las capas de las páginas de la selección anterior que ya no pertenecen a ella. */
  private repintarTodo(previa: Seleccion | null): void {
    if (previa) this.quitarCapas(previa, (p) => !this.incluye(p));
    for (const t of this.tramos()) this.pintarTramo(t);
  }

  private pintarPagina(i: number): void {
    const t = this.tramos().find((x) => x.pageIndex === i);
    if (t) this.pintarTramo(t);
  }

  /** Redibuja un rectángulo translúcido por línea visual del tramo (px CSS de página, vía la geometría real). */
  private pintarTramo(t: TramoSeleccion): void {
    const wrapper = this.deps.wrapper(t.pageIndex);
    if (!wrapper) return;
    let capa = wrapper.querySelector<HTMLElement>('.seleccion-texto');
    if (!capa) {
      capa = document.createElement('div');
      capa.className = 'seleccion-texto';
      capa.setAttribute('aria-hidden', 'true');
      Object.assign(capa.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
      wrapper.appendChild(capa);
    }
    capa.textContent = '';
    const geom = this.deps.geom(t.pageIndex);
    for (const q of quadsDeRango(this.deps.chars(t.pageIndex), t.desde, t.hasta, this.geoUnidad(t.pageIndex))) {
      const pts = [0, 2, 4, 6].map((k) => geom.ptToCss(q[k]!, q[k + 1]!));
      const left = Math.min(...pts.map((p) => p.x)), right = Math.max(...pts.map((p) => p.x));
      const top = Math.min(...pts.map((p) => p.y)), bottom = Math.max(...pts.map((p) => p.y));
      const r = document.createElement('div');
      r.className = 'sel-rect';
      Object.assign(r.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
      capa.appendChild(r);
    }
  }
}

/**
 * Tras un arrastre el navegador dispara un `click` (en la línea donde se soltó o
 * en un ancestro común): se traga en captura para que no abra la edición ni inserte
 * texto. Se retira solo si ese click no llega a producirse.
 */
function tragarSiguienteClic(): void {
  const parar = (ev: Event): void => { ev.stopPropagation(); ev.preventDefault(); quitar(); };
  const quitar = (): void => { window.removeEventListener('click', parar, true); clearTimeout(t); };
  const t = setTimeout(quitar, 100);
  window.addEventListener('click', parar, true);
}
