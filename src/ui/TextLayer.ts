import type { PageModel } from '../model/types';
import type { PageGeometry } from '../coords/PageGeometry';
import { cssFontFor } from './cssFontFor';
import { measureFontAscent } from './measureFontAscent';
import { registrarGesto } from './gesto';
import { agruparLineasEditables, type LineaEditable } from '../texto/lineasEditables';

/** `runId` es el del PRIMER objeto de la línea (el que da su tipografía); `linea` trae todos (N1). */
export interface EditRequest { pageIndex: number; runId: number; newText: string; oldText: string; el: HTMLElement; linea: LineaEditable }
export interface TextLayerCallbacks {
  onEdit: (req: EditRequest) => void;
  /** `runId`: el primer objeto de la línea. */
  onSelect: (pageIndex: number, runId: number) => void;
  /** `runIds`: TODOS los objetos de la línea (una línea compuesta se mueve entera). */
  onMove: (pageIndex: number, runId: number, dxCss: number, dyCss: number, runIds: readonly number[]) => void;
  /** true si hay una herramienta de colocación activa (nota, insertar…): un clic sobre la línea coloca, no edita (N7). */
  colocando?: () => boolean;
}

/**
 * Capa de bloques de texto editables sobre una página. Cada LÍNEA EDITABLE (N1,
 * `agruparLineasEditables`) es un div posicionado por PageGeometry: en un PDF de Chrome una línea
 * son decenas de objetos de un glifo y la capa pinta UNA `.run` por línea, con la caja de la línea
 * entera, el tamaño efectivo (E-080) y la línea base del primer objeto (E-030). Una línea de un solo
 * objeto se comporta exactamente como antes (su texto, su caja y su comando). Clic selecciona/edita; un tirador permite
 * arrastrarlo. El texto se pone con textContent, nunca innerHTML.
 *
 * E-029 — En reposo el `<div class="run">` es INVISIBLE (texto transparente,
 * sin fondo, tirador oculto): el motor (PDFium) ya pintó esa misma línea con
 * su fuente real en el `<canvas>` de debajo; esta capa solo aporta el hitbox
 * para seleccionar/editar/arrastrar — pintar el texto otra vez encima
 * duplicaba la línea en negro sans-serif. Los estados (reposo/hover/
 * seleccionada/edición) son CSS puro por clase (`.run`, `.selected`,
 * `.editing`, ver `index.next.html`); solo entrando en edición se fija en
 * línea la mejor aproximación tipográfica del run real (`cssFontFor` +
 * `run.color`), porque eso es dato del documento, no estado de UI — igual
 * que la geometría (left/top/tamaño), que siempre fue inline.
 *
 * E-030 — En reposo el bloque se posiciona con `run.boxPt` (la caja ajustada
 * a los glifos), pero esa caja casi nunca coincide con la línea base real:
 * al entrar en edición, el bloque se REPOSICIONA para que su línea base
 * coincida con `run.originPt` (el origen real de la línea de texto, en
 * puntos PDF) convertido a px CSS, con `line-height` calculado a partir del
 * ascenso/descenso medidos de la fuente (`measureFontAscent`) — no del alto
 * de `boxPt` ni de un `line-height` igual al tamaño de fuente, que arrastra
 * un "half-leading" desconocido y desalinea la base ~1-3 px (más que la
 * tolerancia de ±1.5 px exigida). Como el bloque se mueve, un elemento
 * `.run-mask` APARTE — posicionado siempre con la caja ORIGINAL `run.boxPt`,
 * nunca reposicionado — es quien garantiza que el texto original quede tapado
 * (E-002): el bloque puede moverse o cambiar de alto sin destapar nada.
 */
