import { esParrafo, esTabla, type Parrafo, type Tabla, type FilaTabla, type CeldaTabla, type ModeloDocx } from './modelo';
import {
  wrapAtoms, lineToFlowLine, paginar,
  type Atom, type Medir, type FlowItem, type FlowTableRow, type RelLinea, type RelBarra, type ResultadoLayout, type PageGeometry
} from '../flujo/layout';

/**
 * Convierte el `ModeloDocx` (puro, sin geometría de línea) en `FlowItem` del
 * maquetador común y pagina (§9 fila #4). Es el equivalente, para DOCX, de
 * la parte de `renderBlock`/`renderBlocksFlat` de `../markdown/layout.ts` —
 * ambos conversores comparten `wrapAtoms`/`lineToFlowLine`/`paginar` de
 * `../flujo/layout.ts`, cada uno con su propio recorrido del modelo de
 * origen.
 *
 * Fase 2a añade imágenes (bloque `image` del maquetador común) y tablas
 * reales (`tableRow`/`tableStart`/`tableEnd`) — ver `renderizarTabla` más
 * abajo. `renderizarParrafo` sigue con la misma simplificación de fase 1: el
 * ajuste de línea usa SIEMPRE el ancho "normal" del párrafo (sangría
 * izquierda/derecha, sin contar el efecto de primera línea) — la sangría de
 * primera línea/colgante solo mueve la posición X de esa línea (y del
 * marcador de lista), no el ancho disponible para ajustar.
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
  let seEmitioAlgunaLinea = false;
  let huboImagen = false;
  // Un párrafo cuyo ÚNICO contenido es un salto de página (patrón habitual
  // en Word para forzar una página nueva) no debe dejar una línea en blanco
  // ni antes ni después del salto — solo el salto en sí. El "línea en
  // blanco de reserva" de más abajo es solo para un párrafo REALMENTE vacío
  // (el usuario pulsó Intro sin escribir nada, y sin imagen), que sí debe
  // conservar su alto de línea.
  const tieneSaltoPagina = p.partes.some((parte) => parte.tipo === 'saltoPagina');

  function volcar(): void {
    const primeraDeEsteVolcado = primeraLineaPendiente;
    primeraLineaPendiente = false;
    let atomosSegmento = bufferAtomos;
    bufferAtomos = [];
    if (primeraDeEsteVolcado && p.lista) {
      atomosSegmento = [{ text: p.lista.textoMarcador, font: 'Helvetica', sizePt: p.tamanoBasePt, color: [0, 0, 0] }, ...atomosSegmento];
    }
    if (atomosSegmento.length === 0) return; // nada que maquetar en este segmento (p. ej. justo antes/después de un salto)
    const envueltas = wrapAtoms(atomosSegmento, anchoDisponible, medir);
    envueltas.forEach((linea, idx) => {
      const esPrimeraAbsoluta = primeraDeEsteVolcado && idx === 0;
      const esUltimaDelSegmento = idx === envueltas.length - 1;
      const x = esPrimeraAbsoluta ? xPrimeraLineaPt : xNormalPt;
      const alto = alturaLinea(linea[0]?.sizePt ?? p.tamanoBasePt);
      salida.push(lineToFlowLine(linea, x, anchoDisponible, p.alineacion, esUltimaDelSegmento, alto, medir));
      seEmitioAlgunaLinea = true;
    });
  }

  // Word divide un mismo "word visual" en varios `w:r` (runs) cuando cambia
  // el formato a mitad de palabra o justo en un signo de puntuación (p. ej.
  // "**negrita**," -> un run en negrita "negrita" y un run normal ","). Si
  // los partimos en palabras por espacios SIN recordar si había un espacio
  // real entre dos `parte`s consecutivas, el ajuste de línea (pensado para
  // Markdown, donde cada palabra SIEMPRE viene separada por espacio)
  // insertaría uno de más entre la palabra y la coma. `terminaEnEspacio`
  // seguido entre partes consecutivas evita eso marcando el primer átomo de
  // la parte siguiente como `pegado` cuando no hay espacio real de por medio.
  let terminaEnEspacio = true;
  for (const parte of p.partes) {
    if (parte.tipo === 'texto') {
      const empiezaConEspacio = parte.texto.length === 0 || /^\s/.test(parte.texto);
      let primerPalabra = true;
      for (const palabra of parte.texto.split(/\s+/)) {
        if (palabra === '') continue;
        const pegado = primerPalabra && !empiezaConEspacio && !terminaEnEspacio && bufferAtomos.length > 0;
        bufferAtomos.push({ text: palabra, font: parte.formato.font, sizePt: parte.formato.sizePt, color: parte.formato.color, pegado, url: parte.url });
        primerPalabra = false;
      }
      if (parte.texto.length > 0) terminaEnEspacio = /\s$/.test(parte.texto);
    } else if (parte.tipo === 'tab') {
      // Fase 1 sin tabulaciones reales (sin modelo de tab-stops): se
      // aproxima con un hueco de ancho fijo que participa en el ajuste de
      // línea como una palabra más (ver limitaciones de `modelo.ts`).
      bufferAtomos.push({ text: '    ', font: 'Helvetica', sizePt: p.tamanoBasePt, color: [0, 0, 0] });
      terminaEnEspacio = true;
    } else if (parte.tipo === 'saltoLinea') {
      volcar();
      terminaEnEspacio = true;
    } else if (parte.tipo === 'saltoPagina') {
      volcar();
      salida.push({ kind: 'pagebreak' });
      terminaEnEspacio = true;
    } else if (parte.tipo === 'imagen') {
      volcar();
      huboImagen = true;
      // Escala proporcional si el tamaño declarado por Word (wp:extent) no
      // cabe en el ancho útil del párrafo (spec fase 2a §3).
      let wPt = parte.wPt, hPt = parte.hPt;
      if (wPt > anchoDisponible && wPt > 0) { const escala = anchoDisponible / wPt; wPt *= escala; hPt *= escala; }
      salida.push({ kind: 'image', height: hPt, xPt: xNormalPt, wPt, imgId: parte.refId });
      terminaEnEspacio = true;
    }
  }
  volcar();

  if (!seEmitioAlgunaLinea && !tieneSaltoPagina && !huboImagen) {
    // Párrafo realmente vacío (línea en blanco intencional del usuario): se
    // conserva su alto de línea aunque no tenga texto ni marcador.
    salida.push({ kind: 'line', height: alturaLinea(p.tamanoBasePt), segs: [], bars: [] });
  }

  if (p.espacioDespuesPt > 0) salida.push({ kind: 'gap', height: p.espacioDespuesPt, bars: [] });
  return salida;
}

const TABLA_PAD_X_PT = 4;
const TABLA_PAD_Y_PT = 3;
const TABLA_LINE_HEIGHT_FACTOR = 1.2;
const TABLA_BASELINE_FRACTION = 0.28; // mismo valor que `paginar()` para el resto del documento (ver más abajo)
const TABLA_SIZE_PT_DEFECTO = 10;

/**
 * Aplana el contenido de una celda (`CeldaTabla.partes`) en GRUPOS de
 * átomos, uno por línea DURA (`saltoLinea`, de unir varios `w:p` de la
 * celda — ver `CeldaTabla` en `modelo.ts`): cada grupo se ajusta de línea
 * (`wrapAtoms`) por separado, nunca junto con el grupo siguiente. Un
 * `w:tab` dentro de una celda se aproxima con un hueco fijo, igual que en
 * `renderizarParrafo`. Una `imagen` dentro de una celda queda fuera de
 * alcance de esta fase (se ignora: no hay un "bloque" de altura propia
 * dentro de la línea de una celda en este maquetador) — caso raro en tablas
 * reales, no cubierto por los tests de este PR.
 */
