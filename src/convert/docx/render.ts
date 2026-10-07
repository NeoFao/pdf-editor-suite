import { aproximado, type Advertencia } from '../advertencia';
import { esParrafo, esTabla, type Parrafo, type Tabla, type CeldaTabla, type ModeloDocx, type Borde, type BordesTabla, type ZonaPaginaModelo, type SeccionDocx, type BloqueDocx } from './modelo';
import {
  wrapAtoms, lineToFlowLine, paginar, colocarZona, altoZona, parrafoFlex,
  type Atom, type Medir, type FlowItem, type FlowLine, type FlowTableRow, type RelLinea, type RelBarra, type ResultadoLayout, type PageGeometry, type RGB, type TabsConfig, type TabStopAbs
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
/** Valores de los campos `PAGE`/`NUMPAGES` al maquetar un encabezado o pie de una página concreta. */
interface ValoresCampo { pagina: number; total: number }

/** Opciones de maquetación de un párrafo (fase 2c). `flex`: maquetar línea a línea (hay flotantes con ajuste de texto en el documento); un párrafo con tabulaciones siempre va así. `tabDefectoPt`: intervalo de las paradas por defecto. */
interface OpcionesFlujo { flex: boolean; tabDefectoPt: number }
const OPC_BASE: OpcionesFlujo = { flex: false, tabDefectoPt: 36 };

function renderizarParrafo(p: Parrafo, margenIzqPt: number, margenDerPt: number, anchoPaginaPt: number, medir: Medir, campos: ValoresCampo | null = null, opc: OpcionesFlujo = OPC_BASE): FlowItem[] {
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
  // Fase 2c: con tabulaciones (o con flotantes que el texto rodea) las líneas se maquetan al paginar, no antes.
  const tieneTabs = p.partes.some((parte) => parte.tipo === 'tab');
  const usaFlex = opc.flex || tieneTabs;
  const tabs: TabsConfig | null = tieneTabs
    ? { stops: (p.tabs ?? []).map((t): TabStopAbs => ({ posPt: margenIzqPt + t.posPt, tipo: t.tipo, leader: t.leader })), defectoPt: opc.tabDefectoPt, origenPt: margenIzqPt }
    : null;
  /** `w:ptab`: una parada ya resuelta contra el margen (derecha del área de texto, centro o izquierda). */
  const paradaPtab = (al: 'left' | 'center' | 'right', leader: TabStopAbs['leader']): TabStopAbs => {
    const x0 = margenIzqPt, x1 = anchoPaginaPt - margenDerPt - p.sangriaDerPt;
    return al === 'right' ? { posPt: x1, tipo: 'right', leader } : al === 'center' ? { posPt: (x0 + x1) / 2, tipo: 'center', leader } : { posPt: x0, tipo: 'left', leader };
  };

  function volcar(): void {
    const primeraDeEsteVolcado = primeraLineaPendiente;
    primeraLineaPendiente = false;
    let atomosSegmento = bufferAtomos;
    bufferAtomos = [];
    if (primeraDeEsteVolcado && p.lista) {
      atomosSegmento = [{ text: p.lista.textoMarcador, font: 'Helvetica', sizePt: p.tamanoBasePt, color: [0, 0, 0] }, ...atomosSegmento];
    }
    if (atomosSegmento.length === 0) return; // nada que maquetar en este segmento (p. ej. justo antes/después de un salto)
    if (usaFlex) {
      salida.push(parrafoFlex({ atoms: atomosSegmento, xNormalPt, xPrimeraPt: xPrimeraLineaPt, wPt: anchoDisponible, align: p.alineacion, alturaLinea, tabs, medir, primeraDelParrafo: primeraDeEsteVolcado }));
      seEmitioAlgunaLinea = true;
      return;
    }
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
    } else if (parte.tipo === 'campo') {
      // Número de página/total: se pinta como un átomo de texto con el formato del campo (pegado a lo anterior si no hay espacio real).
      if (!campos) continue;
      const pegado = bufferAtomos.length > 0 && !terminaEnEspacio;
      bufferAtomos.push({ text: String(parte.campo === 'PAGE' ? campos.pagina : campos.total), font: parte.formato.font, sizePt: parte.formato.sizePt, color: parte.formato.color, pegado, underline: parte.formato.underline });
      terminaEnEspacio = false;
    } else if (parte.tipo === 'tab') {
      // Tabulación real (fase 2c): un átomo `tab` que `lineaConTabs` resuelve contra las paradas al colocar la línea.
      const fijo = parte.ptab ? paradaPtab(parte.ptab.alineacion, parte.ptab.leader) : undefined;
      bufferAtomos.push({ text: '', font: 'Helvetica', sizePt: p.tamanoBasePt, color: [0, 0, 0], tab: fijo ? { fijo } : {} });
      terminaEnEspacio = true;
    } else if (parte.tipo === 'saltoLinea') {
      volcar();
      terminaEnEspacio = true;
    } else if (parte.tipo === 'saltoPagina') {
      volcar();
      salida.push({ kind: 'pagebreak' });
      terminaEnEspacio = true;
    } else if (parte.tipo === 'imagen' && parte.flotante) {
      // Imagen flotante (fase 2b): SIN ajuste de texto. Ocupa 0 pt de flujo; `paginar` la coloca en su posición en la página del contenido siguiente.
      salida.push({ kind: 'floatImage', imgId: parte.refId, wPt: parte.wPt, hPt: parte.hPt, h: parte.flotante.h, v: parte.flotante.v, ...(parte.flotante.ajuste ? { ajuste: parte.flotante.ajuste } : {}) });
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
interface AvisosTabla { filasPartidas: number; anchoEscalado: number; gridAmpliado: number; mergeDemasiadoAlto: number; siguienteMerge: number; saltoEnZona: number; zonaAcotada: number }
const nuevosAvisos = (): AvisosTabla => ({ filasPartidas: 0, anchoEscalado: 0, gridAmpliado: 0, mergeDemasiadoAlto: 0, siguienteMerge: 0, saltoEnZona: 0, zonaAcotada: 0 });

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
  const numCols = anchosColPt.length;
  // Bordes de tabla por lado; un modelo construido a mano sin `bordesTabla` usa el color/grosor único de siempre en todos los lados.
  const bt: BordesTabla = t.bordesTabla ?? (t.bordeColor ? Object.fromEntries(['top', 'bottom', 'left', 'right', 'insideH', 'insideV'].map((l) => [l, { color: t.bordeColor!, grosorPt: t.bordeGrosorPt }])) : {});

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

  /** Celda de la fila `i` que cubre la columna `col` (para consultar los bordes de la vecina de arriba/izquierda). */
  const celdaEn = (i: number, col: number): CeldaPos | undefined => pos[i]?.find((q) => q.colStart <= col && col < q.colStart + Math.max(1, q.celda.gridSpan));
  /**
   * Borde efectivo de un lado de la celda `(i, k)`, con precedencia CELDA > TABLA (`undefined`/`null` = sin borde). Cada arista
   * compartida la dibuja UNA sola celda: la de abajo/derecha (su borde superior/izquierdo), que a su vez hereda el borde
   * inferior/derecho EXPLÍCITO de la de arriba/izquierda si ella no declara el suyo. Solo se dibujan inferior/derecho en el
   * borde exterior de la tabla.
   */
  function bordeEfectivo(i: number, k: number, lado: 'top' | 'bottom' | 'left' | 'right'): Borde | null | undefined {
    const p = pos[i]![k]!;
    const propio = p.celda.bordes?.[lado];
    if (propio !== undefined) return propio;
    if (lado === 'top') {
      if (i === 0) return bt.top;
      const arriba = celdaEn(i - 1, p.colStart);
      return arriba?.celda.bordes?.bottom !== undefined ? arriba.celda.bordes.bottom : bt.insideH;
    }
    if (lado === 'left') {
      if (p.colStart === 0) return bt.left;
      const izq = celdaEn(i, p.colStart - 1);
      return izq?.celda.bordes?.right !== undefined ? izq.celda.bordes.right : bt.insideV;
    }
    return lado === 'bottom' ? bt.bottom : bt.right;
  }

  function armarFila(i: number, lineasFila: FlowLine[][], altura: number, esEncabezado: boolean, inferior: 'ninguno' | 'interno' | 'tabla'): FlowTableRow {
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
    fila.forEach((p, k) => {
      const top = p.esContinuacion ? null : bordeEfectivo(i, k, 'top');
      if (top) bordes.push({ relYPt: 0, hPt: top.grosorPt, xPt: p.xStart, wPt: p.wPt, color: top.color });
      const left = bordeEfectivo(i, k, 'left');
      if (left) bordes.push({ relYPt: 0, hPt: altura, xPt: p.xStart, wPt: left.grosorPt, color: left.color });
      if (k === fila.length - 1) {
        const right = bordeEfectivo(i, k, 'right');
        if (right) bordes.push({ relYPt: 0, hPt: altura, xPt: p.xStart + p.wPt - right.grosorPt, wPt: right.grosorPt, color: right.color });
      }
      // Inferior: en el borde de la tabla (celda > tabla) o, en una fila partida, el interior de la tabla.
      const bottom = inferior === 'tabla' ? bordeEfectivo(i, k, 'bottom') : inferior === 'interno' ? (p.celda.bordes?.bottom !== undefined ? p.celda.bordes.bottom : bt.insideH) : null;
      if (bottom) bordes.push({ relYPt: altura - bottom.grosorPt, hPt: bottom.grosorPt, xPt: p.xStart, wPt: p.wPt, color: bottom.color });
    });
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
      if (participaEnMerge(i)) { av.mergeDemasiadoAlto++; filasFlow.push(armarFila(i, lineas[i]!, alturas[i]!, false, i === t.filas.length - 1 ? 'tabla' : 'ninguno')); return; }
      av.filasPartidas++;
      const trozos = partirLineas(lineas[i]!, maxFila - TABLA_PAD_Y_PT * 2);
      trozos.forEach((tr, c) => {
        const alto = Math.max(14, ...tr.map((ls) => altoContenido(ls)));
        filasFlow.push(armarFila(i, tr, alto, false, c < trozos.length - 1 ? 'interno' : i === t.filas.length - 1 ? 'tabla' : 'ninguno'));
      });
      return;
    }
    const fila = armarFila(i, lineas[i]!, alturas[i]!, f.esEncabezado, i === t.filas.length - 1 ? 'tabla' : 'ninguno');
    filasFlow.push(fila);
    if (f.esEncabezado) encabezados.push(fila);
  });

  return [
    { kind: 'gap', height: 6, bars: [] },
    { kind: 'tableStart', headerRows: encabezados },
    ...filasFlow,
    { kind: 'tableEnd' },
    { kind: 'gap', height: 8, bars: [] }
  ];
}

