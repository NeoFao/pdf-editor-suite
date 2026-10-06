import { aproximado, type Advertencia } from '../advertencia';

/**
 * Maquetador de flujo COMÚN, generalizado a partir de `../markdown/layout.ts`
 * (§9 fila #4 y fila #32). Ambos conversores (Markdown y DOCX) construyen su
 * propio árbol de "ítems de flujo" (líneas, huecos, reglas) a partir de su
 * modelo de documento respectivo, y este módulo hace las dos partes que NO
 * dependen de qué formato de origen se trate: el ajuste de línea (con
 * alineación) y la paginación.
 *
 * PURO a propósito (igual que el módulo del que viene): no toca el motor ni
 * el DOM. `medir` sigue siendo una función inyectada.
 *
 * Alineación: `left` coloca cada línea pegada al margen izquierdo (igual que
 * el comportamiento previo, sin cambios). `center`/`right` desplazan la línea
 * ya maquetada según el ancho natural que ocupa. `justify` reparte el espacio
 * sobrante entre las palabras de la línea (excepto la ÚLTIMA línea del
 * párrafo, que Word e InDesign dejan alineada a la izquierda — así lo pide
 * el spec) — por eso NO fusiona palabras consecutivas del mismo estilo en un
 * solo trazo como sí hace `left`/`center`/`right`: cada hueco entre palabras
 * puede tener un ancho distinto, así que cada palabra necesita su propia
 * coordenada x.
 */

export type RGB = [number, number, number];

/** Ancho en puntos PDF de `text` en la fuente `fontName` al tamaño `sizePt`. Inyectada por quien llama. */
export type Medir = (fontName: string, sizePt: number, text: string) => number;

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface Atom {
  text: string; font: string; sizePt: number; color: RGB;
  /**
   * `true` si este átomo va PEGADO al anterior, sin espacio entre ambos —
   * p. ej. un documento DOCX donde una palabra y la coma que la sigue vienen
   * en dos `w:r` (runs) distintos por tener formato distinto (uno en
   * negrita, la coma sin formato) pero SIN espacio real entre ellos en el
   * texto original. Sin esto, el ajuste de línea (pensado para palabras de
   * Markdown, siempre separadas por espacio) insertaría un espacio de más
   * entre la palabra y la coma. Markdown nunca lo usa (siempre `undefined`,
   * equivalente a `false`): mismo comportamiento de siempre.
   */
  pegado?: boolean;
  /**
   * URL del enlace clicable que cubre este átomo (fase 2a: enlaces en DOCX y
   * Markdown), o `undefined` si el átomo no forma parte de ningún enlace.
   * Dos átomos consecutivos con URLs distintas (o uno con y otro sin URL)
   * nunca se fusionan en el mismo trazo (`lineToFlowLine`), aunque
   * compartan fuente/tamaño/color — cada `Seg` resultante necesita su
   * propia caja para la anotación `/Link` (`paginar` la añade a `enlaces`
   * cuando `Seg.url` está presente).
   */
  url?: string;
  /** `true` si este átomo lleva subrayado (`w:u` de DOCX, o un enlace sin estilo propio que lo fuerza a `true`). `paginar` dibuja una barra fina bajo la línea base por cada `Seg` con `underline: true`. */
  underline?: boolean;
}

export interface Trazo {
  page: number;
  xPt: number;
  /** Línea base, en puntos PDF (origen abajo-izquierda de la página). */
  yPt: number;
  text: string;
  font: string;
  sizePt: number;
  color: RGB;
}

/** Rectángulo relleno: regla horizontal, fondo de código, barra de cita o de lista. */
export interface Barra {
  page: number;
  xPt: number;
  yPt: number;
  wPt: number;
  hPt: number;
  color: RGB;
}

/** Imagen ya colocada en una página concreta, en puntos PDF (origen abajo-izquierda). `imgId` referencia el registro de imágenes decodificadas del conversor. */
export interface ImagenColocada { page: number; xPt: number; yPt: number; wPt: number; hPt: number; imgId: string }
/** Enlace clicable ya colocado en una página concreta, en puntos PDF (origen abajo-izquierda) — listo para `PdfEngine.addLink`. */
export interface EnlaceColocado { page: number; xPt: number; yPt: number; wPt: number; hPt: number; url: string }

