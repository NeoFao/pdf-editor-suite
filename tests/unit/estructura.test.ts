import { test, expect, describe } from 'vitest';
import { agruparLineas, agruparParrafos, aTextoPlano, aMarkdown } from '../../src/texto/estructura';
import type { TextRun } from '../../src/engine/PdfEngine';
import { crearTextRun } from './_util/textRun';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { fixture } from './_util/fixtures';

let siguienteRunId = 0;

/** Construye un TextRun de prueba con los campos mínimos que usa `estructura.ts`. */
function run(partial: {
  text: string;
  xPt: number;
  yPt: number;
  sizePt: number;
  fontName?: string;
  wPt?: number;
}): TextRun {
  // runId único por run, como en el motor (la agrupación en líneas editables se apoya en él).
  return crearTextRun({ ...partial, runId: siguienteRunId++, wPt: partial.wPt ?? partial.text.length * partial.sizePt * 0.5 });
}

test('agruparLineas: dos runs en la misma línea base con hueco amplio se unen con un espacio', () => {
  // "Hola" termina en x=40+4*12*0.5=64pt; "mundo" empieza en x=80pt → hueco 16pt > 0.25*12=3pt
  const runs = [
    run({ text: 'Hola', xPt: 40, yPt: 700, sizePt: 12 }),
    run({ text: 'mundo', xPt: 80, yPt: 700, sizePt: 12 })
  ];
  const lineas = agruparLineas(runs);
  expect(lineas).toHaveLength(1);
  expect(lineas[0]!.text).toBe('Hola mundo');
});

test('agruparLineas: un hueco pequeño (kerning normal) NO añade espacio', () => {
  const a = run({ text: 'Ho', xPt: 40, yPt: 700, sizePt: 12 }); // termina en 40+2*6=52
  const b = run({ text: 'la', xPt: 52.5, yPt: 700, sizePt: 12 }); // hueco 0.5pt < 3pt
  const lineas = agruparLineas([a, b]);
  expect(lineas).toHaveLength(1);
  expect(lineas[0]!.text).toBe('Hola');
});

test('agruparLineas: ordena de izquierda a derecha aunque los runs lleguen desordenados', () => {
  const runs = [
    run({ text: 'mundo', xPt: 80, yPt: 700, sizePt: 12 }),
    run({ text: 'Hola', xPt: 40, yPt: 700, sizePt: 12 })
  ];
  const lineas = agruparLineas(runs);
  expect(lineas[0]!.text).toBe('Hola mundo');
});

test('agruparLineas: orden de lectura de arriba abajo (Y PDF descendente) y separa líneas con Δy grande', () => {
  const runs = [
    run({ text: 'Segunda', xPt: 40, yPt: 680, sizePt: 12 }),
    run({ text: 'Primera', xPt: 40, yPt: 700, sizePt: 12 })
  ];
  const lineas = agruparLineas(runs);
  expect(lineas.map((l) => l.text)).toEqual(['Primera', 'Segunda']);
});

test('agruparLineas: una diferencia de Y pequeña (dentro de la tolerancia) mantiene los runs en la misma línea', () => {
  // Tolerancia = 0.35 * 12 = 4.2pt; Δy = 2pt cae dentro.
  const runs = [
    run({ text: 'Hola', xPt: 40, yPt: 700, sizePt: 12 }),
    run({ text: 'mundo', xPt: 80, yPt: 702, sizePt: 12 })
  ];
  const lineas = agruparLineas(runs);
  expect(lineas).toHaveLength(1);
});

test('agruparParrafos: un salto de interlineado grande (>1.6×) empieza un párrafo nuevo', () => {
  const lineas = agruparLineas([
    run({ text: 'Linea A1', xPt: 40, yPt: 700, sizePt: 12 }),
    run({ text: 'Linea A2', xPt: 40, yPt: 686, sizePt: 12 }), // interlineado normal (14pt < 1.6*12=19.2)
    run({ text: 'Linea B1', xPt: 40, yPt: 640, sizePt: 12 })  // salto grande (46pt > 19.2)
  ]);
  const parrafos = agruparParrafos(lineas);
  expect(parrafos).toHaveLength(2);
  expect(parrafos[0]!.lineas.map((l) => l.text)).toEqual(['Linea A1', 'Linea A2']);
  expect(parrafos[1]!.lineas.map((l) => l.text)).toEqual(['Linea B1']);
});