export class TextLayer {
  constructor(
    private readonly host: HTMLElement,
    private readonly page: PageModel,
    geomVisual: PageGeometry,
    private readonly cb: TextLayerCallbacks
  ) {
    // E-063: la capa se dibuja en el espacio de la página SIN girar (`geom`: px CSS de usuario, rotación 0)
    // y UNA transformación CSS sobre el contenedor (`geomVisual.transformCapaSinGirar`) la lleva al espacio
    // visual, igual que la rotación del canvas. Así cada `.run` conserva su dirección de texto, su alto de
    // línea y su editor sin cálculos por run; solo lo que mide en pantalla (arrastre) pasa por la geometría.
    this.geomVisual = geomVisual;
    this.geom = geomVisual.sinGirar();
    const { width, height } = geomVisual.tamanoCapaSinGirarCss();
    Object.assign(host.style, {
      position: 'absolute', inset: 'auto', left: '0px', top: '0px',
      width: `${width}px`, height: `${height}px`,
      transformOrigin: '0 0', transform: geomVisual.transformCapaSinGirar() ?? ''
    });
    this.build();
  }

  /**
   * A-03 (WCAG 2.1.1) — "roving tabindex": una página puede tener cientos de
   * runs, así que SOLO uno (`tabindex=0`) es tabstop de la capa; el resto van
   * a -1 y se recorren con ↑/↓ (o Inicio/Fin). Enter edita, Escape sale.
   * El foco NO pinta nada en reposo salvo el anillo de `:focus-visible` (E-029).
   */
  private readonly bloques: HTMLElement[] = [];
  /** Geometría visual de la página (con /Rotate): para convertir lo que se mide en pantalla (arrastres). */
  private readonly geomVisual: PageGeometry;
  /** Geometría de la página sin girar: la de las coordenadas de cada `.run` dentro de la capa. */
  private readonly geom: PageGeometry;

  private moverTabstop(destino: HTMLElement | undefined): void {
    if (!destino) return;
    for (const b of this.bloques) b.tabIndex = b === destino ? 0 : -1;
    destino.focus();
  }

