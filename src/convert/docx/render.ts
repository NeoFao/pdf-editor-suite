import type { Parrafo, ModeloDocx } from './modelo';
import {
  wrapAtoms, lineToFlowLine, paginar,
  type Atom, type Medir, type FlowItem, type ResultadoLayout, type PageGeometry
} from '../flujo/layout';

/**
 * Convierte el `ModeloDocx` (puro, sin geometría de línea) en `FlowItem` del
 * maquetador común y pagina (§9 fila #4). Es el equivalente, para DOCX, de
 * la parte de `renderBlock`/`renderBlocksFlat` de `../markdown/layout.ts` —
 * ambos conversores comparten `wrapAtoms`/`lineToFlowLine`/`paginar` de
 * `../flujo/layout.ts`, cada uno con su propio recorrido del modelo de
 * origen.
 *
 * Simplificación de fase 1 (ver también el comentario de módulo de
 * `modelo.ts`): el ajuste de línea usa SIEMPRE el ancho "normal" del
 * párrafo (sangría izquierda/derecha, sin contar el efecto de primera
 * línea) — la sangría de primera línea/colgante solo mueve la posición X de
 * esa línea (y del marcador de lista), no el ancho disponible para ajustar.
 */
function renderizarParrafo(p: Parrafo, margenIzqPt: number, margenDerPt: number, anchoPaginaPt: number, medir: Medir): FlowItem[] {
  const salida: FlowItem[] = [];
  if (p.saltoPaginaAntes) salida.push({ kind: 'pagebreak' });
  if (p.espacioAntesPt > 0) salida.push({ kind: 'gap', height: p.espacioAntesPt, bars: [] });

  const anchoDisponible = Math.max(20, anchoPaginaPt - margenIzqPt - margenDerPt - p.sangriaIzqPt - p.sangriaDerPt);
  const xNormalPt = margenIzqPt + p.sangriaIzqPt;
  const xPrimeraLineaPt = xNormalPt + p.sangriaPrimeraLineaPt;
  const alturaLinea = (sizePt: number): number => p.interlineadoExactoPt ?? sizePt * p.interlineadoFactor;

  let primeraLineaPendiente = true;
  let bufferAtomos: Atom[] = [];

  function volcar(): void {
    const primeraDeEsteVolcado = primeraLineaPendiente;
    let atomosSegmento = bufferAtomos;
    bufferAtomos = [];
    if (primeraDeEsteVolcado && p.lista) {
      atomosSegmento = [{ text: p.lista.textoMarcador, font: 'Helvetica', sizePt: p.tamanoBasePt, color: [0, 0, 0] }, ...atomosSegmento];
    }
    const envueltas = atomosSegmento.length > 0 ? wrapAtoms(atomosSegmento, anchoDisponible, medir) : [[]];
    envueltas.forEach((linea, idx) => {
      const esPrimeraAbsoluta = primeraDeEsteVolcado && idx === 0;
      const esUltimaDelSegmento = idx === envueltas.length - 1;
      const x = esPrimeraAbsoluta ? xPrimeraLineaPt : xNormalPt;
      const alto = alturaLinea(linea[0]?.sizePt ?? p.tamanoBasePt);
      salida.push(lineToFlowLine(linea, x, anchoDisponible, p.alineacion, esUltimaDelSegmento, alto, medir));
    });
    primeraLineaPendiente = false;
  }

  for (const parte of p.partes) {
    if (parte.tipo === 'texto') {
      for (const palabra of parte.texto.split(/\s+/)) {
        if (palabra !== '') bufferAtomos.push({ text: palabra, font: parte.formato.font, sizePt: parte.formato.sizePt, color: parte.formato.color });
      }
    } else if (parte.tipo === 'tab') {
      // Fase 1 sin tabulaciones reales (sin modelo de tab-stops): se
      // aproxima con un hueco de ancho fijo que participa en el ajuste de
      // línea como una palabra más (ver limitaciones de `modelo.ts`).
      bufferAtomos.push({ text: '    ', font: 'Helvetica', sizePt: p.tamanoBasePt, color: [0, 0, 0] });
    } else if (parte.tipo === 'saltoLinea') {
      volcar();
    } else if (parte.tipo === 'saltoPagina') {
      volcar();
      salida.push({ kind: 'pagebreak' });
    }
  }
  volcar();

  if (p.espacioDespuesPt > 0) salida.push({ kind: 'gap', height: p.espacioDespuesPt, bars: [] });
  return salida;
}

export function renderizarModeloDocx(modelo: ModeloDocx, medir: Medir): ResultadoLayout {
  const geo: PageGeometry = {
    widthPt: modelo.paginaAnchoPt, heightPt: modelo.paginaAltoPt,
    marginTopPt: modelo.margenSupPt, marginBottomPt: modelo.margenInfPt,
    marginLeftPt: modelo.margenIzqPt, marginRightPt: modelo.margenDerPt
  };
  const items: FlowItem[] = [];
  for (const p of modelo.parrafos) items.push(...renderizarParrafo(p, modelo.margenIzqPt, modelo.margenDerPt, modelo.paginaAnchoPt, medir));
  // Fracción de línea donde cae la línea base: mismo valor que Markdown
  // (`BASELINE_FRACTION`), aproximación documentada en `../markdown/layout.ts`.
  return paginar(items, geo, 0.28);
}