function mensajesTabla(av: AvisosTabla): Advertencia[] {
  const out: Advertencia[] = [];
  const c = (n: number, uno: string, varios: string): string => (n === 1 ? uno : varios.replace('{n}', String(n)));
  if (av.filasPartidas > 0) out.push(aproximado(c(av.filasPartidas, 'Una fila de tabla era más alta que una página y se partió por líneas entre páginas.', '{n} filas de tabla eran más altas que una página y se partieron por líneas entre páginas.')));
  if (av.mergeDemasiadoAlto > 0) out.push(aproximado(c(av.mergeDemasiadoAlto, 'Una fila con celdas combinadas verticalmente es más alta que una página y no se pudo partir: parte de su contenido puede quedar fuera de la página.', '{n} filas con celdas combinadas verticalmente son más altas que una página y no se pudieron partir: parte de su contenido puede quedar fuera de la página.')));
  if (av.gridAmpliado > 0) out.push(aproximado(c(av.gridAmpliado, 'Una tabla tenía filas con más celdas que columnas en su rejilla; se ampliaron las columnas (72 pt cada una) para no perder celdas.', '{n} tablas tenían filas con más celdas que columnas en su rejilla; se ampliaron las columnas (72 pt cada una) para no perder celdas.')));
  if (av.anchoEscalado > 0) out.push(aproximado(c(av.anchoEscalado, 'Una tabla más ancha que la página se escaló proporcionalmente al ancho útil.', '{n} tablas más anchas que la página se escalaron proporcionalmente al ancho útil.')));
  if (av.zonaAcotada > 0) out.push(aproximado(c(av.zonaAcotada, 'Un encabezado o pie era más alto de lo permitido (un tercio de la página): se redujeron sus imágenes y se recortó lo que no cabía.', '{n} encabezados o pies eran más altos de lo permitido (un tercio de la página): se redujeron sus imágenes y se recortó lo que no cabía.')));
  if (av.saltoEnZona > 0) out.push(aproximado(c(av.saltoEnZona, 'Un salto de página dentro de un encabezado o pie se ignoró.', '{n} saltos de página dentro de encabezados o pies se ignoraron.')));
  return out;
}

