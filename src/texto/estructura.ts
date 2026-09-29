import type { TextRun } from '../engine/PdfEngine';

/**
 * Reconstruye la estructura de lectura (líneas, párrafos) de los `TextRun`
 * planos que devuelve `engine.getPageText()`, y los serializa a texto plano
 * o a Markdown. Módulo PURO: sin DOM, sin motor, sin `window` — testeable en
 * Node a secas (`tests/unit/estructura.test.ts`). Lo usa la UI para "Texto…"
 * (#27 de la tabla de paridad, §9) y "Exportar Markdown" (#31).
 *
 * Limitaciones conocidas (fase 1, documentadas a propósito):
 * - Sin tablas: una tabla se lee como líneas de texto sueltas, sin la
 *   estructura de celdas.
 * - Sin columnas múltiples: el orden de lectura es "de arriba abajo por Y",
 *   así que en un documento a dos columnas el texto de la columna derecha
 *   puede intercalarse con el de la izquierda si ambas comparten alturas de
 *   línea. No hay detección de columnas en esta fase.
 */

/** Una línea de lectura: sus runs originales (ya ordenados de izquierda a derecha) y el texto ya unido. */
export interface Linea {
  runs: TextRun[];
  /** Texto de la línea, runs unidos con un espacio solo donde el hueco horizontal lo pide (ver `necesitaEspacio`). */
  text: string;
  /** Línea base representativa en puntos PDF (promedio de `originPt.yPt` de sus runs). */
  yPt: number;
  /** Tamaño representativo en puntos: el MAYOR `sizePt` de sus runs (una línea con un superíndice pequeño sigue contando como del tamaño grande). */
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
  const refSize = Math.max(a.sizePt, b.sizePt);
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

/**
 * Agrupa runs sueltos en líneas de lectura, ordenadas de arriba abajo (Y PDF
 * descendente = orden de lectura) y, dentro de cada línea, de izquierda a
 * derecha. Ignora runs cuyo texto queda vacío tras `trim()` (no aportan nada
 * y solo estorban al agrupar).
 */
export function agruparLineas(runs: TextRun[]): Linea[] {
  const utiles = runs.filter((r) => r.text.trim() !== '');
  // Orden descendente de Y: en puntos PDF el eje Y crece hacia arriba, así
  // que "arriba abajo" (orden de lectura) es Y decreciente.
  const ordenados = utiles.slice().sort((a, b) => b.originPt.yPt - a.originPt.yPt);

  const grupos: TextRun[][] = [];
  for (const run of ordenados) {
    const grupo = grupos.find((g) => {
      const referencia = g[0]!;
      const tolerancia = TOLERANCIA_LINEA * Math.max(referencia.sizePt, run.sizePt);
      return Math.abs(referencia.originPt.yPt - run.originPt.yPt) <= tolerancia;
    });
    if (grupo) grupo.push(run);
    else grupos.push([run]);
  }

  return grupos.map((grupo) => {
    const porX = grupo.slice().sort((a, b) => a.boxPt.xPt - b.boxPt.xPt);
    const yPt = porX.reduce((suma, r) => suma + r.originPt.yPt, 0) / porX.length;
    const sizePt = Math.max(...porX.map((r) => r.sizePt));
    return { runs: porX, text: unirTexto(porX), yPt, sizePt };
  });
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
        pesos.set(run.sizePt, (pesos.get(run.sizePt) ?? 0) + peso);
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