  private build(): void {
    const porId = new Map(this.page.runs.map((r) => [r.runId, r]));
    for (const linea of agruparLineasEditables(this.page.runs, this.page.index)) {
      // El primer objeto de la línea da la tipografía, el color y el origen de la línea base (E-030).
      const run = porId.get(linea.runIds[0]!)!;
      const compuesta = linea.runIds.length > 1;
      // Una línea de un objeto conserva su texto y su caja de siempre; una compuesta, el texto y la unión de cajas.
      const texto = compuesta ? linea.text : run.text;
      const cajaPt = compuesta ? linea.boxPt : run.boxPt;
      // Rect de reposo: SIEMPRE la caja original de los glifos de la línea (unión de las cajas originales).
      // Es la geometría a la que el bloque vuelve al salir de edición y la
      // que usa la máscara — nunca se recalcula desde el DOM (E-002).
      const r = this.geom.rectPtToCss(cajaPt);
      // Dirección del texto en el espacio de usuario (múltiplos de 90, E-063): con 90/270 el texto es
      // vertical en la capa sin girar, así que su LARGO es el alto de la caja y no el ancho.
      const anguloDeg = ((linea.anguloDeg ?? 0) % 360 + 360) % 360;
      const anguloCss = anguloDeg % 90 === 0 ? anguloDeg : 0; // otros ángulos: se tratan como horizontal
      const largoCss = anguloCss % 180 !== 0 ? r.height : r.width; // px CSS de la capa

      // Máscara aparte, fija en `r` para siempre: aunque el bloque se mueva
      // al entrar en edición (E-030), esto sigue tapando el texto original.
      const mask = document.createElement('div');
      mask.className = 'run-mask';
      Object.assign(mask.style, {
        position: 'absolute',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`
      });
      this.host.appendChild(mask);

      const block = document.createElement('div');
      block.className = 'run';
      block.dataset.runId = String(run.runId);
      block.dataset.lineaId = linea.lineaId;
      block.textContent = texto;
      block.setAttribute('role', 'textbox');
      block.setAttribute('aria-readonly', 'true');
      block.setAttribute('aria-label', `Línea de texto ${this.bloques.length + 1}`);
      block.tabIndex = this.bloques.length === 0 ? 0 : -1;
      this.bloques.push(block);
      block.addEventListener('focus', () => { for (const b of this.bloques) b.tabIndex = b === block ? 0 : -1; });
      // Solo geometría inline (E-029): el resto de la apariencia en reposo
      // (texto transparente, sin fondo) sale de la clase `.run` en CSS.
      Object.assign(block.style, {
        position: 'absolute',
        left: `${r.left}px`,
        top: `${r.top}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        lineHeight: `${r.height}px`
      });

      // Mejor aproximación tipográfica del run real, calculada una vez y
      // aplicada en línea SOLO mientras se edita (ver comentario de clase).
      // El tamaño sale de sizeEfectivoPt del PDF × la escala de la geometría, nunca
      // del alto de la caja (E-002).
      const sizeCss = run.sizeEfectivoPt * this.geom.scale; // E-080: efectivo (Tf × escala de la matriz), no el Tf nominal
      const editFont = cssFontFor(run.fontName, sizeCss);
      const editColor = `rgb(${run.color[0]}, ${run.color[1]}, ${run.color[2]})`;

      let oldText = texto;
      let editadoConTeclado = false;
      const empezarEdicion = (): void => {
        for (const el of Array.from(this.host.querySelectorAll<HTMLElement>('.run'))) el.classList.remove('selected');
        block.classList.add('selected');
        this.cb.onSelect(this.page.index, run.runId);
        if (block.isContentEditable) return;
        oldText = block.textContent ?? '';
        block.style.font = editFont;
        block.style.color = editColor;

        // E-030: reposiciona para que la línea base caiga exactamente en
        // `run.originPt` (px CSS de página, vía PageGeometry), no en el
        // borde superior de `boxPt`. `line-height` = ascenso + descenso
        // MEDIDOS de la fuente (no `sizeCss`): así el half-leading que el
        // navegador reparte arriba/abajo de la caja de línea es 0 y
        // `top = líneaBase - ascenso` cae justo en el borde superior real.
        const { ascentCss, descentCss } = measureFontAscent(editFont);
        const origin = this.geom.ptToCss(run.originPt.xPt, run.originPt.yPt);
        const baselineCss = origin.y;
        const lineHeightCss = ascentCss + descentCss;
        block.dataset.baselineCss = String(baselineCss);
        // El texto girado en el espacio de usuario (no es /Rotate de página) se edita girado sobre su origen.
        Object.assign(block.style, {
          left: `${origin.x}px`,
          top: `${baselineCss - ascentCss}px`,
          width: '',
          minWidth: `${largoCss}px`,
          height: `${lineHeightCss}px`,
          lineHeight: `${lineHeightCss}px`,
          transformOrigin: `0px ${ascentCss}px`,
          transform: anguloCss === 0 ? '' : `rotate(${-anguloCss}deg)`
        });

        mask.classList.add('active');
        block.classList.add('editing');
        block.contentEditable = 'true';
        block.setAttribute('aria-readonly', 'false');
        block.focus();
        // E-064: `focus()` solo coloca el cursor dentro si NO había ya una selección en el documento; tras la
        // primera edición quedaba una selección colapsada en otro nodo y la segunda línea recibía el foco sin
        // cursor (Ctrl+A seleccionaba la página y lo tecleado no llegaba). Se fija el cursor al inicio.
        const sel = window.getSelection();
        if (sel) {
          const rango = document.createRange();
          rango.selectNodeContents(block);
          rango.collapse(true);
          sel.removeAllRanges();
          sel.addRange(rango);
        }
      };
      block.addEventListener('click', (e) => {
        // N7: con una herramienta de colocación activa el clic sube al fondo de la página (que coloca) y no edita.
        if (!block.isContentEditable && this.cb.colocando?.()) return;
        e.stopPropagation();
        editadoConTeclado = false;
        empezarEdicion();
      });
      const commit = (): void => {
        if (!block.isContentEditable) return;
        block.contentEditable = 'false';
        block.setAttribute('aria-readonly', 'true');
        block.classList.remove('editing');
        mask.classList.remove('active');
        block.style.font = '';
        block.style.color = '';
        delete block.dataset.baselineCss;
        // Restaura EXACTAMENTE la geometría de reposo (prueba de oro de
        // píxeles de fidelidad-reposo.spec.ts, también tras editar y cancelar).
        Object.assign(block.style, {
          left: `${r.left}px`,
          top: `${r.top}px`,
          width: `${r.width}px`,
          minWidth: '',
          height: `${r.height}px`,
          lineHeight: `${r.height}px`,
          transformOrigin: '',
          transform: ''
        });
        const newText = block.textContent ?? '';
        if (newText !== oldText) {
          this.cb.onEdit({ pageIndex: this.page.index, runId: run.runId, newText, oldText, el: block, linea });
        }
      };
      block.addEventListener('blur', commit);
      // Devuelve el foco al run tras editar SOLO si la edición empezó con
      // teclado (A-03): con ratón no se pinta anillo de foco tras Enter/Escape
      // (prueba de oro de reposo, E-029).
      const salirDeEdicion = (): void => {
        block.blur();
        if (editadoConTeclado) { editadoConTeclado = false; if (block.isConnected) block.focus(); }
      };
      block.addEventListener('keydown', (e) => {
        if (block.isContentEditable) {
          if (e.key === 'Enter') { e.preventDefault(); salirDeEdicion(); }
          if (e.key === 'Escape') { block.textContent = oldText; salirDeEdicion(); }
          return;
        }
        // Reposo: navegación entre runs y activación con teclado (A-03). Con Mayús/Alt/Ctrl/Cmd las flechas
        // NO mueven el foco: son la selección de texto (Mayús) y el recorrido de anotaciones (Alt) de T16.
        if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return;
        const i = this.bloques.indexOf(block);
        if (e.key === 'ArrowDown') { e.preventDefault(); this.moverTabstop(this.bloques[i + 1]); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.moverTabstop(this.bloques[i - 1]); }
        else if (e.key === 'Home') { e.preventDefault(); this.moverTabstop(this.bloques[0]); }
        else if (e.key === 'End') { e.preventDefault(); this.moverTabstop(this.bloques[this.bloques.length - 1]); }
        else if (e.key === 'Enter') { e.preventDefault(); editadoConTeclado = true; empezarEdicion(); }
      });

      block.appendChild(this.makeDragHandle(block, run.runId, linea.runIds));
      this.host.appendChild(block);
    }
  }

