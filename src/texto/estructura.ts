import type { TextRun } from '../engine/PdfEngine';
import { agruparLineasEditables, type LineaEditable } from './lineasEditables';

/**
 * Reconstruye la estructura de lectura (líneas, párrafos) de los `TextRun`
 * planos que devuelve `engine.getPageText()`, y los serializa a texto plano
 * o a Markdown. Módulo PURO: sin DOM, sin motor, sin `window` — testeable en
 * Node a secas (`tests/unit/estructura.test.ts`). Lo usa la UI para "Texto…"
 * (#27 de la tabla de paridad, §9) y "Exportar Markdown" (#31).
 *
 * Los objetos de texto de un PDF de Chrome son de UN glifo: antes de agrupar por Y, `piezasDeLectura` los reúne en
 * «líneas editables» (`lineasEditables.ts`, N1) y trabaja con una pieza por tramo de estilo, con el texto REAL (sin
 * espacios generados por PDFium, así que no se duplican, N6).
 *
 * Limitaciones conocidas (fase 1, documentadas a propósito):
 * - Sin tablas: una tabla se lee como líneas de texto sueltas, sin la
 *   estructura de celdas.
 * - Sin columnas múltiples: el orden de lectura es "de arriba abajo por Y",
 *   así que en un documento a dos columnas el texto de la columna derecha
 *   puede intercalarse con el de la izquierda si ambas comparten alturas de
 *   línea. No hay detección de columnas en esta fase (N5 sigue abierto: la
 *   agrupación en líneas ya no las fusiona, falta el ORDEN de lectura).
 */

/** Una línea de lectura: sus runs originales (ya ordenados de izquierda a derecha) y el texto ya unido. */
export interface Linea {
  runs: TextRun[];
  /** Texto de la línea, runs unidos con un espacio solo donde el hueco horizontal lo pide (ver `necesitaEspacio`). */
  text: string;
  /** Línea base representativa en puntos PDF (promedio de `originPt.yPt` de sus runs). */
  yPt: number;
  /** Tamaño representativo en puntos: el MAYOR `sizeEfectivoPt` de sus runs (una línea con un superíndice pequeño sigue contando como del tamaño grande). */
  sizePt: number;
}

/** Un párrafo: una o más líneas consecutivas sin salto de interlineado grande ni cambio de tamaño. */
export interface Parrafo {
  lineas: Linea[];
}

/** Tolerancia de línea base: dos runs son de la misma línea si |Δy| ≤ este factor × sizePt. */
const TOLERANCIA_LINEA = 0.35;
/** Hueco horizontal, en factor × sizePt, a partir del cual dos runs de la misma línea se separan con un espacio. */
const HUECO_ESPACIO = 0.25;
/** Interlineado, en factor × tamaño medio de las dos líneas, a partir del cual empieza un párrafo nuevo. */
const SALTO_PARRAFO_INTERLINEADO = 1.6;
/** Cambio relativo de tamaño de fuente (respecto al tamaño medio de las dos líneas) que también empieza un párrafo nuevo. */
const SALTO_PARRAFO_CAMBIO_TAMANO = 0.3;

/** Hueco horizontal entre el final de `a` (caja de glifos) y el principio de `b`, en puntos PDF. Puede ser negativo si se solapan. */
function huecoEntre(a: TextRun, b: TextRun): number {
  return b.boxPt.xPt - (a.boxPt.xPt + a.boxPt.wPt);
}

/** Si hay que insertar un espacio entre `a` y `b` al unir su texto (§ del módulo: ~0.25 × sizePt). */
function necesitaEspacio(a: TextRun, b: TextRun): boolean {
  // N6: si uno de los dos textos ya trae el espacio (`'Hola '` + `'mundo'`), no se añade otro.
  if (/\s$/.test(a.text) || /^\s/.test(b.text)) return false;
  const refSize = Math.max(a.sizeEfectivoPt, b.sizeEfectivoPt);
  return huecoEntre(a, b) > HUECO_ESPACIO * refSize;
}

/** Une el texto de los runs de una línea (ya ordenados de izquierda a derecha) con `necesitaEspacio`. */
function unirTexto(runs: TextRun[]): string {
  let out = '';
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    if (i > 0 && necesitaEspacio(runs[i - 1]!, run)) out += ' ';
    out += run.text;
  }
  return out;
}