/** Un bloque del documento ya convertido a ítems de flujo, con sus banderas de "mantener junto". */
interface BloqueRenderizado { items: FlowItem[]; keepNext: boolean; keepLines: boolean }

const KS: FlowItem = { kind: 'keepStart' };
const KE: FlowItem = { kind: 'keepEnd' };

/** Índice del último ítem que es una línea (o -1). */
function ultimaLinea(items: FlowItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.kind === 'line') return i;
  return -1;
}
/** Índice del primer ítem con contenido (línea, imagen o fila de tabla), o el último si no hay. */
function primerContenido(items: FlowItem[]): number {
  const i = items.findIndex((it) => it.kind === 'line' || it.kind === 'image' || it.kind === 'tableRow');
  return i === -1 ? items.length - 1 : i;
}

/**
 * Aplica `w:keepNext`/`w:keepLines` (fase 2b) envolviendo en `keepStart`/`keepEnd` lo que debe quedar junto:
 * - `keepLines`: todo el párrafo en una página.
 * - `keepNext` (sin `keepLines`): la ÚLTIMA línea del párrafo con el contenido que sigue.
 * - Una cadena de `keepNext` se mantiene toda junta y termina en la primera línea (o fila) del primer bloque sin `keepNext`.
 * Un grupo más alto que una página lo ignora `paginar` (no se puede mantener junto).
 */
