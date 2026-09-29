import { test, expect } from 'vitest';
import { agruparLineas, agruparParrafos, aTextoPlano, aMarkdown } from '../../src/texto/estructura';
import type { TextRun } from '../../src/engine/PdfEngine';

/** Construye un TextRun de prueba con los campos mínimos que usa `estructura.ts`. */
function run(partial: {
  text: string;
  xPt: number;
  yPt: number;
  sizePt: number;
  fontName?: string;
  wPt?: number;
}): TextRun {
  const wPt = partial.wPt ?? partial.text.length * partial.sizePt * 0.5;
  return {
    runId: 0,
    text: partial.text,
    boxPt: { xPt: partial.xPt, yPt: partial.yPt, wPt, hPt: partial.sizePt },
    fontName: partial.fontName ?? 'Helvetica',
    sizePt: partial.sizePt,
    color: [0, 0, 0, 255],
    originPt: { xPt: partial.xPt, yPt: partial.yPt }
  };
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