/** Una línea editable lista para leer: sus piezas (una por tramo de estilo, de izquierda a derecha) y su geometría en pt. */
interface Unidad {
  piezas: TextRun[];
  /** Línea base del primer objeto. */
  yPt: number;
  /** El MAYOR tamaño efectivo de sus tramos. */
  sizePt: number;
  x0: number;
  x1: number;
}

/**
 * Reúne los objetos de texto en líneas editables (`lineasEditables.ts`) y devuelve una `Unidad` por línea, con UNA
 * pieza (`TextRun`) por tramo de estilo: texto real, caja unida y el origen, la fuente, el tamaño efectivo y el color
 * del tramo. Un PDF por glifo pasa de cientos de objetos a unas pocas líneas; uno con un objeto por línea (pdf-lib,
 * Word) queda igual. Salen en el orden del content stream.
 */
function unidadesDeLectura(runs: TextRun[]): Unidad[] {
  const porId = new Map(runs.map((r) => [r.runId, r]));
  return agruparLineasEditables(runs)
    .filter((l) => l.text.trim() !== '')
    .map((l) => ({
      piezas: piezasDeLinea(l, porId),
      yPt: l.originPt.yPt,
      sizePt: Math.max(...l.estilos.map((e) => e.sizeEfectivoPt)),
      x0: l.boxPt.xPt,
      x1: l.boxPt.xPt + l.boxPt.wPt
    }));
}

function piezasDeLinea(linea: LineaEditable, porId: Map<number, TextRun>): TextRun[] {
  return linea.estilos.map((estilo) => {
    const tramos = linea.tramos.filter((t) => t.inicio < estilo.fin && t.fin > estilo.inicio);
    const objetos = tramos.map((t) => porId.get(t.runId)!);
    const primero = objetos[0]!;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of objetos) {
      const b = o.boxPt;
      if (!(b.wPt > 0) || !(b.hPt > 0)) continue;
      x0 = Math.min(x0, b.xPt); y0 = Math.min(y0, b.yPt); x1 = Math.max(x1, b.xPt + b.wPt); y1 = Math.max(y1, b.yPt + b.hPt);
    }
    const boxPt = Number.isFinite(x0) ? { xPt: x0, yPt: y0, wPt: x1 - x0, hPt: y1 - y0 } : { ...primero.boxPt };
    // Un espacio generado entre objetos queda dentro del texto del tramo (`linea.text` lo trae una sola vez).
    const texto = linea.text.slice(estilo.inicio, estilo.fin);
    return { ...primero, text: texto, textoReal: texto, boxPt, sizeEfectivoPt: estilo.sizeEfectivoPt, fontName: estilo.fontName, color: estilo.color };
  });
}

/** Una línea siguiente está en el mismo bloque (columna o párrafo) si va justo debajo y se solapa en horizontal. Fracción de tamaño: salto máximo. */
const BLOQUE_SALTO_MAX = 2.5;
/** Solape horizontal mínimo (fracción de la línea más estrecha) para estar en el mismo bloque. */
const BLOQUE_SOLAPE_X_MIN = 0.3;
/** Dos bloques de varias líneas son columnas si coinciden en vertical al menos esta fracción del más bajo. */
const COLUMNAS_SOLAPE_Y_MIN = 0.5;
/** …y se solapan en horizontal a lo sumo esta fracción del más estrecho. */
const COLUMNAS_SOLAPE_X_MAX = 0.1;

function continuaBloque(a: Unidad, b: Unidad): boolean {
  const dy = a.yPt - b.yPt; // b debajo de a (Y PDF crece hacia arriba)
  const tam = Math.max(a.sizePt, b.sizePt);
  if (!(dy > 0.5 * tam) || dy > BLOQUE_SALTO_MAX * tam) return false;
  const estrecho = Math.min(a.x1 - a.x0, b.x1 - b.x0);
  const solape = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  return estrecho > 0 && solape >= BLOQUE_SOLAPE_X_MIN * estrecho;
}

interface Bloque { unidades: Unidad[]; x0: number; x1: number; top: number; bottom: number }