function agruparKeep(bloques: BloqueRenderizado[]): FlowItem[] {
  const out: FlowItem[] = [];
  let abierto = false; // hay un `keepStart` sin cerrar: el bloque anterior pidió "con el siguiente"
  for (const b of bloques) {
    const { items } = b;
    if (!abierto) {
      if (!b.keepNext && !b.keepLines) { out.push(...items); continue; }
      const inicio = b.keepLines ? 0 : Math.max(0, ultimaLinea(items));
      out.push(...items.slice(0, inicio), KS, ...items.slice(inicio));
      if (b.keepNext) abierto = true; else out.push(KE);
      continue;
    }
    if (b.keepNext || b.keepLines) {
      out.push(...items);
      if (!b.keepNext) { out.push(KE); abierto = false; }
      continue;
    }
    const corte = primerContenido(items);
    out.push(...items.slice(0, corte + 1), KE, ...items.slice(corte + 1));
    abierto = false;
  }
  if (abierto) out.push(KE);
  return out;
}

/** Fracción de la altura de página que puede ocupar como máximo un encabezado o pie (si no, el cuerpo se quedaría sin sitio). */
const ZONA_FRACCION_MAXIMA = 0.33;

/**
 * Acota un encabezado o pie a la altura permitida: primero se reducen (proporcionalmente) las imágenes más altas que la
 * mitad del máximo y, si aun así no cabe, se recorta lo último. Cualquiera de las dos cosas se AVISA (aproximado).
 */
function acotarZona(items: FlowItem[], alturaPaginaPt: number, av: AvisosTabla): FlowItem[] {
  const max = alturaPaginaPt * ZONA_FRACCION_MAXIMA;
  if (altoZona(items) <= max) return items;
  av.zonaAcotada++;
  let res = items.map((it): FlowItem => (it.kind === 'image' && it.height > max / 2 ? { ...it, wPt: (it.wPt * (max / 2)) / it.height, height: max / 2 } : it));
  while (res.length > 0 && altoZona(res) > max) res = res.slice(0, -1);
  return res;
}

/** Contenido de un encabezado o pie para una página concreta (párrafos, imágenes y tablas): sin huecos al principio/final ni saltos de página. */
function itemsDeZona(bloques: BloqueDocx[], sec: SeccionDocx, medir: Medir, campos: ValoresCampo, av: AvisosTabla, opc: OpcionesFlujo): FlowItem[] {
  const items: FlowItem[] = [];
  for (const b of bloques) {
    if (esParrafo(b)) items.push(...renderizarParrafo(b, sec.margenIzqPt, sec.margenDerPt, sec.paginaAnchoPt, medir, campos, opc));
    else if (esTabla(b)) items.push(...renderizarTabla(b, sec.margenIzqPt, sec.margenDerPt, sec.paginaAnchoPt, sec.paginaAltoPt * ZONA_FRACCION_MAXIMA, medir, av));
  }
  const utiles = items.filter((it) => {
    if (it.kind === 'pagebreak') { av.saltoEnZona++; return false; }
    return it.kind !== 'keepStart' && it.kind !== 'keepEnd';
  });
  while (utiles.length > 0 && utiles[0]!.kind === 'gap') utiles.shift();
  while (utiles.length > 0 && utiles[utiles.length - 1]!.kind === 'gap') utiles.pop();
  return acotarZona(utiles, sec.paginaAltoPt, av);
}