export interface ResultadoLayout {
  totalPaginas: number;
  trazos: Trazo[];
  barras: Barra[];
  imagenes: ImagenColocada[];
  enlaces: EnlaceColocado[];
  /** Avisos generados al paginar (p. ej. una combinación vertical de celdas que cruza un salto de página). */
  advertencias: Advertencia[];
}

export interface Seg {
  xPt: number; text: string; font: string; sizePt: number; color: RGB;
  /** URL del enlace clicable que cubre este trazo (ver `Atom.url`), o `undefined`. */
  url?: string;
  /**
   * Ancho en puntos PDF de `text` (ya medido por `lineToFlowLine`). Se usa
   * para calcular la caja del enlace clicable cuando `url` está presente y
   * el ancho de la barra de subrayado cuando `underline` lo está —
   * `paginar` no tiene acceso a `medir`, así que el ancho debe venir ya
   * calculado. Opcional para no romper construcciones de `Seg` en tests que
   * no lo necesitan (sin `url`/`underline` tampoco hace falta).
   */
  wPt?: number;
  /** Ver `Atom.underline`. */
  underline?: boolean;
}
export interface BarSeg { xPt: number; wPt: number; color: RGB }
export interface BgSeg { xPt: number; wPt: number; color: RGB }

export interface FlowLine { kind: 'line'; height: number; segs: Seg[]; bars: BarSeg[]; bg?: BgSeg; keepWithNextHeight?: number }
export interface FlowGap { kind: 'gap'; height: number; bars: BarSeg[] }
export interface FlowRule { kind: 'rule'; height: number; xPt: number; wPt: number; color: RGB; bars: BarSeg[] }
/** Salto de página explícito (`w:br w:type="page"` o `w:pageBreakBefore` en DOCX). Markdown no lo usa. */
export interface FlowPageBreak { kind: 'pagebreak' }

/** Imagen colocada como bloque propio del flujo (fase 2a: `w:drawing` inline en DOCX). `imgId` referencia el registro de imágenes decodificadas que mantiene el conversor — el maquetador nunca toca bytes de imagen (sigue puro). */
export interface FlowImage { kind: 'image'; height: number; xPt: number; wPt: number; imgId: string }

/** Línea de texto de una celda, POSICIONADA en x absoluto de página pero en y RELATIVO al borde SUPERIOR de la fila (positivo hacia abajo) — `paginar` no conoce la posición vertical de la fila hasta que le toca el turno. */
export interface RelLinea { relYPt: number; segs: Seg[] }
/** Rectángulo relleno (fondo de celda o segmento de borde) relativo al borde SUPERIOR de la fila, igual convención que `RelLinea`. */
export interface RelBarra { relYPt: number; hPt: number; xPt: number; wPt: number; color: RGB }

/**
 * Fila de tabla (fase 2a, §9 fila #4), tratada como bloque ATÓMICO por
 * `paginar`: si no cabe entera en lo que queda de página, la fila COMPLETA
 * pasa a la siguiente (nunca se corta a mitad de fila) — salvo que sea más
 * alta que una página entera, caso que el llamador debe partir aparte y
 * avisar (ver `docx/render.ts`). `esEncabezado` marca las filas que
 * `paginar` debe repetir automáticamente al principio de cada página nueva
 * mientras dure la tabla (entre el `FlowTableStart` que las declara y el
 * `FlowTableEnd` correspondiente).
 */
export interface FlowTableRow {
  kind: 'tableRow'; height: number; lineas: RelLinea[]; fondos: RelBarra[]; bordes: RelBarra[]; esEncabezado: boolean;
  /** Ids de combinaciones verticales (`w:vMerge`) que EMPIEZAN en esta fila. */
  mergeInicio?: number[];
  /** Ids de combinaciones verticales que CONTINÚAN en esta fila (la celda ocupa también las filas anteriores del grupo). `paginar` avisa si la fila cae en una página distinta a la del inicio del grupo. */
  mergeContinua?: number[];
}
/** Abre una tabla: `headerRows` son las filas (ya construidas como `FlowTableRow`) que `paginar` repite tras cada salto de página dentro de esta tabla. */
export interface FlowTableStart { kind: 'tableStart'; headerRows: FlowTableRow[] }
/** Cierra la tabla abierta por el último `FlowTableStart`: deja de repetir encabezado tras este punto. */
export interface FlowTableEnd { kind: 'tableEnd' }