test('agruparParrafos: un cambio grande de tamaño de fuente también empieza un párrafo nuevo', () => {
  const lineas = agruparLineas([
    run({ text: 'Titulo Grande', xPt: 40, yPt: 700, sizePt: 24 }),
    run({ text: 'Cuerpo normal', xPt: 40, yPt: 680, sizePt: 11 }) // interlineado pequeño, pero tamaño cambia mucho
  ]);
  const parrafos = agruparParrafos(lineas);
  expect(parrafos).toHaveLength(2);
});

test('aTextoPlano: une líneas con \\n y separa páginas con un marcador visible', () => {
  const pagina1 = agruparLineas([
    run({ text: 'Uno', xPt: 40, yPt: 700, sizePt: 12 }),
    run({ text: 'Dos', xPt: 40, yPt: 686, sizePt: 12 })
  ]);
  const pagina2 = agruparLineas([run({ text: 'Tres', xPt: 40, yPt: 700, sizePt: 12 })]);
  const texto = aTextoPlano([pagina1, pagina2]);
  expect(texto).toBe('Uno\nDos\n\n--- Página 2 ---\n\nTres');
});

test('aTextoPlano: una página vacía no rompe nada', () => {
  const pagina1 = agruparLineas([run({ text: 'Uno', xPt: 40, yPt: 700, sizePt: 12 })]);
  const paginaVacia: ReturnType<typeof agruparLineas> = [];
  expect(() => aTextoPlano([pagina1, paginaVacia])).not.toThrow();
  expect(aTextoPlano([paginaVacia])).toBe('');
});

test('aMarkdown: un tamaño mucho mayor que el cuerpo se convierte en encabezado #', () => {
  const lineas = agruparLineas([
    run({ text: 'Informe Anual', xPt: 40, yPt: 760, sizePt: 24, fontName: 'Helvetica-Bold' }),
    run({ text: 'Parrafo de cuerpo uno.', xPt: 40, yPt: 700, sizePt: 11 }),
    run({ text: 'Parrafo de cuerpo dos.', xPt: 40, yPt: 686, sizePt: 11 })
  ]);
  const md = aMarkdown([lineas]);
  expect(md.startsWith('# Informe Anual')).toBe(true);
  // El título no lleva además ** aunque su fuente sea Bold: ya es encabezado.
  expect(md).not.toContain('**Informe Anual**');
});

test('aMarkdown: negrita cuando el nombre de fuente contiene Bold y la línea no es encabezado', () => {
  const lineas = agruparLineas([
    run({ text: 'cuerpo normal uno', xPt: 40, yPt: 700, sizePt: 11 }),
    run({ text: 'cuerpo normal dos', xPt: 40, yPt: 686, sizePt: 11 }),
    run({ text: 'texto en negrita', xPt: 40, yPt: 672, sizePt: 11, fontName: 'Helvetica-Bold' })
  ]);
  const md = aMarkdown([lineas]);
  expect(md).toContain('**texto en negrita**');
});

test('aMarkdown: lista con viñeta', () => {
  const lineas = agruparLineas([
    run({ text: 'cuerpo normal uno', xPt: 40, yPt: 700, sizePt: 11 }),
    run({ text: '• punto uno', xPt: 40, yPt: 686, sizePt: 11 })
  ]);
  const md = aMarkdown([lineas]);
  expect(md).toContain('- punto uno');
});

test('aMarkdown: lista numerada', () => {
  const lineas = agruparLineas([
    run({ text: 'cuerpo normal uno', xPt: 40, yPt: 700, sizePt: 11 }),
    run({ text: '1) primer paso', xPt: 40, yPt: 686, sizePt: 11 })
  ]);
  const md = aMarkdown([lineas]);
  expect(md).toContain('1. primer paso');
});

test('aMarkdown: escapa *, _ y # del contenido del documento', () => {
  const lineas = agruparLineas([
    run({ text: 'cuerpo normal uno', xPt: 40, yPt: 700, sizePt: 11 }),
    run({ text: 'precio *especial*_2', xPt: 40, yPt: 686, sizePt: 11 }),
    run({ text: '# no es un encabezado real', xPt: 40, yPt: 672, sizePt: 11 })
  ]);
  const md = aMarkdown([lineas]);
  expect(md).toContain('precio \\*especial\\*\\_2');
  expect(md).toContain('\\# no es un encabezado real');
});

test('aMarkdown: separador --- entre páginas', () => {
  const p1 = agruparLineas([run({ text: 'Pagina uno', xPt: 40, yPt: 700, sizePt: 11 })]);
  const p2 = agruparLineas([run({ text: 'Pagina dos', xPt: 40, yPt: 700, sizePt: 11 })]);
  const md = aMarkdown([p1, p2]);
  expect(md).toContain('\n\n---\n\n');
});