function celdaAGrupos(celda: CeldaTabla): Atom[][] {
  const grupos: Atom[][] = [];
  let actual: Atom[] = [];
  let terminaEnEspacio = true;
  for (const parte of celda.partes) {
    if (parte.tipo === 'texto') {
      const empiezaConEspacio = parte.texto.length === 0 || /^\s/.test(parte.texto);
      let primerPalabra = true;
      for (const palabra of parte.texto.split(/\s+/)) {
        if (palabra === '') continue;
        const pegado = primerPalabra && !empiezaConEspacio && !terminaEnEspacio && actual.length > 0;
        actual.push({ text: palabra, font: parte.formato.font, sizePt: parte.formato.sizePt, color: parte.formato.color, pegado, url: parte.url });
        primerPalabra = false;
      }
      if (parte.texto.length > 0) terminaEnEspacio = /\s$/.test(parte.texto);
    } else if (parte.tipo === 'tab') {
      actual.push({ text: '  ', font: 'Helvetica', sizePt: TABLA_SIZE_PT_DEFECTO, color: [0, 0, 0] });
      terminaEnEspacio = true;
    } else if (parte.tipo === 'saltoLinea' || parte.tipo === 'saltoPagina') {
      grupos.push(actual);
      actual = [];
      terminaEnEspacio = true;
    }
    // 'imagen': ver el comentario de la función.
  }
  grupos.push(actual);
  return grupos;
}