/**
 * Marcadores de grupo "mantener juntos" (fase 2b: `w:keepNext`/`w:keepLines`
 * de DOCX). Todo lo que hay entre un `keepStart` y su `keepEnd` se trata como
 * un bloque indivisible: si no cabe entero en lo que queda de la página y sí
 * cabría en una página nueva, `paginar` salta de página ANTES de empezarlo.
 * Un grupo más alto que una página entera se ignora (no se puede mantener
 * junto): fluye con normalidad. No se anidan: un `keepStart` abre un grupo
 * plano que termina en el siguiente `keepEnd` (o en un salto de página).
 */
export interface FlowKeepStart { kind: 'keepStart' }
export interface FlowKeepEnd { kind: 'keepEnd' }

/** Posición horizontal de una imagen flotante, en PUNTOS PDF (no EMU), respecto a `rel`. Con `align` se ignora `offsetPt`. */
export interface PosFlotanteH { rel: 'page' | 'margin' | 'leftMargin' | 'rightMargin'; offsetPt?: number; align?: 'left' | 'center' | 'right' }
/** Posición vertical de una imagen flotante, en puntos PDF medidos HACIA ABAJO desde el borde superior de `rel` (`paragraph` = tope del párrafo que la ancla). */
export interface PosFlotanteV { rel: 'page' | 'margin' | 'topMargin' | 'bottomMargin' | 'paragraph'; offsetPt?: number; align?: 'top' | 'center' | 'bottom' }

/**
 * Imagen flotante (`wp:anchor` de DOCX, fase 2b), SIN ajuste de texto: ocupa
 * 0 pt de flujo (el texto no la rodea, queda por encima) y `paginar` la
 * coloca en la página del siguiente contenido, en su posición absoluta o
 * relativa al margen/párrafo.
 */
export interface FlowFloatImage { kind: 'floatImage'; imgId: string; wPt: number; hPt: number; h: PosFlotanteH; v: PosFlotanteV }

export type FlowItem = FlowLine | FlowGap | FlowRule | FlowPageBreak | FlowImage | FlowTableRow | FlowTableStart | FlowTableEnd | FlowKeepStart | FlowKeepEnd | FlowFloatImage;

/** Tamaño y márgenes de una página, en puntos PDF. */
export interface PageGeometry {
  widthPt: number;
  heightPt: number;
  marginTopPt: number;
  marginBottomPt: number;
  marginLeftPt: number;
  marginRightPt: number;
}