test('aMarkdown: una página vacía no rompe nada', () => {
  const p1 = agruparLineas([run({ text: 'Pagina uno', xPt: 40, yPt: 700, sizePt: 11 })]);
  const vacia: ReturnType<typeof agruparLineas> = [];
  expect(() => aMarkdown([p1, vacia])).not.toThrow();
  expect(aMarkdown([vacia])).toBe('');
});

// ---- N1: lectura sobre líneas editables (N5 columnas, N6 espacios) ----

test('N5 (sintético): dos columnas de varias líneas escritas una tras otra se leen enteras, la izquierda primero', () => {
  const izq1 = run({ text: 'izquierda uno', xPt: 40, yPt: 700, sizePt: 12 });
  const izq2 = run({ text: 'izquierda dos', xPt: 40, yPt: 686, sizePt: 12 });
  const der1 = run({ text: 'derecha uno', xPt: 200, yPt: 700, sizePt: 12 });
  const der2 = run({ text: 'derecha dos', xPt: 200, yPt: 686, sizePt: 12 });
  // content stream: columna izquierda entera y después la derecha.
  expect(agruparLineas([izq1, izq2, der1, der2]).map((l) => l.text)).toEqual(['izquierda uno', 'izquierda dos', 'derecha uno', 'derecha dos']);
});

test('N5 (sintético): celdas de UNA línea en la misma línea base siguen siendo una fila de lectura', () => {
  const a = run({ text: 'Celda A1', xPt: 40, yPt: 700, sizePt: 12 });
  const b = run({ text: 'Celda B1', xPt: 200, yPt: 700, sizePt: 12 });
  const c = run({ text: 'Celda A2', xPt: 40, yPt: 686, sizePt: 12 });
  const d = run({ text: 'Celda B2', xPt: 200, yPt: 686, sizePt: 12 });
  expect(agruparLineas([a, b, c, d]).map((l) => l.text)).toEqual(['Celda A1 Celda B1', 'Celda A2 Celda B2']);
});

test('N6 (sintético): el espacio ya presente o generado no se duplica al unir piezas', () => {
  const a = run({ text: 'Hola ', xPt: 40, yPt: 700, sizePt: 12 }); // acaba en espacio real; el hueco de cajas lo pediría de nuevo
  const b = run({ text: 'mundo', xPt: 80, yPt: 700, sizePt: 12, wPt: 30 });
  expect(agruparLineas([a, b])[0]!.text).toBe('Hola mundo');
});

describe('con el motor real sobre por-glifo.pdf (un Tj por glifo)', () => {
  async function lineasPorGlifo() {
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(fixture('por-glifo.pdf'));
    const lineas = agruparLineas(eng.getPageText(doc, 0));
    eng.close(doc);
    return lineas;
  }

  test('N5: las dos columnas se leen enteras (no intercaladas) y las celdas de la tabla forman filas', async () => {
    const textos = (await lineasPorGlifo()).map((l) => l.text);
    expect(textos).toEqual([
      'Tabla de cifras',
      'Columna izquierda uno', 'Columna izquierda dos', 'Columna derecha uno', 'Columna derecha dos',
      'Bloque amplio izquierdo Bloque amplio derecho',
      'Estilo mixto: normal NEGRITA y fin.',
      'uno dos tres cuatro cinco seis',
      'E=mc2 fin.',
      'Celda A1 Celda B1 Celda C1', 'Celda A2 Celda B2 Celda C2',
      'Texto con recorte activo', 'Capa OCR invisible', 'Texto NEGRITA final', 'Texto girado'
    ]);
  });

  test('N6: ninguna línea tiene espacios dobles ni empieza o acaba en espacio', async () => {
    for (const l of await lineasPorGlifo()) {
      expect(l.text).not.toMatch(/ {2}/);
      expect(l.text).toBe(l.text.trim());
    }
  });

  test('N6: Markdown de una línea multiestilo: negrita bien formada y sin "** **"', async () => {
    const md = aMarkdown([await lineasPorGlifo()]);
    expect(md).toContain('Estilo mixto: normal **NEGRITA** y fin.');
    expect(md).toContain('Texto **NEGRITA** final');
    expect(md).toContain('# Tabla de cifras');
    expect(md).not.toMatch(/\*\* \*\*|\*\*\*\*/);
  });

  test('el tamaño de los encabezados sale del tamaño EFECTIVO (22 pt frente a 11 pt = H1), no del Tf nominal', async () => {
    const md = aMarkdown([await lineasPorGlifo()]);
    expect(md.split('\n')[0]).toBe('# Tabla de cifras');
  });
});
