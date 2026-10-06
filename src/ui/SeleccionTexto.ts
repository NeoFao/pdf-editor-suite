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
  /** Caracteres con caja de la página `i` (perezosos y cacheados por `EditSession`). */
  chars(i: number): CharBox[];
  /** Solo se selecciona con la herramienta "ninguna" (V). */
  activa(): boolean;
  /** Se llama al empezar a arrastrar, antes de pintar nada (p. ej. para quitar la selección de una línea). */
  alEmpezar(): void;
}

/** Distancia (px CSS) a partir de la cual un pulsado pasa de "clic" a "arrastre de selección". */
const UMBRAL_ARRASTRE_PX = 4;

/** Selección de texto de UNA página: caracteres `ancla`..`foco` (inclusive, en cualquier orden). */
interface Seleccion { pageIndex: number; ancla: number; foco: number }

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

    const geom = this.deps.geom(pageIndex);
    const aPt = (ev: PointerEvent) => {
      const r = wrapper.getBoundingClientRect(); // px CSS de página = clientX - r.left
      return geom.cssToPt(ev.clientX - r.left, ev.clientY - r.top);
    };
    const inicio = aPt(e);
    const ancla = indiceCaracterMasCercano(chars, inicio.xPt, inicio.yPt);
    if (ancla < 0) return;
    const x0 = e.clientX, y0 = e.clientY;
    let arrastrando = false;

    registrarGesto({
      onMove: (ev) => {
        if (!arrastrando) {
          if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < UMBRAL_ARRASTRE_PX) return;
          arrastrando = true;
          this.deps.alEmpezar();
        }
        const p = aPt(ev);
        const foco = indiceCaracterMasCercano(chars, p.xPt, p.yPt);
        if (foco < 0) return;
        this.sel = { pageIndex, ancla, foco };
        this.pintar();
      },
      onUp: () => { if (arrastrando) tragarSiguienteClic(); },
      onCancel: () => { if (arrastrando) this.limpiar(); }
    });
  }

  /**
   * Selección por TECLADO (T16): Mayús+→/← (`caracter`) o Mayús+↓/↑ (`linea`) desde la línea enfocada,
   * cuya caja es `cajaLinea` (pt de usuario). Sin selección en esa página, el ancla es el inicio de la
   * línea (hacia delante) o su final (hacia atrás); con selección vigente se mueve solo el FOCO y el ancla
   * se conserva, también si la selección venía del ratón. Si el foco vuelve al ancla la selección queda
   * vacía y se descarta. Devuelve false si no hay nada que seleccionar (línea sin caracteres con caja).
   */
  extender(pageIndex: number, cajaLinea: RectPt, mov: 'caracter' | 'linea', dir: 1 | -1): boolean {
    const chars = this.deps.chars(pageIndex);
    let car: { ancla: number; foco: number };
    if (this.sel && this.sel.pageIndex === pageIndex) {
      car = rangoACarets(this.sel);
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
    this.sel = { pageIndex, ...r };
    this.pintar();
    return true;
  }

  /** ¿Hay una selección con algún carácter? */
  get activa(): boolean { return this.sel !== null; }

  get pageIndex(): number | null { return this.sel?.pageIndex ?? null; }

  /** Texto seleccionado (saltos de línea como \n), o '' si no hay selección. */
  texto(): string {
    const s = this.sel;
    return s ? textoDeRango(this.deps.chars(s.pageIndex), s.ancla, s.foco) : '';
  }

  /** Quads (pt PDF de usuario) del tramo seleccionado, uno por línea visual; [] si no hay selección. */
  quads(): QuadPt[] {
    const s = this.sel;
    return s ? quadsDeRango(this.deps.chars(s.pageIndex), s.ancla, s.foco, this.geoUnidad(s.pageIndex)) : [];
  }

  /** Quita la selección y su capa del DOM. */
  limpiar(): void {
    const s = this.sel;
    this.sel = null;
    if (s) this.deps.wrapper(s.pageIndex)?.querySelector('.seleccion-texto')?.remove();
  }

  /** Geometría a escala 1 (px CSS = pt visuales) que pide `quadsPorLinea`. */
  private geoUnidad(pageIndex: number): PageGeometry {
    const p = this.deps.pagina(pageIndex);
    return PageGeometry.desdePagina(p, 1);
  }

  /** Redibuja un rectángulo translúcido por línea visual (px CSS de página, vía la geometría real). */
  private pintar(): void {
    const s = this.sel;
    if (!s) return;
    const wrapper = this.deps.wrapper(s.pageIndex);
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
    const geom = this.deps.geom(s.pageIndex);
    for (const q of this.quads()) {
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
