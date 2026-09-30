import { esParrafo, esTabla, type Parrafo, type Tabla, type CeldaTabla, type ModeloDocx } from './modelo';
import {
  wrapAtoms, lineToFlowLine, paginar,
  type Atom, type Medir, type FlowItem, type FlowLine, type FlowTableRow, type RelLinea, type RelBarra, type ResultadoLayout, type PageGeometry, type RGB
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
        bufferAtomos.push({ text: palabra, font: parte.formato.font, sizePt: parte.formato.sizePt, color: parte.formato.color, pegado, url: parte.url, underline: parte.formato.underline });
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

const TABLA_PAD_X_PT = 5;
const TABLA_PAD_Y_PT = 5;
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
        actual.push({ text: palabra, font: parte.formato.font, sizePt: parte.formato.sizePt, color: parte.formato.color, pegado, url: parte.url, underline: parte.formato.underline });
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

/** Contadores de degradaciones de tabla (se convierten en avisos al final de `renderizarModeloDocx`). */
interface AvisosTabla { filasPartidas: number; anchoEscalado: number; gridAmpliado: number; mergeDemasiadoAlto: number; siguienteMerge: number }

/** Una celda ya colocada en la rejilla de SU fila (x absoluto de página, en pt). */
interface CeldaPos {
  celda: CeldaTabla; xStart: number; wPt: number; colStart: number;
  /** >1 solo en la celda ORIGEN (`vMerge` "restart") de una combinación vertical con continuaciones reales. */
  filasCombinadas: number;
  /** Celda de continuación de una combinación vertical que SÍ tiene origen encima: no pinta texto ni borde superior. */
  esContinuacion: boolean;
  mergeId: number | null;
  colorFondo: RGB | null;
}

/**
 * Convierte una `Tabla` (modelo.ts) en `FlowItem[]`: un `tableStart` (con
 * las filas de encabezado ya construidas, para que `paginar` las repita),
 * una `tableRow` por fila y un `tableEnd`.
 *
 * - Anchos: se escalan proporcionalmente si la suma declarada (`w:tblGrid`)
 *   no cabe en el ancho útil (con aviso); si una fila trae más celdas que
 *   columnas, la rejilla se AMPLÍA con columnas de 72 pt (con aviso) en vez
 *   de solapar celdas.
 * - Combinación vertical (`vMerge`): la celda origen y sus continuaciones se
 *   dibujan como UNA celda: el texto va una sola vez en la primera fila, el
 *   sombreado cubre todas las filas y no hay borde superior interno. Si su
 *   texto es más alto que la suma de las filas, crece la última. Si el
 *   grupo cruza un salto de página, `paginar` avisa (`mergeInicio`/
 *   `mergeContinua`).
 * - Fila más alta que una página: se PARTE por líneas en varias filas (cada
 *   celda reparte sus líneas), con aviso — nunca se corta ni se sale de la
 *   página. Una fila con celdas combinadas verticalmente no se puede partir:
 *   se avisa.
 * - Bordes: borde SUPERIOR e IZQUIERDO de cada celda (salvo el superior de
 *   una continuación) más el DERECHO tras la última celda; el INFERIOR de
 *   la tabla se añade una vez tras la última fila y en cada trozo de una
 *   fila partida salvo el último.
 */
function renderizarTabla(t: Tabla, margenIzqPt: number, margenDerPt: number, anchoPaginaPt: number, alturaUtilPt: number, medir: Medir, av: AvisosTabla): FlowItem[] {
  const anchosBase = [...t.anchosColPt];
  const colsNecesarias = t.filas.reduce((max, f) => Math.max(max, f.celdas.reduce((sum, c) => sum + c.gridSpan, 0)), 0);
  if (colsNecesarias > anchosBase.length) { av.gridAmpliado++; while (anchosBase.length < colsNecesarias) anchosBase.push(72); }
  const anchoDeclarado = anchosBase.reduce((sum, w) => sum + w, 0);
  const anchoDisponible = Math.max(40, anchoPaginaPt - margenIzqPt - margenDerPt);
  const escala = anchoDeclarado > anchoDisponible && anchoDeclarado > 0 ? anchoDisponible / anchoDeclarado : 1;
  if (escala < 1) av.anchoEscalado++;
  const anchosColPt = anchosBase.map((w) => w * escala);
  const tablaXPt = margenIzqPt;
  const xCol: number[] = [tablaXPt];
  for (const w of anchosColPt) xCol.push(xCol[xCol.length - 1]! + w);
  const anchoTablaPt = xCol[xCol.length - 1]! - tablaXPt;
  const numCols = anchosColPt.length;
  const g = t.bordeGrosorPt;

  const pos: CeldaPos[][] = t.filas.map((fila) => {
    let col = 0;
    return fila.celdas.map((celda) => {
      const span = Math.max(1, Math.min(celda.gridSpan, numCols - col));
      const xStart = xCol[col]!;
      const p: CeldaPos = { celda, xStart, wPt: xCol[col + span]! - xStart, colStart: col, filasCombinadas: 1, esContinuacion: false, mergeId: null, colorFondo: celda.colorFondo };
      col += span;
      return p;
    });
  });

  // Combinaciones verticales: cada "restart" recoge las continuaciones de su misma columna en las filas siguientes.
  pos.forEach((fila, i) => fila.forEach((p) => {
    if (p.celda.vMerge !== 'restart') return;
    let j = i + 1;
    const id = av.siguienteMerge;
    for (; j < pos.length; j++) {
      const q = pos[j]!.find((c) => c.colStart === p.colStart && c.celda.vMerge === 'continue' && !c.esContinuacion);
      if (!q) break;
      q.esContinuacion = true; q.mergeId = id; q.colorFondo = p.celda.colorFondo;
    }
    if (j > i + 1) { p.filasCombinadas = j - i; p.mergeId = id; av.siguienteMerge++; }
  }));

  const lineasDe = (p: CeldaPos): FlowLine[] => {
    if (p.esContinuacion) return [];
    const anchoTexto = Math.max(10, p.wPt - TABLA_PAD_X_PT * 2);
    return celdaAGrupos(p.celda).flatMap((atoms) => {
      const wrapped = atoms.length > 0 ? wrapAtoms(atoms, anchoTexto, medir) : [[]];
      return wrapped.map((linea, idx) => {
        const alto = (linea[0]?.sizePt ?? TABLA_SIZE_PT_DEFECTO) * TABLA_LINE_HEIGHT_FACTOR;
        return lineToFlowLine(linea, p.xStart + TABLA_PAD_X_PT, anchoTexto, p.celda.alineacion, idx === wrapped.length - 1, alto, medir);
      });
    });
  };
  const lineas: FlowLine[][][] = pos.map((fila) => fila.map(lineasDe));
  const altoContenido = (ls: FlowLine[]): number => (ls.length > 0 ? ls.reduce((sum, l) => sum + l.height, 0) : TABLA_SIZE_PT_DEFECTO * TABLA_LINE_HEIGHT_FACTOR) + TABLA_PAD_Y_PT * 2;

  const alturas = pos.map((fila, i) => Math.max(14, ...fila.map((p, k) => (p.esContinuacion || p.filasCombinadas > 1 ? 0 : altoContenido(lineas[i]![k]!)))));
  // El texto de una celda combinada verticalmente puede ser más alto que la suma de sus filas: crece la ÚLTIMA fila del grupo.
  pos.forEach((fila, i) => fila.forEach((p, k) => {
    if (p.filasCombinadas <= 1) return;
    let suma = 0;
    for (let r = i; r < i + p.filasCombinadas; r++) suma += alturas[r]!;
    const necesita = altoContenido(lineas[i]![k]!);
    if (necesita > suma) alturas[i + p.filasCombinadas - 1]! += necesita - suma;
  }));

  const participaEnMerge = (i: number): boolean => pos[i]!.some((p) => p.esContinuacion || p.filasCombinadas > 1);

  function armarFila(i: number, lineasFila: FlowLine[][], altura: number, esEncabezado: boolean, bordeInferior: boolean): FlowTableRow {
    const fila = pos[i]!;
    const lineasRel: RelLinea[] = [];
    lineasFila.forEach((ls) => {
      let y = TABLA_PAD_Y_PT;
      for (const l of ls) {
        lineasRel.push({ relYPt: y + l.height * (1 - TABLA_BASELINE_FRACTION), segs: l.segs });
        y += l.height;
      }
    });
    const fondos: RelBarra[] = [];
    for (const p of fila) if (p.colorFondo) fondos.push({ relYPt: 0, hPt: altura, xPt: p.xStart, wPt: p.wPt, color: p.colorFondo });
    const bordes: RelBarra[] = [];
    if (t.bordeColor) {
      fila.forEach((p, k) => {
        if (!p.esContinuacion) bordes.push({ relYPt: 0, hPt: g, xPt: p.xStart, wPt: p.wPt, color: t.bordeColor! });
        bordes.push({ relYPt: 0, hPt: altura, xPt: p.xStart, wPt: g, color: t.bordeColor! });
        if (k === fila.length - 1) bordes.push({ relYPt: 0, hPt: altura, xPt: p.xStart + p.wPt - g, wPt: g, color: t.bordeColor! });
        if (bordeInferior) bordes.push({ relYPt: altura - g, hPt: g, xPt: p.xStart, wPt: p.wPt, color: t.bordeColor! });
      });
    }
    const mergeInicio = fila.filter((p) => p.filasCombinadas > 1).map((p) => p.mergeId!);
    const mergeContinua = fila.filter((p) => p.esContinuacion).map((p) => p.mergeId!);
    return { kind: 'tableRow', height: altura, lineas: lineasRel, fondos, bordes, esEncabezado, ...(mergeInicio.length ? { mergeInicio } : {}), ...(mergeContinua.length ? { mergeContinua } : {}) };
  }

  /** Reparte las líneas de cada celda en trozos que caben en `capacidad` pt de contenido; el trozo c de cada celda va en la fila c. */
  function partirLineas(lineasFila: FlowLine[][], capacidad: number): FlowLine[][][] {
    const porCelda = lineasFila.map((ls) => {
      const trozos: FlowLine[][] = [[]];
      let acc = 0;
      for (const l of ls) {
        if (acc + l.height > capacidad && trozos[trozos.length - 1]!.length > 0) { trozos.push([]); acc = 0; }
        trozos[trozos.length - 1]!.push(l);
        acc += l.height;
      }
      return trozos;
    });
    const n = Math.max(...porCelda.map((c) => c.length));
    return Array.from({ length: n }, (_v, c) => porCelda.map((tr) => tr[c] ?? []));
  }

  const alturaEncabezados = t.filas.reduce((sum, f, i) => sum + (f.esEncabezado ? alturas[i]! : 0), 0);
  const maxFila = Math.max(60, alturaUtilPt - alturaEncabezados);

  const filasFlow: FlowTableRow[] = [];
  const encabezados: FlowTableRow[] = [];
  t.filas.forEach((f, i) => {
    if (alturas[i]! > maxFila && !f.esEncabezado) {
      if (participaEnMerge(i)) { av.mergeDemasiadoAlto++; filasFlow.push(armarFila(i, lineas[i]!, alturas[i]!, false, false)); return; }
      av.filasPartidas++;
      const trozos = partirLineas(lineas[i]!, maxFila - TABLA_PAD_Y_PT * 2);
      trozos.forEach((tr, c) => {
        const alto = Math.max(14, ...tr.map((ls) => altoContenido(ls)));
        filasFlow.push(armarFila(i, tr, alto, false, c < trozos.length - 1));
      });
      return;
    }
    const fila = armarFila(i, lineas[i]!, alturas[i]!, f.esEncabezado, false);
    filasFlow.push(fila);
    if (f.esEncabezado) encabezados.push(fila);
  });
  if (t.bordeColor && filasFlow.length > 0) {
    const ultima = filasFlow[filasFlow.length - 1]!;
    ultima.bordes.push({ relYPt: ultima.height - g, hPt: g, xPt: tablaXPt, wPt: anchoTablaPt, color: t.bordeColor });
  }

  return [
    { kind: 'gap', height: 6, bars: [] },
    { kind: 'tableStart', headerRows: encabezados },
    ...filasFlow,
    { kind: 'tableEnd' },
    { kind: 'gap', height: 8, bars: [] }
  ];
}

function mensajesTabla(av: AvisosTabla): string[] {
  const out: string[] = [];
  const c = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios.replace('{n}', String(n)));
  if (av.filasPartidas > 0) out.push(c(av.filasPartidas, 'Una fila de tabla era más alta que una página y se partió por líneas entre páginas.', '{n} filas de tabla eran más altas que una página y se partieron por líneas entre páginas.'));
  if (av.mergeDemasiadoAlto > 0) out.push(c(av.mergeDemasiadoAlto, 'Una fila con celdas combinadas verticalmente es más alta que una página y no se pudo partir: parte de su contenido puede quedar fuera de la página.', '{n} filas con celdas combinadas verticalmente son más altas que una página y no se pudieron partir: parte de su contenido puede quedar fuera de la página.'));
  if (av.gridAmpliado > 0) out.push(c(av.gridAmpliado, 'Una tabla tenía filas con más celdas que columnas en su rejilla; se ampliaron las columnas (72 pt cada una) para no perder celdas.', '{n} tablas tenían filas con más celdas que columnas en su rejilla; se ampliaron las columnas (72 pt cada una) para no perder celdas.'));
  if (av.anchoEscalado > 0) out.push(c(av.anchoEscalado, 'Una tabla más ancha que la página se escaló proporcionalmente al ancho útil.', '{n} tablas más anchas que la página se escalaron proporcionalmente al ancho útil.'));
  return out;
}