/**
 * Convierte una `Tabla` (modelo.ts) en `FlowItem[]`: un `tableStart` (con
 * las filas de encabezado ya construidas, para que `paginar` las repita),
 * una `tableRow` por fila y un `tableEnd`. Los anchos de columna se escalan
 * proporcionalmente si la suma declarada (`w:tblGrid`) no cabe en el ancho
 * útil de página. Bordes: se dibuja el borde SUPERIOR e IZQUIERDO de cada
 * celda (salvo el superior de una celda `vMerge` "continue", para dar el
 * efecto visual de combinación vertical) más el borde DERECHO tras la
 * última celda de cada fila — como cada fila ya aporta su propio borde
 * superior, el de abajo de la fila N-1 y el de arriba de la fila N son la
 * MISMA línea (dibujada dos veces, sin diferencia visual); el borde
 * INFERIOR de la tabla se añade aparte, una sola vez, tras la última fila.
 */
function renderizarTabla(t: Tabla, margenIzqPt: number, margenDerPt: number, anchoPaginaPt: number, medir: Medir): FlowItem[] {
  const anchoDeclarado = t.anchosColPt.reduce((s, w) => s + w, 0);
  const anchoDisponible = Math.max(40, anchoPaginaPt - margenIzqPt - margenDerPt);
  const escala = anchoDeclarado > anchoDisponible && anchoDeclarado > 0 ? anchoDisponible / anchoDeclarado : 1;
  const anchosColPt = t.anchosColPt.map((w) => w * escala);
  const tablaXPt = margenIzqPt;
  const xCol: number[] = [tablaXPt];
  for (const w of anchosColPt) xCol.push(xCol[xCol.length - 1]! + w);
  const anchoTablaPt = xCol[xCol.length - 1]! - tablaXPt;
  const numCols = anchosColPt.length;
  const g = t.bordeGrosorPt;

  function construirFila(fila: FilaTabla): FlowTableRow {
    let colIndex = 0;
    const celdasInfo: { xStart: number; wPt: number; celda: CeldaTabla }[] = [];
    for (const celda of fila.celdas) {
      const span = Math.max(1, Math.min(celda.gridSpan, numCols - colIndex));
      const xStart = xCol[colIndex] ?? tablaXPt;
      const xFin = xCol[Math.min(colIndex + span, numCols)] ?? xStart;
      celdasInfo.push({ xStart, wPt: xFin - xStart, celda });
      colIndex += span;
    }

    const lineasPorCelda = celdasInfo.map(({ celda }) => {
      if (celda.vMerge === 'continue') return [];
      return celdaAGrupos(celda);
    });

    // Envuelve cada grupo (línea dura) de cada celda con el ancho de SU columna.
    const flowLinesPorCelda = celdasInfo.map(({ wPt }, i) => {
      const anchoTexto = Math.max(10, wPt - TABLA_PAD_X_PT * 2);
      const grupos = lineasPorCelda[i]!;
      return grupos.flatMap((atoms) => {
        const wrapped = atoms.length > 0 ? wrapAtoms(atoms, anchoTexto, medir) : [[]];
        return wrapped.map((linea, idx) => {
          const alto = (linea[0]?.sizePt ?? TABLA_SIZE_PT_DEFECTO) * TABLA_LINE_HEIGHT_FACTOR;
          return lineToFlowLine(linea, celdasInfo[i]!.xStart + TABLA_PAD_X_PT, anchoTexto, celdasInfo[i]!.celda.alineacion, idx === wrapped.length - 1, alto, medir);
        });
      });
    });

    const alturaContenido = (lineas: ReturnType<typeof lineToFlowLine>[]): number =>
      lineas.length > 0 ? lineas.reduce((s, l) => s + l.height, 0) : TABLA_SIZE_PT_DEFECTO * TABLA_LINE_HEIGHT_FACTOR;
    const rowHeight = Math.max(14, ...flowLinesPorCelda.map((lineas) => alturaContenido(lineas) + TABLA_PAD_Y_PT * 2));

    const lineasRel: RelLinea[] = [];
    flowLinesPorCelda.forEach((lineas) => {
      let y = TABLA_PAD_Y_PT;
      for (const l of lineas) {
        lineasRel.push({ relYPt: y + l.height * TABLA_BASELINE_FRACTION, segs: l.segs });
        y += l.height;
      }
    });

    const fondos: RelBarra[] = [];
    for (const { xStart, wPt, celda } of celdasInfo) {
      if (celda.colorFondo) fondos.push({ relYPt: 0, hPt: rowHeight, xPt: xStart, wPt, color: celda.colorFondo });
    }

    const bordes: RelBarra[] = [];
    if (t.bordeColor) {
      celdasInfo.forEach(({ xStart, wPt, celda }, i) => {
        if (celda.vMerge !== 'continue') bordes.push({ relYPt: 0, hPt: g, xPt: xStart, wPt, color: t.bordeColor! });
        bordes.push({ relYPt: 0, hPt: rowHeight, xPt: xStart, wPt: g, color: t.bordeColor! });
        if (i === celdasInfo.length - 1) bordes.push({ relYPt: 0, hPt: rowHeight, xPt: xStart + wPt - g, wPt: g, color: t.bordeColor! });
      });
    }

    return { kind: 'tableRow', height: rowHeight, lineas: lineasRel, fondos, bordes, esEncabezado: fila.esEncabezado };
  }

  const filasFlow = t.filas.map(construirFila);
  if (t.bordeColor && filasFlow.length > 0) {
    const ultima = filasFlow[filasFlow.length - 1]!;
    ultima.bordes.push({ relYPt: ultima.height - g, hPt: g, xPt: tablaXPt, wPt: anchoTablaPt, color: t.bordeColor });
  }
  const encabezados = filasFlow.filter((_fila, i) => t.filas[i]!.esEncabezado);

  return [
    { kind: 'gap', height: 6, bars: [] },
    { kind: 'tableStart', headerRows: encabezados },
    ...filasFlow,
    { kind: 'tableEnd' },
    { kind: 'gap', height: 8, bars: [] }
  ];
}

export function renderizarModeloDocx(modelo: ModeloDocx, medir: Medir): ResultadoLayout {
  const geo: PageGeometry = {
    widthPt: modelo.paginaAnchoPt, heightPt: modelo.paginaAltoPt,
    marginTopPt: modelo.margenSupPt, marginBottomPt: modelo.margenInfPt,
    marginLeftPt: modelo.margenIzqPt, marginRightPt: modelo.margenDerPt
  };
  const items: FlowItem[] = [];
  for (const bloque of modelo.bloques) {
    if (esParrafo(bloque)) items.push(...renderizarParrafo(bloque, modelo.margenIzqPt, modelo.margenDerPt, modelo.paginaAnchoPt, medir));
    else if (esTabla(bloque)) items.push(...renderizarTabla(bloque, modelo.margenIzqPt, modelo.margenDerPt, modelo.paginaAnchoPt, medir));
  }
  // Fracción de línea donde cae la línea base: mismo valor que Markdown
  // (`BASELINE_FRACTION`) y que `TABLA_BASELINE_FRACTION` de arriba,
  // aproximación documentada en `../markdown/layout.ts`.
  return paginar(items, geo, TABLA_BASELINE_FRACTION);
}
