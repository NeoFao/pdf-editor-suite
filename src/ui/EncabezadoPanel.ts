/**
 * Diálogo "Encabezado, pie y marca de agua" (como Organizar > Encabezado y pie /
 * Marca de agua de Acrobat). `<dialog>` modal con dos pestañas y VISTA PREVIA EN VIVO
 * sobre la página actual: una capa DOM temporal dentro de `.page` que NO toca el
 * documento hasta pulsar "Aplicar" (se retira al cerrar). Sin innerHTML: todo se
 * construye con nodos y `textContent` (AGENTS.md §2.2).
 *
 * La colocación usa las MISMAS funciones puras que el motor (`src/pagina/encabezadoPie.ts`)
 * sobre la página VISUAL (rotación 0 porque el DOM ya es el marco visual), así que la
 * vista previa y el resultado coinciden salvo por el redondeo tipográfico del navegador.
 * Unidades: la geometría va en pt; a CSS se pasa multiplicando por `escala` (px CSS por pt).
 */
import { mostrarModal } from './dialogo';
import { parseRange } from './pageRange';
import { cssFontFor } from './cssFontFor';
import { STANDARD_FONTS } from '../engine/standardFontFor';
import {
  colocarCaja, colocarMarcaCentrada, expandirMacros, hexARgb,
  type Alineacion, type CajaEncabezado, type Zona
} from '../pagina/encabezadoPie';
import type { OpcionesEncabezado, OpcionesMarcaAgua } from '../commands/EncabezadoMarcaAgua';

/** Lo que el panel necesita saber de la página actual para la vista previa. */
export interface PaginaPreview {
  /** Elemento `.page` del visor (su origen es la esquina superior izquierda VISTA). */
  el: HTMLElement;
  /** px CSS por pt. */
  escala: number;
  /** Tamaño VISUAL de la página en pt. */
  anchoPt: number;
  altoPt: number;
}

export interface OpcionesPanelEncabezado {
  totalPaginas: number;
  paginaActual: number;
  pagina: () => PaginaPreview | null;
  medir: (fuente: string, sizePt: number, texto: string) => number;
  /** Aplica una de las dos operaciones; el panel muestra el progreso que reporta. */
  onAplicar: (op: { encabezado: OpcionesEncabezado } | { marca: OpcionesMarcaAgua }, progreso: (hechas: number, total: number) => void) => Promise<void>;
  onQuitar: (progreso: (hechas: number, total: number) => void) => Promise<number>;
}

const FUENTES = STANDARD_FONTS.filter((f) => f !== 'Symbol' && f !== 'ZapfDingbats');
/** Fracción del cuerpo desde el borde superior de la caja de línea (line-height: 1) hasta la línea base, Helvetica. */
const BASE_EN_LINEA = 0.7555;

const CAJAS: { zona: Zona; alineacion: Alineacion; id: string; etiqueta: string }[] = [
  { zona: 'arriba', alineacion: 'izq', id: 'eh-arriba-izq', etiqueta: 'Arriba, izquierda' },
  { zona: 'arriba', alineacion: 'centro', id: 'eh-arriba-centro', etiqueta: 'Arriba, centro' },
  { zona: 'arriba', alineacion: 'der', id: 'eh-arriba-der', etiqueta: 'Arriba, derecha' },
  { zona: 'abajo', alineacion: 'izq', id: 'eh-abajo-izq', etiqueta: 'Abajo, izquierda' },
  { zona: 'abajo', alineacion: 'centro', id: 'eh-abajo-centro', etiqueta: 'Abajo, centro' },
  { zona: 'abajo', alineacion: 'der', id: 'eh-abajo-der', etiqueta: 'Abajo, derecha' }
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { id?: string } = {}, ...hijos: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...hijos);
  return e;
}

function campo(etiqueta: string, control: HTMLElement, id: string): HTMLElement {
  const l = el('label', { htmlFor: id }, etiqueta);
  l.className = 'eh-campo';
  const f = el('div');
  f.className = 'eh-fila';
  f.append(l, control);
  return f;
}

function numero(id: string, valor: number, min: number, max: number, paso = 1): HTMLInputElement {
  const i = el('input', { id, type: 'number', value: String(valor) });
  i.min = String(min); i.max = String(max); i.step = String(paso);
  return i;
}