export function renderizarModeloDocx(modelo: ModeloDocx, medir: Medir): ResultadoLayout {
  const geo: PageGeometry = {
    widthPt: modelo.paginaAnchoPt, heightPt: modelo.paginaAltoPt,
    marginTopPt: modelo.margenSupPt, marginBottomPt: modelo.margenInfPt,
    marginLeftPt: modelo.margenIzqPt, marginRightPt: modelo.margenDerPt
  };
  const alturaUtilPt = modelo.paginaAltoPt - modelo.margenSupPt - modelo.margenInfPt;
  const av: AvisosTabla = { filasPartidas: 0, anchoEscalado: 0, gridAmpliado: 0, mergeDemasiadoAlto: 0, siguienteMerge: 0 };
  const items: FlowItem[] = [];
  for (const bloque of modelo.bloques) {
    if (esParrafo(bloque)) items.push(...renderizarParrafo(bloque, modelo.margenIzqPt, modelo.margenDerPt, modelo.paginaAnchoPt, medir));
    else if (esTabla(bloque)) items.push(...renderizarTabla(bloque, modelo.margenIzqPt, modelo.margenDerPt, modelo.paginaAnchoPt, alturaUtilPt, medir, av));
  }
  // Fracción de línea donde cae la línea base: mismo valor que Markdown
  // (`BASELINE_FRACTION`) y que `TABLA_BASELINE_FRACTION` de arriba,
  // aproximación documentada en `../markdown/layout.ts`.
  const res = paginar(items, geo, TABLA_BASELINE_FRACTION);
  return { ...res, advertencias: [...mensajesTabla(av), ...res.advertencias] };
}