/** Elemento de lectura: una «fila» (unidades en la misma línea base, una sola línea de lectura) o un grupo de columnas. */
interface Elemento { filas: Unidad[][]; top: number; x0: number }

/**
 * Bloques en el ORDEN DEL CONTENT STREAM: Chrome, Word o LibreOffice escriben una columna entera y después la otra.
 * Dos bloques de varias líneas, uno al lado del otro, son columnas y se leen uno entero tras otro; lo demás (una
 * celda de tabla, una línea suelta) se agrupa por línea base como siempre.
 */
function elementosDeLectura(unidades: Unidad[]): Elemento[] {
  const bloques: Bloque[] = [];
  let actual: Bloque | null = null;
  for (const u of unidades) {
    const ultima: Unidad | undefined = actual?.unidades[actual.unidades.length - 1];
    if (actual && ultima && continuaBloque(ultima, u)) {
      actual.unidades.push(u);
      actual.x0 = Math.min(actual.x0, u.x0); actual.x1 = Math.max(actual.x1, u.x1); actual.bottom = u.yPt;
    } else {
      actual = { unidades: [u], x0: u.x0, x1: u.x1, top: u.yPt + u.sizePt, bottom: u.yPt };
      bloques.push(actual);
    }
  }
  // Columnas: bloques de varias líneas que coinciden en vertical y no se solapan en horizontal (union-find).
  const multi = bloques.filter((b) => b.unidades.length >= 2);
  const padre = new Map<Bloque, Bloque>(multi.map((b) => [b, b]));
  const raiz = (b: Bloque): Bloque => { let r = b; while (padre.get(r) !== r) r = padre.get(r)!; return r; };
  for (let i = 0; i < multi.length; i++) {
    for (let j = i + 1; j < multi.length; j++) {
      const A = multi[i]!, B = multi[j]!;
      const solapeY = Math.min(A.top, B.top) - Math.max(A.bottom, B.bottom);
      const bajo = Math.min(A.top - A.bottom, B.top - B.bottom);
      const solapeX = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0);
      const estrecho = Math.min(A.x1 - A.x0, B.x1 - B.x0);
      if (bajo > 0 && solapeY >= COLUMNAS_SOLAPE_Y_MIN * bajo && solapeX <= COLUMNAS_SOLAPE_X_MAX * estrecho) padre.set(raiz(A), raiz(B));
    }
  }
  const grupos = new Map<Bloque, Bloque[]>();
  for (const b of multi) grupos.set(raiz(b), [...(grupos.get(raiz(b)) ?? []), b]);

  const elementos: Elemento[] = [];
  for (const miembros of grupos.values()) {
    const ordenados = miembros.slice().sort((a, b) => a.x0 - b.x0);
    elementos.push({
      filas: ordenados.flatMap((b) => b.unidades.map((u) => [u])),
      top: Math.max(...ordenados.map((b) => b.top)),
      x0: ordenados[0]!.x0
    });
  }
  // Líneas sueltas (bloques de una sola línea): se reúnen por línea base, como siempre (celdas de una tabla, columnas
  // de una sola línea…): una fila de lectura con sus unidades de izquierda a derecha.
  const sueltas = bloques.filter((b) => b.unidades.length === 1).map((b) => b.unidades[0]!).sort((a, b) => b.yPt - a.yPt);
  const filas: Unidad[][] = [];
  for (const u of sueltas) {
    const fila = filas.find((f) => Math.abs(f[0]!.yPt - u.yPt) <= TOLERANCIA_LINEA * Math.max(f[0]!.sizePt, u.sizePt));
    if (fila) fila.push(u); else filas.push([u]);
  }
  for (const f of filas) {
    f.sort((a, b) => a.x0 - b.x0);
    elementos.push({ filas: [f], top: Math.max(...f.map((u) => u.yPt + u.sizePt)), x0: f[0]!.x0 });
  }
  return elementos.sort((a, b) => b.top - a.top || a.x0 - b.x0);
}

/**
 * Agrupa runs sueltos en líneas de lectura, ordenadas de arriba abajo (Y PDF descendente = orden de lectura) y,
 * dentro de cada línea, de izquierda a derecha. Los objetos se reúnen antes en líneas editables (un PDF de Chrome
 * trae un objeto por glifo); las columnas de varias líneas se leen una tras otra (N5). Ignora lo que queda vacío
 * tras `trim()`.
 */