export function sameColor(a: RGB, b: RGB): boolean { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

/**
 * Empaqueta átomos en líneas sin superar `maxWidthPt`, midiendo con `medir`.
 * Una palabra más ancha que `maxWidthPt` por sí sola ocupa su propia línea
 * igualmente (esta fase no parte palabras).
 */
export function wrapAtoms(atoms: Atom[], maxWidthPt: number, medir: Medir): Atom[][] {
  const lines: Atom[][] = [];
  let current: Atom[] = [];
  let width = 0;
  for (const atom of atoms) {
    const wordWidth = medir(atom.font, atom.sizePt, atom.text);
    const spaceWidth = current.length > 0 && !atom.pegado ? medir(atom.font, atom.sizePt, ' ') : 0;
    if (current.length > 0 && width + spaceWidth + wordWidth > maxWidthPt) {
      lines.push(current);
      current = [atom];
      width = wordWidth;
    } else {
      current.push(atom);
      width += spaceWidth + wordWidth;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/**
 * Convierte una línea ya envuelta (un array de átomos) en su `FlowLine`
 * final, con la alineación pedida. `xStartPt` es el margen izquierdo del
 * bloque (margen de página + sangría); `maxWidthPt` el ancho disponible
 * (para centrar/justificar/alinear a la derecha). `isLastLine` desactiva
 * `justify` (cae a `left`) para la última línea de un párrafo.
 */
export function lineToFlowLine(
  atoms: Atom[], xStartPt: number, maxWidthPt: number, align: Align, isLastLine: boolean, height: number, medir: Medir
): FlowLine {
  if (atoms.length === 0) return { kind: 'line', height, segs: [], bars: [] };

  const efectiva: Align = align === 'justify' && (isLastLine || atoms.length === 1) ? 'left' : align;

  if (efectiva === 'justify') {
    const anchos = atoms.map((a) => medir(a.font, a.sizePt, a.text));
    // Un hueco "pegado" (el átomo siguiente no lleva espacio real delante)
    // no cuenta como hueco distribuible ni lleva el espacio normal — si no,
    // el justificado separaría una palabra de la coma que la sigue.
    const espacios = atoms.slice(0, -1).map((a, i) => (atoms[i + 1]!.pegado ? 0 : medir(a.font, a.sizePt, ' ')));
    const anchoNatural = anchos.reduce((s, w) => s + w, 0) + espacios.reduce((s, w) => s + w, 0);
    const huecosDistribuibles = atoms.slice(1).filter((a) => !a.pegado).length;
    const extraPorHueco = huecosDistribuibles > 0 ? Math.max(0, (maxWidthPt - anchoNatural) / huecosDistribuibles) : 0;
    const segs: Seg[] = [];
    let x = xStartPt;
    atoms.forEach((a, i) => {
      segs.push({ xPt: x, text: a.text, font: a.font, sizePt: a.sizePt, color: a.color, url: a.url, wPt: anchos[i], underline: a.underline });
      x += anchos[i]!;
      if (i < atoms.length - 1) x += espacios[i]! + (atoms[i + 1]!.pegado ? 0 : extraPorHueco);
    });
    return { kind: 'line', height, segs, bars: [] };
  }

  // left/center/right: fusiona palabras consecutivas del mismo estilo en un
  // solo trazo (menos objetos de texto en el PDF final — ver el comentario
  // de `lineToFlowLine` original en markdown/layout.ts para la justificación
  // de rendimiento).
  const segs: Seg[] = [];
  let x = 0;
  let i = 0;
  while (i < atoms.length) {
    const a = atoms[i]!;
    let text = a.text;
    let j = i + 1;
    // La fusión por MISMO estilo sigue igual, pero un átomo "pegado" se
    // concatena SIN el espacio de unión (sigue siendo un solo trazo porque
    // comparte estilo con `a` — un átomo pegado de OTRO estilo, como una
    // coma normal tras una palabra en negrita, no se fusiona aquí: rompe el
    // bucle por estilo distinto y se resuelve más abajo, sin espacio entre
    // ambos trazos). La URL del enlace también forma parte del "estilo": dos
    // átomos con URLs distintas (o uno con y otro sin) nunca se fusionan,
    // cada uno necesita su propia caja de anotación `/Link`.
    while (j < atoms.length && atoms[j]!.font === a.font && atoms[j]!.sizePt === a.sizePt && sameColor(atoms[j]!.color, a.color) && atoms[j]!.url === a.url && !!atoms[j]!.underline === !!a.underline) {
      text += (atoms[j]!.pegado ? '' : ' ') + atoms[j]!.text;
      j++;
    }
    const anchoSeg = medir(a.font, a.sizePt, text);
    segs.push({ xPt: x, text, font: a.font, sizePt: a.sizePt, color: a.color, url: a.url, wPt: anchoSeg, underline: a.underline });
    x += anchoSeg;
    if (j < atoms.length && !atoms[j]!.pegado) x += medir(a.font, a.sizePt, ' ');
    i = j;
  }
  const anchoNatural = x;
  const offset = efectiva === 'center' ? (maxWidthPt - anchoNatural) / 2
    : efectiva === 'right' ? maxWidthPt - anchoNatural
      : 0;
  const desplazar = xStartPt + Math.max(0, offset);
  for (const s of segs) s.xPt += desplazar;
  return { kind: 'line', height, segs, bars: [] };
}

/**
 * Reparte los ítems de flujo en páginas de tamaño `geo`, saltando de página
 * cuando un ítem (más su posible "no huérfano") no cabe en lo que queda, o
 * cuando aparece un `FlowPageBreak` explícito (solo si ya se pintó algo en
 * la página actual — un salto de página al principio del documento, sin
 * contenido previo, no genera una página en blanco de más).
 */
export function paginar(items: FlowItem[], geo: PageGeometry, baselineFraction: number): ResultadoLayout {
  const trazos: Trazo[] = [];
  const barras: Barra[] = [];
  const imagenes: ImagenColocada[] = [];
  const enlaces: EnlaceColocado[] = [];
  let page = 0;
  const topPt = geo.heightPt - geo.marginTopPt;
  const bottomPt = geo.marginBottomPt;
  let cursor = topPt;
  let skipLeadingGaps = false;
  let pintadoEnPagina = false;
  // Encabezado(s) de la tabla actualmente abierta (entre FlowTableStart y
  // FlowTableEnd): se repiten al principio de cada página nueva mientras
  // dure la tabla. Como este maquetador no admite tablas anidadas, basta con
  // una sola "tabla activa" a la vez.
  let encabezadosTabla: FlowTableRow[] = [];
  // Página en la que se colocó la última fila de cada combinación vertical; si una continuación cae en otra, esa combinación queda cortada por el salto.
  const paginaDeMerge = new Map<number, number>();
  const mergesPartidos = new Set<number>();

  function nuevaPagina(): void {
    page++;
    cursor = topPt;
    skipLeadingGaps = true;
    pintadoEnPagina = false;
  }

  /**
   * Barra fina de subrayado bajo la línea base de `seg`, si `seg.underline`
   * está activo (y se conoce su ancho, `seg.wPt`) — proporción típica de un
   * subrayado tipográfico: ~10% del tamaño de fuente por debajo de la línea
   * base, ~6% de grosor (mínimo 0.6pt para tamaños muy pequeños).
   */
  function barraSubrayado(seg: Seg, baseline: number): Barra | null {
    if (!seg.underline || !seg.wPt) return null;
    return { page, xPt: seg.xPt, yPt: baseline - seg.sizePt * 0.1, wPt: seg.wPt, hPt: Math.max(0.6, seg.sizePt * 0.06), color: seg.color };
  }

  /** Coloca una fila de tabla YA en la página/cursor actuales (no decide paginación: eso lo hace el llamador). */
  function colocarFila(row: FlowTableRow): void {
    for (const id of row.mergeContinua ?? []) if (paginaDeMerge.get(id) !== page) mergesPartidos.add(id);
    for (const id of [...(row.mergeInicio ?? []), ...(row.mergeContinua ?? [])]) paginaDeMerge.set(id, page);
    for (const f of row.fondos) {
      barras.push({ page, xPt: f.xPt, yPt: cursor - f.relYPt - f.hPt, wPt: f.wPt, hPt: f.hPt, color: f.color });
    }
    for (const linea of row.lineas) {
      const baseline = cursor - linea.relYPt;
      for (const seg of linea.segs) {
        trazos.push({ page, xPt: seg.xPt, yPt: baseline, text: seg.text, font: seg.font, sizePt: seg.sizePt, color: seg.color });
        if (seg.url && seg.wPt) enlaces.push({ page, xPt: seg.xPt, yPt: baseline - seg.sizePt * 0.2, wPt: seg.wPt, hPt: seg.sizePt * 1.1, url: seg.url });
        const subrayado = barraSubrayado(seg, baseline);
        if (subrayado) barras.push(subrayado);
      }
    }
    for (const b of row.bordes) {
      barras.push({ page, xPt: b.xPt, yPt: cursor - b.relYPt - b.hPt, wPt: b.wPt, hPt: b.hPt, color: b.color });
    }
    pintadoEnPagina = true;
    cursor -= row.height;
  }

  // Imágenes flotantes a la espera de la página y el cursor definitivos del siguiente contenido.
  const flotantesPendientes: FlowFloatImage[] = [];
  function colocarFlotantes(): void {
    for (const f of flotantesPendientes) {
      const { x, yTop } = posicionFlotante(f, geo, cursor);
      imagenes.push({ page, xPt: x, yPt: geo.heightPt - yTop - f.hPt, wPt: f.wPt, hPt: f.hPt, imgId: f.imgId });
      pintadoEnPagina = true;
    }
    flotantesPendientes.length = 0;
  }

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx]!;
    if (item.kind === 'tableStart') { encabezadosTabla = item.headerRows; continue; }
    if (item.kind === 'tableEnd') { encabezadosTabla = []; continue; }
    if (item.kind === 'keepEnd') continue;
    if (item.kind === 'floatImage') { flotantesPendientes.push(item); continue; }
    if (item.kind === 'keepStart') {
      // Altura total del grupo (hasta su `keepEnd` o un salto de página explícito).
      let total = 0;
      for (let j = idx + 1; j < items.length; j++) {
        const q = items[j]!;
        if (q.kind === 'keepEnd' || q.kind === 'pagebreak' || q.kind === 'keepStart') break;
        total += alturaDeFlujo(q);
      }
      if (cursor < topPt && cursor - total < bottomPt && total <= topPt - bottomPt) nuevaPagina();
      continue;
    }

    if (item.kind === 'pagebreak') {
      colocarFlotantes();
      if (pintadoEnPagina) nuevaPagina();
      continue;
    }

    if (skipLeadingGaps) {
      if (item.kind === 'gap') continue;
      skipLeadingGaps = false;
    }

    if (item.kind === 'tableRow') {
      if (cursor - item.height < bottomPt && cursor < topPt) {
        nuevaPagina();
        // Repite el encabezado en la página nueva, salvo si la fila que
        // provocó el salto es ella misma una fila de encabezado (evita
        // duplicarla / recursión cuando el propio encabezado es lo primero
        // de la tabla en la página nueva).
        if (!item.esEncabezado) for (const h of encabezadosTabla) colocarFila(h);
      }
      colocarFlotantes();
      colocarFila(item);
      continue;
    }

    if (item.kind === 'image') {
      if (cursor - item.height < bottomPt && cursor < topPt) nuevaPagina();
      colocarFlotantes();
      const bottom = cursor - item.height;
      imagenes.push({ page, xPt: item.xPt, yPt: bottom, wPt: item.wPt, hPt: item.height, imgId: item.imgId });
      pintadoEnPagina = true;
      cursor = bottom;
      continue;
    }

    const extra = item.kind === 'line' ? (item.keepWithNextHeight ?? 0) : 0;
    const needed = item.height + extra;
    if (cursor - needed < bottomPt && cursor < topPt) {
      nuevaPagina();
      if (item.kind === 'gap') continue;
    }

    if (item.kind === 'line' || item.kind === 'rule') colocarFlotantes();
    const bottom = cursor - item.height;

    if (item.kind === 'line') {
      const baseline = bottom + item.height * baselineFraction;
      for (const seg of item.segs) {
        trazos.push({ page, xPt: seg.xPt, yPt: baseline, text: seg.text, font: seg.font, sizePt: seg.sizePt, color: seg.color });
        if (seg.url && seg.wPt) enlaces.push({ page, xPt: seg.xPt, yPt: baseline - seg.sizePt * 0.2, wPt: seg.wPt, hPt: seg.sizePt * 1.1, url: seg.url });
        const subrayado = barraSubrayado(seg, baseline);
        if (subrayado) barras.push(subrayado);
        pintadoEnPagina = true;
      }
      if (item.bg) { barras.push({ page, xPt: item.bg.xPt, yPt: bottom, wPt: item.bg.wPt, hPt: item.height, color: item.bg.color }); pintadoEnPagina = true; }
      for (const bar of item.bars) { barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color }); pintadoEnPagina = true; }
    } else if (item.kind === 'rule') {
      barras.push({ page, xPt: item.xPt, yPt: bottom + (item.height - 1) / 2, wPt: item.wPt, hPt: 1, color: item.color });
      for (const bar of item.bars) barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color });
      pintadoEnPagina = true;
    } else {
      for (const bar of item.bars) { barras.push({ page, xPt: bar.xPt, yPt: bottom, wPt: bar.wPt, hPt: item.height, color: bar.color }); pintadoEnPagina = true; }
    }

    cursor = bottom;
  }

  colocarFlotantes();
  const advertencias: Advertencia[] = [];
  if (mergesPartidos.size > 0) {
    const c = mergesPartidos.size;
    advertencias.push(aproximado(`${c === 1 ? 'Una celda combinada verticalmente cruza' : `${c} celdas combinadas verticalmente cruzan`} un salto de página: la celda se muestra cortada en el salto (el texto está en la primera página de la combinación).`));
  }
  return { totalPaginas: page + 1, trazos, barras, imagenes, enlaces, advertencias };
}