  /**
   * Tirador para arrastrar el bloque; dispara onMove al soltar. Cancelado
   * (pointercancel — E-034, ver `registrarGesto`): restaura la posición de
   * reposo del bloque en el propio DOM y no dispara `onMove` — nada que
   * deshacer en el motor porque `onMove` es lo único que llega a ejecutar
   * un comando.
   */
  private makeDragHandle(block: HTMLElement, runId: number, runIds: readonly number[]): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'run-drag';
    // Posición/tamaño (geometría) inline; color, opacidad y visibilidad por
    // estado (reposo/hover/seleccionada) salen de la clase en CSS (E-029).
    // El tirador sobresale 9 px por la esquina superior izquierda de la línea; en una línea pegada al
    // borde de la página (E-066) se recoloca hacia dentro: su desplazamiento (px CSS de la capa sin
    // girar, origen en la caja del bloque) nunca lo deja a la izquierda/arriba del borde de la página.
    const sobresale = 9;
    const bloqueX = parseFloat(block.style.left) || 0, bloqueY = parseFloat(block.style.top) || 0;
    Object.assign(handle.style, {
      position: 'absolute', width: '14px', height: '14px', touchAction: 'none', // N2: el dedo arrastra el tirador, no hace scroll
      left: `${-Math.min(sobresale, Math.max(0, bloqueX))}px`,
      top: `${-Math.min(sobresale, Math.max(0, bloqueY))}px`
    });
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      const baseLeft = parseFloat(block.style.left) || 0;
      const baseTop = parseFloat(block.style.top) || 0;
      registrarGesto({
        onMove: (ev) => {
          // El ratón mide en px CSS visuales; el bloque vive en la capa sin girar (E-063).
          const d = this.geomVisual.deltaVisualACapaSinGirar(ev.clientX - startX, ev.clientY - startY);
          block.style.left = `${baseLeft + d.dx}px`;
          block.style.top = `${baseTop + d.dy}px`;
        },
        onUp: (ev) => {
          const dx = ev.clientX - startX, dy = ev.clientY - startY;
          if (dx !== 0 || dy !== 0) this.cb.onMove(this.page.index, runId, dx, dy, runIds);
        },
        onCancel: () => {
          block.style.left = `${baseLeft}px`;
          block.style.top = `${baseTop}px`;
        }
      });
    });
    return handle;
  }
}