export function agruparLineas(runsDelMotor: TextRun[]): Linea[] {
  const lineas: Linea[] = [];
  for (const el of elementosDeLectura(unidadesDeLectura(runsDelMotor))) {
    for (const fila of el.filas) {
      const piezas = fila.flatMap((u) => u.piezas);
      lineas.push({
        runs: piezas,
        text: unirTexto(piezas),
        yPt: fila.reduce((suma, u) => suma + u.yPt, 0) / fila.length,
        sizePt: Math.max(...fila.map((u) => u.sizePt))
      });
    }
  }
  return lineas;
}

/**
 * Agrupa líneas consecutivas (ya en orden de lectura) en párrafos: un
 * párrafo nuevo empieza cuando el interlineado entre una línea y la
 * siguiente supera `SALTO_PARRAFO_INTERLINEADO × tamaño medio`, o cuando el
 * tamaño de fuente cambia más de `SALTO_PARRAFO_CAMBIO_TAMANO` en relativo
 * (p. ej. un título seguido de cuerpo, aunque el interlineado en sí sea
 * pequeño).
 */
export function agruparParrafos(lineas: Linea[]): Parrafo[] {
  const parrafos: Parrafo[] = [];
  let actual: Linea[] = [];

  for (const linea of lineas) {
    if (actual.length > 0) {
      const anterior = actual[actual.length - 1]!;
      const refSize = (anterior.sizePt + linea.sizePt) / 2;
      const interlineado = anterior.yPt - linea.yPt; // positivo: Y baja al leer hacia abajo
      const cambioTamano = refSize > 0 ? Math.abs(linea.sizePt - anterior.sizePt) / refSize : 0;
      const saltoGrande = refSize > 0 && interlineado > SALTO_PARRAFO_INTERLINEADO * refSize;
      if (saltoGrande || cambioTamano > SALTO_PARRAFO_CAMBIO_TAMANO) {
        parrafos.push({ lineas: actual });
        actual = [];
      }
    }
    actual.push(linea);
  }
  if (actual.length > 0) parrafos.push({ lineas: actual });
  return parrafos;
}

/**
 * Texto plano de todo el documento: líneas unidas con `\n`, páginas
 * separadas por una línea marcadora `--- Página N ---` (con líneas en blanco
 * alrededor). Se eligió el marcador de texto en vez de `\f` (form feed):
 * `\f` es invisible en Notepad/VSCode/la mayoría de editores — el usuario
 * perdería toda referencia de en qué página está cada línea al pegar el
 * texto en otro sitio, justo lo que un editor de PDF no debería hacerle
 * perder. La app vieja no exporta texto plano multipágina (su modal de OCR
 * solo maneja una página a la vez), así que no hay un precedente que seguir
 * aquí; el marcador sigue el mismo espíritu legible que ya usa el separador
 * de Markdown (`aMarkdown`, más abajo).
 */
export function aTextoPlano(paginas: Linea[][]): string {
  const partes: string[] = [];
  paginas.forEach((lineas, i) => {
    if (i > 0) partes.push(`\n\n--- Página ${i + 1} ---\n\n`);
    partes.push(lineas.map((l) => l.text).join('\n'));
  });
  return partes.join('');
}

const RATIO_H1 = 1.6;
const RATIO_H2 = 1.3;
const RATIO_H3 = 1.15;

/** Moda de `sizePt` en todo el documento, PONDERADA por caracteres (una línea larga pesa más que un título corto). Por defecto 12pt si no hay texto. */
function tamanoCuerpo(paginas: Linea[][]): number {
  const pesos = new Map<number, number>();
  for (const lineas of paginas) {
    for (const linea of lineas) {
      for (const run of linea.runs) {
        const peso = Math.max(1, run.text.length);
        pesos.set(run.sizeEfectivoPt, (pesos.get(run.sizeEfectivoPt) ?? 0) + peso);
      }
    }
  }
  let mejorTamano = 12;
  let mejorPeso = -1;
  for (const [tamano, peso] of pesos) {
    if (peso > mejorPeso) { mejorPeso = peso; mejorTamano = tamano; }
  }
  return mejorTamano;
}