/** Altura que un ítem ocupa en el flujo, en puntos PDF (0 para marcadores y flotantes). */
function alturaDeFlujo(item: FlowItem): number {
  return item.kind === 'line' || item.kind === 'gap' || item.kind === 'rule' || item.kind === 'image' || item.kind === 'tableRow' ? item.height : 0;
}

/** Altura total, en puntos PDF, que ocuparían `items` apilados en una zona (encabezado/pie). */
export function altoZona(items: FlowItem[]): number {
  return items.reduce((sum, it) => sum + alturaDeFlujo(it), 0);
}

/**
 * Esquina superior-izquierda de una imagen flotante, en puntos PDF: `x` desde
 * el borde izquierdo de la página, `yTop` HACIA ABAJO desde el borde superior.
 * `cursorPt` es la y PDF (abajo-izquierda) del tope del contenido actual,
 * para `rel: 'paragraph'`.
 */
function posicionFlotante(f: FlowFloatImage, geo: PageGeometry, cursorPt: number): { x: number; yTop: number } {
  const W = geo.widthPt, H = geo.heightPt;
  const [x0, x1] = f.h.rel === 'page' ? [0, W]
    : f.h.rel === 'leftMargin' ? [0, geo.marginLeftPt]
      : f.h.rel === 'rightMargin' ? [W - geo.marginRightPt, W]
        : [geo.marginLeftPt, W - geo.marginRightPt];
  const x = f.h.align === 'left' ? x0
    : f.h.align === 'center' ? x0 + (x1 - x0 - f.wPt) / 2
      : f.h.align === 'right' ? x1 - f.wPt
        : x0 + (f.h.offsetPt ?? 0);
  const [y0, y1] = f.v.rel === 'page' ? [0, H]
    : f.v.rel === 'topMargin' ? [0, geo.marginTopPt]
      : f.v.rel === 'bottomMargin' ? [H - geo.marginBottomPt, H]
        : f.v.rel === 'paragraph' ? [H - cursorPt, H - geo.marginBottomPt]
          : [geo.marginTopPt, H - geo.marginBottomPt];
  const yTop = f.v.align === 'top' ? y0
    : f.v.align === 'center' ? y0 + (y1 - y0 - f.hPt) / 2
      : f.v.align === 'bottom' ? y1 - f.hPt
        : y0 + (f.v.offsetPt ?? 0);
  return { x, yTop };
}