/**
 * Qué zona (default/first/even) toca en una página: `first` en la primera página de la SECCIÓN si esta tiene `titlePg`;
 * `even` en las pares (por su número VISIBLE) con `evenAndOddHeaders`. `null` = esa página no lleva nada.
 */
function zonaDePagina(z: ZonaPaginaModelo, primeraDeSeccion: boolean, numero: number, sec: SeccionDocx, modelo: ModeloDocx): BloqueDocx[] | null {
  if (sec.tituloPagina && primeraDeSeccion) return z.first;
  if (modelo.paresImpares && numero % 2 === 0) return z.even;
  return z.default;
}

/** Sección única deducida de los campos de siempre del modelo (modelos construidos a mano, sin `secciones`). */
function seccionesDe(modelo: ModeloDocx): SeccionDocx[] {
  if (modelo.secciones && modelo.secciones.length > 0) return modelo.secciones;
  return [{
    paginaAnchoPt: modelo.paginaAnchoPt, paginaAltoPt: modelo.paginaAltoPt,
    margenSupPt: modelo.margenSupPt, margenInfPt: modelo.margenInfPt, margenIzqPt: modelo.margenIzqPt, margenDerPt: modelo.margenDerPt,
    margenEncabezadoPt: modelo.margenEncabezadoPt, margenPiePt: modelo.margenPiePt,
    tipo: 'nextPage', tituloPagina: modelo.tituloPagina, encabezados: modelo.encabezados, pies: modelo.pies,
    numeroInicial: null, inicioBloque: 0, finBloque: modelo.bloques.length
  }];
}

/** Geometría DECLARADA de una sección (sin el empuje de sus encabezados/pies). */
function geoDeclarada(sec: SeccionDocx): PageGeometry {
  return { widthPt: sec.paginaAnchoPt, heightPt: sec.paginaAltoPt, marginTopPt: sec.margenSupPt, marginBottomPt: sec.margenInfPt, marginLeftPt: sec.margenIzqPt, marginRightPt: sec.margenDerPt };
}