/** Nivel de encabezado (0 = cuerpo normal, 1-3 = número de `#`) según el tamaño de la línea respecto al cuerpo. */
function nivelEncabezado(sizePt: number, cuerpo: number): 0 | 1 | 2 | 3 {
  if (cuerpo <= 0) return 0;
  const ratio = sizePt / cuerpo;
  if (ratio >= RATIO_H1) return 1;
  if (ratio >= RATIO_H2) return 2;
  if (ratio >= RATIO_H3) return 3;
  return 0;
}

/**
 * Escapa dentro de una pieza de texto del DOCUMENTO los caracteres que
 * Markdown interpretaría como marcado: `\`, `` ` ``, `*`, `_`, `[`, `]`, `<`,
 * `>`. Es el mismo principio que AGENTS.md §2.2 (nunca interpolar datos del
 * documento sin escapar): el texto de un PDF es entrada NO confiable para el
 * formato de salida — igual que no se interpola sin escapar en HTML (E-003),
 * aquí no se interpola sin escapar en Markdown. `#` NO se escapa aquí a
 * propósito: solo importa al PRINCIPIO de una línea (ver `renderLinea`), no
 * en medio de una palabra.
 */
function escaparInline(texto: string): string {
  return texto.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`);
}

function esNegrita(fontName: string): boolean {
  return /Bold|Black|Heavy/i.test(fontName);
}

/** Markdown de una línea: encabezado, lista, negrita por run y escape del contenido — nunca del marcado que añade esta función. */
function renderLinea(linea: Linea, cuerpo: number): string {
  const runs = linea.runs;
  if (runs.length === 0) return '';
  const nivel = nivelEncabezado(linea.sizePt, cuerpo);

  // Lista (solo si la línea no es ya un encabezado): el prefijo se detecta y
  // se retira del texto CRUDO del primer run, antes de escapar nada —
  // '•'/'-'/'*' son justo caracteres que `escaparInline` escaparía si
  // llegaran hasta ahí, así que el orden importa.
  let prefijoLista = '';
  let primerTexto = runs[0]!.text;
  if (nivel === 0) {
    const bullet = /^[•\-–*]\s*/.exec(primerTexto);
    const numero = /^(\d+)[.)]\s*/.exec(primerTexto);
    if (bullet) {
      prefijoLista = '- ';
      primerTexto = primerTexto.slice(bullet[0].length);
    } else if (numero) {
      prefijoLista = `${numero[1]}. `;
      primerTexto = primerTexto.slice(numero[0].length);
    }
  }

  const piezas: string[] = [];
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]!;
    const crudo = i === 0 ? primerTexto : run.text;
    if (i > 0 && necesitaEspacio(runs[i - 1]!, run)) piezas.push(' ');
    let pieza = escaparInline(crudo);
    // La negrita del run original no se aplica si la línea entera ya es un
    // encabezado (evita "# **Título**", redundante y menos legible).
    if (nivel === 0 && pieza !== '' && esNegrita(run.fontName)) pieza = `**${pieza}**`;
    piezas.push(pieza);
  }
  let contenido = piezas.join('');

  if (nivel > 0) return `${'#'.repeat(nivel)} ${contenido}`;
  if (prefijoLista) return `${prefijoLista}${contenido}`;
  // '#' al principio de una línea normal se leería como encabezado si no se escapa (a diferencia de en medio de la línea).
  if (contenido.startsWith('#')) contenido = `\\${contenido}`;
  return contenido;
}

/**
 * Markdown de todo el documento: encabezados por tamaño relativo al cuerpo
 * (moda ponderada por caracteres), negrita por fuente, listas por prefijo,
 * contenido del documento escapado (nunca el marcado añadido aquí), párrafos
 * separados por una línea en blanco y páginas por `\n\n---\n\n`.
 */
export function aMarkdown(paginas: Linea[][]): string {
  const cuerpo = tamanoCuerpo(paginas);
  const partes = paginas.map((lineas) => {
    const parrafos = agruparParrafos(lineas);
    return parrafos.map((p) => p.lineas.map((l) => renderLinea(l, cuerpo)).join('\n')).join('\n\n');
  });
  return partes.join('\n\n---\n\n');
}