/** Lo que `colocarZona` coloca en UNA página concreta (sin `totalPaginas`: la zona nunca pagina). */
export interface ZonaColocada { trazos: Trazo[]; barras: Barra[]; imagenes: ImagenColocada[]; enlaces: EnlaceColocado[] }

/**
 * Coloca `items` (el contenido de un encabezado o un pie) en la página
 * `page`. `'arriba'`: el borde superior del contenido queda a `distanciaPt`
 * del borde superior de la página (`w:pgMar w:header`). `'abajo'`: el borde
 * inferior queda a `distanciaPt` del inferior (`w:pgMar w:footer`) y el
 * contenido crece hacia arriba. Puro: reutiliza `paginar` sobre una página
 * virtual del alto exacto del contenido y traslada el resultado.
 */
export function colocarZona(
  items: FlowItem[], pagina: { widthPt: number; heightPt: number }, ancla: 'arriba' | 'abajo', distanciaPt: number, page: number, baselineFraction: number
): ZonaColocada {
  const alto = altoZona(items);
  const holgura = 1; // evita que el redondeo de coma flotante fuerce un salto de página dentro de la zona
  const virtual: PageGeometry = { widthPt: pagina.widthPt, heightPt: alto + holgura, marginTopPt: 0, marginBottomPt: 0, marginLeftPt: 0, marginRightPt: 0 };
  const res = paginar(items, virtual, baselineFraction);
  const dy = ancla === 'arriba' ? pagina.heightPt - distanciaPt - (alto + holgura) : distanciaPt - holgura;
  const mover = <T extends { page: number; yPt: number }>(xs: T[]): T[] => xs.filter((x) => x.page === 0).map((x) => ({ ...x, page, yPt: x.yPt + dy }));
  return { trazos: mover(res.trazos), barras: mover(res.barras), imagenes: mover(res.imagenes), enlaces: mover(res.enlaces) };
}