function selectorFuente(id: string, valor: string): HTMLSelectElement {
  const s = el('select', { id });
  for (const f of FUENTES) s.appendChild(el('option', { value: f, selected: f === valor }, f));
  return s;
}

export class EncabezadoPanel {
  static abrir(o: OpcionesPanelEncabezado): void {
    const dialog = el('dialog', { id: 'encabezado-panel' });
    dialog.className = 'encabezado-panel';
    const titulo = el('div', { id: 'encabezado-panel-titulo' }, 'Encabezado, pie y marca de agua');
    titulo.className = 'eh-titulo';

    // ── Pestañas ──
    const tablist = el('div', { role: 'tablist' });
    tablist.className = 'eh-tabs';
    const tabEnc = el('button', { id: 'eh-tab-encabezado', type: 'button', role: 'tab' }, 'Encabezado y pie');
    const tabMarca = el('button', { id: 'eh-tab-marca', type: 'button', role: 'tab' }, 'Marca de agua');
    tablist.append(tabEnc, tabMarca);

    // ── Panel 1: encabezado y pie ──
    const cajas = new Map<string, HTMLInputElement>();
    const rejilla = el('div');
    rejilla.className = 'eh-rejilla';
    for (const c of CAJAS) {
      const input = el('input', { id: c.id, type: 'text', placeholder: c.etiqueta });
      input.setAttribute('aria-label', c.etiqueta);
      cajas.set(c.id, input);
      rejilla.appendChild(input);
    }
    const ayuda = el('div', {}, 'Macros: <<n>> número de página, <<total>> total de páginas, <<fecha>> fecha de hoy (dd/mm/aaaa).');
    ayuda.className = 'eh-ayuda';
    const ehInicio = numero('eh-inicio', 1, 0, 99999);
    const ehRango = el('input', { id: 'eh-rango', type: 'text', placeholder: 'Todas (ej.: 1-3, 5)' });
    const ehFuente = selectorFuente('eh-fuente', 'Helvetica');
    const ehSize = numero('eh-size', 10, 4, 96, 0.5);
    const ehColor = el('input', { id: 'eh-color', type: 'color', value: '#000000' });
    const ehMargenH = numero('eh-margen-h', 36, 0, 300);
    const ehMargenV = numero('eh-margen-v', 28, 0, 300);
    const panelEnc = el('div', { id: 'eh-panel-encabezado', role: 'tabpanel' });
    panelEnc.append(
      rejilla, ayuda,
      campo('Número inicial', ehInicio, 'eh-inicio'),
      campo('Páginas', ehRango, 'eh-rango'),
      campo('Fuente', ehFuente, 'eh-fuente'),
      campo('Tamaño (pt)', ehSize, 'eh-size'),
      campo('Color', ehColor, 'eh-color'),
      campo('Margen lateral (pt)', ehMargenH, 'eh-margen-h'),
      campo('Margen vertical (pt)', ehMargenV, 'eh-margen-v')
    );

    // ── Panel 2: marca de agua ──
    const maTexto = el('input', { id: 'ma-texto', type: 'text', value: 'CONFIDENCIAL' });
    const maFuente = selectorFuente('ma-fuente', 'Helvetica-Bold');
    const maSize = numero('ma-size', 72, 8, 400);
    const maColor = el('input', { id: 'ma-color', type: 'color', value: '#cc0000' });
    const maOpacidad = el('input', { id: 'ma-opacidad', type: 'range', value: '30' });
    maOpacidad.min = '0'; maOpacidad.max = '100';
    const maOpacidadValor = el('span', { id: 'ma-opacidad-valor' }, '30 %');
    const filaOpacidad = campo('Opacidad', maOpacidad, 'ma-opacidad');
    filaOpacidad.appendChild(maOpacidadValor);
    const maRotacion = numero('ma-rotacion', 45, -180, 180);
    const maCapa = el('select', { id: 'ma-capa' });
    maCapa.append(el('option', { value: 'delante' }, 'Delante del contenido'), el('option', { value: 'detras' }, 'Detrás del contenido'));
    const maRango = el('input', { id: 'ma-rango', type: 'text', placeholder: 'Todas (ej.: 1-3, 5)' });
    const panelMarca = el('div', { id: 'eh-panel-marca', role: 'tabpanel' });
    panelMarca.append(
      campo('Texto', maTexto, 'ma-texto'),
      campo('Fuente', maFuente, 'ma-fuente'),
      campo('Tamaño (pt)', maSize, 'ma-size'),
      campo('Color', maColor, 'ma-color'),
      filaOpacidad,
      campo('Rotación (°)', maRotacion, 'ma-rotacion'),
      campo('Posición', maCapa, 'ma-capa'),
      campo('Páginas', maRango, 'ma-rango')
    );
    const posicion = el('div', {}, 'Centrada en la página.');
    posicion.className = 'eh-ayuda';
    panelMarca.appendChild(posicion);

    // ── Pie del diálogo ──
    const mensaje = el('div', { id: 'eh-mensaje' });
    mensaje.className = 'eh-mensaje';
    mensaje.setAttribute('role', 'status');
    const btnQuitar = el('button', { id: 'eh-quitar', type: 'button' }, 'Quitar los añadidos por este editor');
    const btnCancelar = el('button', { id: 'eh-cancelar', type: 'button' }, 'Cancelar');
    const btnAplicar = el('button', { id: 'eh-aplicar', type: 'button' }, 'Aplicar');
    const barra = el('div');
    barra.className = 'eh-barra';
    barra.append(btnQuitar, btnCancelar, btnAplicar);

    dialog.append(titulo, tablist, panelEnc, panelMarca, mensaje, barra);

    // ── Estado ──
    let pestana: 'encabezado' | 'marca' = 'encabezado';
    let ocupado = false;
    let capaVista: HTMLElement | null = null;

    const rango = (txt: string): number[] =>
      txt.trim() === '' ? Array.from({ length: o.totalPaginas }, (_v, i) => i) : parseRange(txt, o.totalPaginas);

    const leerEncabezado = (): OpcionesEncabezado => ({
      cajas: CAJAS.map((c): CajaEncabezado => ({ zona: c.zona, alineacion: c.alineacion, texto: cajas.get(c.id)!.value })),
      numeroInicial: Math.trunc(Number(ehInicio.value) || 0),
      paginas: rango(ehRango.value),
      fuente: ehFuente.value,
      sizePt: Math.max(4, Number(ehSize.value) || 10),
      colorHex: ehColor.value,
      margenHorizPt: Math.max(0, Number(ehMargenH.value) || 0),
      margenVertPt: Math.max(0, Number(ehMargenV.value) || 0)
    });
    const leerMarca = (): OpcionesMarcaAgua => ({
      texto: maTexto.value,
      paginas: rango(maRango.value),
      fuente: maFuente.value,
      sizePt: Math.max(4, Number(maSize.value) || 72),
      colorHex: maColor.value,
      opacidad: Math.min(100, Math.max(0, Number(maOpacidad.value))) / 100,
      anguloGrados: Number(maRotacion.value) || 0,
      detras: maCapa.value === 'detras'
    });

    /** Quita la capa de vista previa del DOM de la página. */
    const quitarVista = (): void => { capaVista?.remove(); capaVista = null; };

    /** Dibuja un texto de la vista previa: origen de línea base en (xPt, yPt) VISUAL (Y arriba), giro antihorario. */
    const texto = (capa: HTMLElement, p: PaginaPreview, txt: string, fuente: string, sizePt: number, color: string, xPt: number, yPt: number, giro: number, opacidad: number, clase: string): void => {
      const s = el('span', {}, txt);
      s.className = clase;
      Object.assign(s.style, {
        position: 'absolute', left: `${xPt * p.escala}px`, top: `${(p.altoPt - yPt) * p.escala}px`,
        font: cssFontFor(fuente, sizePt * p.escala), lineHeight: '1', whiteSpace: 'pre', color, opacity: String(opacidad),
        transformOrigin: `0 ${BASE_EN_LINEA * 100}%`, transform: `translateY(-${BASE_EN_LINEA * 100}%) rotate(${-giro}deg)`
      });
      capa.appendChild(s);
    };

    const actualizarVista = (): void => {
      quitarVista();
      const p = o.pagina();
      if (!p) return;
      const capa = el('div');
      capa.className = 'eh-vista';
      Object.assign(capa.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden', zIndex: '30' });
      const visual = { anchoPt: p.anchoPt, altoPt: p.altoPt, rotation: 0 as const };
      if (pestana === 'encabezado') {
        const e = leerEncabezado();
        const k = Math.max(0, e.paginas.indexOf(o.paginaActual));
        if (e.paginas.includes(o.paginaActual)) {
          for (const c of e.cajas) {
            const t = expandirMacros(c.texto, { n: e.numeroInicial + k, total: o.totalPaginas, fecha: new Date() });
            if (!t.trim()) continue;
            const pos = colocarCaja(visual, c, o.medir(e.fuente, e.sizePt, t), e.sizePt, e.margenHorizPt, e.margenVertPt);
            const [r, g, b] = hexARgb(e.colorHex);
            texto(capa, p, t, e.fuente, e.sizePt, `rgb(${r},${g},${b})`, pos.xPt, pos.yPt, 0, 1, 'eh-vista-texto');
          }
        }
      } else {
        const m = leerMarca();
        if (m.texto.trim() && m.paginas.includes(o.paginaActual)) {
          const pos = colocarMarcaCentrada(visual, o.medir(m.fuente, m.sizePt, m.texto), m.sizePt, m.anguloGrados);
          const [r, g, b] = hexARgb(m.colorHex);
          texto(capa, p, m.texto, m.fuente, m.sizePt, `rgb(${r},${g},${b})`, pos.xPt, pos.yPt, pos.giroGrados, m.opacidad, 'eh-vista-marca');
        }
      }
      p.el.appendChild(capa);
      capaVista = capa;
    };

    const elegirPestana = (cual: 'encabezado' | 'marca'): void => {
      pestana = cual;
      panelEnc.hidden = cual !== 'encabezado';
      panelMarca.hidden = cual !== 'marca';
      tabEnc.setAttribute('aria-selected', String(cual === 'encabezado'));
      tabMarca.setAttribute('aria-selected', String(cual === 'marca'));
      tabEnc.tabIndex = cual === 'encabezado' ? 0 : -1;
      tabMarca.tabIndex = cual === 'marca' ? 0 : -1;
      mensaje.textContent = '';
      actualizarVista();
    };
    tabEnc.addEventListener('click', () => elegirPestana('encabezado'));
    tabMarca.addEventListener('click', () => elegirPestana('marca'));

    maOpacidad.addEventListener('input', () => { maOpacidadValor.textContent = `${maOpacidad.value} %`; });
    dialog.addEventListener('input', actualizarVista);
    dialog.addEventListener('change', actualizarVista);

    const progreso = (hechas: number, total: number): void => { mensaje.textContent = `Procesando… ${hechas} de ${total} páginas`; };
    const bloquear = (v: boolean): void => { ocupado = v; btnAplicar.disabled = btnQuitar.disabled = btnCancelar.disabled = v; };

    btnCancelar.addEventListener('click', () => dialog.close());
    btnAplicar.addEventListener('click', () => {
      let op: { encabezado: OpcionesEncabezado } | { marca: OpcionesMarcaAgua };
      if (pestana === 'encabezado') {
        const e = leerEncabezado();
        if (e.paginas.length === 0) { mensaje.textContent = 'El rango de páginas no contiene ninguna página del documento.'; return; }
        if (!e.cajas.some((c) => c.texto.trim())) { mensaje.textContent = 'Escribe texto en al menos una de las seis cajas.'; return; }
        op = { encabezado: e };
      } else {
        const m = leerMarca();
        if (m.paginas.length === 0) { mensaje.textContent = 'El rango de páginas no contiene ninguna página del documento.'; return; }
        if (!m.texto.trim()) { mensaje.textContent = 'Escribe el texto de la marca de agua.'; return; }
        op = { marca: m };
      }
      quitarVista();
      bloquear(true);
      void o.onAplicar(op, progreso).then(() => dialog.close(), () => { bloquear(false); mensaje.textContent = 'No se pudo aplicar.'; });
    });
    btnQuitar.addEventListener('click', () => {
      quitarVista();
      bloquear(true);
      void o.onQuitar(progreso).then(() => dialog.close(), () => { bloquear(false); mensaje.textContent = 'No se pudo quitar.'; });
    });

    dialog.addEventListener('close', quitarVista);
    elegirPestana('encabezado');
    mostrarModal(dialog, { tituloId: 'encabezado-panel-titulo', puedeCerrar: () => !ocupado });
    actualizarVista();
  }
}