export function renderizarModeloDocx(modelo: ModeloDocx, medir: Medir): ResultadoLayout {
  const av = nuevosAvisos();
  const secciones = seccionesDe(modelo);
  // Con alguna flotante que el texto rodea, TODOS los párrafos del cuerpo se maquetan línea a línea (cada uno puede cruzarse con la caja).
  const hayAjuste = modelo.bloques.some((b) => esParrafo(b) && b.partes.some((x) => x.tipo === 'imagen' && x.flotante?.ajuste));
  const tabDefectoPt = modelo.tabPorDefectoPt ?? 36;
  const opcCuerpo: OpcionesFlujo = { flex: hayAjuste, tabDefectoPt };
  const opcZona: OpcionesFlujo = { flex: false, tabDefectoPt };

  // Los encabezados/pies mas altos que el margen empujan el cuerpo (como Word): por sección, el área útil se calcula con el
  // más alto de los tipos que se llegan a usar (first solo con titlePg, even solo con evenAndOddHeaders). Cada zona distinta
  // se mide con los avisos reales UNA vez (varias secciones pueden compartirla); el resto de pasadas usan contadores desechables.
  const contadas = new Set<BloqueDocx[]>();
  const usados = (z: ZonaPaginaModelo, sec: SeccionDocx): BloqueDocx[][] => [z.default, sec.tituloPagina ? z.first : null, modelo.paresImpares ? z.even : null].filter((x): x is BloqueDocx[] => x !== null);
  const altoMax = (z: ZonaPaginaModelo, sec: SeccionDocx): number => usados(z, sec).reduce((m, bs) => {
    const avZona = contadas.has(bs) ? nuevosAvisos() : av;
    contadas.add(bs);
    return Math.max(m, altoZona(itemsDeZona(bs, sec, medir, { pagina: 888, total: 888 }, avZona, opcZona)));
  }, 0);

  const items: FlowItem[] = [];
  const geos: PageGeometry[] = [];
  secciones.forEach((sec, idx) => {
    const altoCab = altoMax(sec.encabezados, sec);
    const altoPie = altoMax(sec.pies, sec);
    const geo: PageGeometry = {
      widthPt: sec.paginaAnchoPt, heightPt: sec.paginaAltoPt,
      marginTopPt: altoCab > 0 ? Math.max(sec.margenSupPt, sec.margenEncabezadoPt + altoCab) : sec.margenSupPt,
      marginBottomPt: altoPie > 0 ? Math.max(sec.margenInfPt, sec.margenPiePt + altoPie) : sec.margenInfPt,
      marginLeftPt: sec.margenIzqPt, marginRightPt: sec.margenDerPt
    };
    geos.push(geo);
    // Una sección final sin ningún bloque no abre una página en blanco.
    if (idx > 0 && sec.finBloque === sec.inicioBloque) return;
    items.push({ kind: 'section', geo, continua: sec.tipo === 'continuous' && idx > 0, seccion: idx });
    const alturaUtilPt = geo.heightPt - geo.marginTopPt - geo.marginBottomPt;
    const bloques: BloqueRenderizado[] = [];
    for (const bloque of modelo.bloques.slice(sec.inicioBloque, sec.finBloque)) {
      if (esParrafo(bloque)) bloques.push({ items: renderizarParrafo(bloque, sec.margenIzqPt, sec.margenDerPt, sec.paginaAnchoPt, medir, null, opcCuerpo), keepNext: bloque.mantenerConSiguiente, keepLines: bloque.mantenerLineasJuntas });
      else if (esTabla(bloque)) bloques.push({ items: renderizarTabla(bloque, sec.margenIzqPt, sec.margenDerPt, sec.paginaAnchoPt, alturaUtilPt, medir, av), keepNext: false, keepLines: false });
    }
    items.push(...agruparKeep(bloques));
  });

  // Fracción de línea donde cae la línea base: mismo valor que Markdown
  // (`BASELINE_FRACTION`) y que `TABLA_BASELINE_FRACTION` de arriba,
  // aproximación documentada en `../markdown/layout.ts`.
  const res = paginar(items, geos[0]!, TABLA_BASELINE_FRACTION);

  // Segunda pasada: con el total de páginas conocido, cada página recibe el encabezado y el pie de SU sección (PAGE/NUMPAGES
  // ya resueltos). El número visible reinicia con `w:pgNumType w:start` en la primera página de una sección.
  const trazos = [...res.trazos], barras = [...res.barras], imagenes = [...res.imagenes], enlaces = [...res.enlaces];
  let numero = 0;
  let seccionPrevia = -1;
  for (let n = 0; n < res.totalPaginas; n++) {
    const info = res.paginas[n]!;
    const sec = secciones[info.seccion] ?? secciones[0]!;
    const primeraDeSeccion = info.seccion !== seccionPrevia;
    seccionPrevia = info.seccion;
    numero = primeraDeSeccion && sec.numeroInicial !== null ? sec.numeroInicial : numero + 1;
    const campos: ValoresCampo = { pagina: numero, total: res.totalPaginas };
    const pagina = { widthPt: info.geo.widthPt, heightPt: info.geo.heightPt };
    for (const [z, ancla, dist] of [[sec.encabezados, 'arriba', sec.margenEncabezadoPt], [sec.pies, 'abajo', sec.margenPiePt]] as const) {
      const bs = zonaDePagina(z, primeraDeSeccion, numero, sec, modelo);
      if (!bs || bs.length === 0) continue;
      const itemsZona = itemsDeZona(bs, sec, medir, campos, nuevosAvisos(), opcZona);
      if (itemsZona.length === 0) continue;
      const zona = colocarZona(itemsZona, pagina, ancla, dist, n, TABLA_BASELINE_FRACTION, geoDeclarada(sec));
      trazos.push(...zona.trazos); barras.push(...zona.barras); imagenes.push(...zona.imagenes); enlaces.push(...zona.enlaces);
    }
  }
  return { totalPaginas: res.totalPaginas, trazos, barras, imagenes, enlaces, advertencias: [...mensajesTabla(av), ...res.advertencias], paginas: res.paginas };
}
