import { test, expect, describe } from 'vitest';
import { agruparLineasEditables } from '../../src/texto/lineasEditables';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { crearTextRun, type TextRunParcial } from './_util/textRun';
import { fixture } from './_util/fixtures';

/** Todos los runs del test miden 10 pt de cuerpo; el avance por carácter es 5 pt (0,5 em). */
const SZ = 10;
let id = 0;
function r(p: Partial<TextRunParcial> & { text: string; xPt: number }) {
  return crearTextRun({ yPt: 700, sizePt: SZ, runId: id++, ...p });
}
const textos = (runs: ReturnType<typeof r>[]) => agruparLineasEditables(runs).map((l) => l.text);

describe('agruparLineasEditables: criterios del diseño (runs sintéticos)', () => {
  test('objetos contiguos en la misma línea base y sin hueco forman UNA línea, en orden visual', () => {
    id = 0;
    const lineas = agruparLineasEditables([
      r({ text: 'Ho', xPt: 40 }), r({ text: 'la', xPt: 50 }), r({ text: ' mundo', xPt: 60 })
    ]);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.text).toBe('Hola mundo');
    expect(lineas[0]!.runIds).toEqual([0, 1, 2]);
    expect(lineas[0]!.lineaId).toBe('0:0');
  });

  test('el orden visual es por u aunque el content stream vaya al revés (la unión es por solape, no por orden)', () => {
    id = 0;
    const lineas = agruparLineasEditables([r({ text: 'mundo', xPt: 60 }), r({ text: 'Hola ', xPt: 35 })]);
    expect(lineas).toHaveLength(1);
    expect(lineas[0]!.text).toBe('Hola mundo');
    expect(lineas[0]!.runIds).toEqual([1, 0]);
  });

  test('C1: otra dirección (texto girado) o otra escala no se mezcla', () => {
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40, yPt: 0 }), r({ text: 'def', xPt: 55, yPt: 0, anguloDeg: 5 })])).toEqual(['abc', 'def']);
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40, yPt: 0 }), r({ text: 'def', xPt: 55, yPt: 0, escala: 1.2 })])).toEqual(['abc', 'def']);
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40, yPt: 0 }), r({ text: 'def', xPt: 55, yPt: 0, anguloDeg: 0.5 })])).toEqual(['abcdef']);
  });

  test('C2: la capa invisible (render 3) no se mezcla con el texto visible', () => {
    id = 0;
    expect(textos([r({ text: 'visible', xPt: 40 }), r({ text: 'oculto', xPt: 75, renderMode: 3 })])).toEqual(['visible', 'oculto']);
  });

  test('C3: la línea base absorbe hasta 0,2 em y separa más allá', () => {
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40 }), r({ text: 'def', xPt: 55, yPt: 698.5 })])).toEqual(['abcdef']); // 0,15 em
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40 }), r({ text: 'def', xPt: 55, yPt: 697 })])).toEqual(['abc', 'def']); // 0,3 em
  });

  test('C3′: un superíndice (más pequeño y elevado) se queda en la línea y el texto vuelve a la base', () => {
    id = 0;
    const base = r({ text: 'E=mc', xPt: 40 });
    const sup = r({ text: '2', xPt: 60, yPt: 705, sizePt: 6.5 }); // elevado 5 pt
    const lineas = agruparLineasEditables([base, sup, r({ text: ' fin.', xPt: 63.25 })]);
    expect(lineas.map((l) => l.text)).toEqual(['E=mc2 fin.']);
    expect(lineas[0]!.estilos).toHaveLength(3); // normal, índice (otro tamaño), normal
  });

  test('C3′: algo más PEQUEÑO pero lejos de la línea no es un índice', () => {
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40 }), r({ text: 'x', xPt: 55, yPt: 730, sizePt: 5 })])).toEqual(['abc', 'x']);
  });

  test('C4: un hueco de 0,6 em o menos junta; mayor (celdas, columnas) separa', () => {
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40 }), r({ text: 'def', xPt: 55 + 5.5 })])).toEqual(['abcdef']); // 0,55 em
    id = 0;
    expect(textos([r({ text: 'abc', xPt: 40 }), r({ text: 'def', xPt: 55 + 7.7 })])).toEqual(['abc', 'def']); // 0,77 em
  });

  test('C4: tras un espacio real el hueco admitido llega a 2 em (justificación)', () => {
    id = 0;
    expect(textos([r({ text: 'uno ', xPt: 40 }), r({ text: 'dos', xPt: 60 + 15 })])).toEqual(['uno dos']); // 1,5 em tras espacio
    id = 0;
    expect(textos([r({ text: 'uno ', xPt: 40 }), r({ text: 'dos', xPt: 60 + 25 })])).toEqual(['uno ', 'dos']); // 2,5 em
  });

  test('contigüidad: dos columnas a 0,77 em escritas una tras otra NO se fusionan, aunque la izquierda acabe en espacio', () => {
    id = 0;
    // content stream: columna izquierda entera (2 filas) y después la derecha (2 filas), misma línea base por fila.
    const izq1 = r({ text: 'izquierda uno ', xPt: 40, yPt: 700 });
    const izq2 = r({ text: 'izquierda dos ', xPt: 40, yPt: 686 });
    const der1 = r({ text: 'derecha uno', xPt: 40 + 70 + 7.7, yPt: 700 });
    const der2 = r({ text: 'derecha dos', xPt: 40 + 70 + 7.7, yPt: 686 });
    expect(textos([izq1, izq2, der1, der2])).toEqual(['izquierda uno ', 'izquierda dos ', 'derecha uno', 'derecha dos']);
  });

  test('fusión: la negrita escrita fuera de orden se une a su línea; una columna lejana, no', () => {
    id = 0;
    const lineas = agruparLineasEditables([
      r({ text: 'Texto ', xPt: 40 }), r({ text: ' final', xPt: 40 + 30 + 35 }), r({ text: 'NEGRITA', xPt: 70, fontName: 'Helvetica-Bold' })
    ]);
    expect(lineas.map((l) => l.text)).toEqual(['Texto NEGRITA final']);
    expect(lineas[0]!.estilos.map((e) => e.fontName)).toEqual(['Helvetica', 'Helvetica-Bold', 'Helvetica']);
    id = 0;
    expect(textos([r({ text: 'Texto ', xPt: 40 }), r({ text: 'otro bloque', xPt: 40 + 30 + 40 })])).toEqual(['Texto ', 'otro bloque']);
  });

  test('N6: el espacio que genera PDFium se añade UNA vez y nunca se duplica', () => {
    id = 0;
    const a = r({ text: 'Hola', xPt: 40 });
    const b = r({ text: ' mundo', textoReal: 'mundo', xPt: 62.8, espacioVirtualAntes: true }); // `text` trae el espacio generado
    expect(textos([a, b])).toEqual(['Hola mundo']);
    id = 0;
    const c = r({ text: 'Hola ', xPt: 40 });
    const d = r({ text: 'mundo', xPt: 65, espacioVirtualAntes: true }); // ya acababa en espacio real
    expect(textos([c, d])).toEqual(['Hola mundo']);
  });

  test('los objetos sin texto real se ignoran', () => {
    id = 0;
    expect(textos([r({ text: '', xPt: 40 }), r({ text: 'abc', xPt: 50 })])).toEqual(['abc']);
  });

  test('tramos (carácter → objeto) y estilos: una línea multiestilo conserva fuente, tamaño y color de cada tramo', () => {
    id = 0;
    const lineas = agruparLineasEditables([
      r({ text: 'Estilo ', xPt: 40 }),
      r({ text: 'NEGRITA', xPt: 75, fontName: 'Helvetica-Bold', color: [255, 0, 0, 255] }),
      r({ text: ' fin', xPt: 110 })
    ]);
    const l = lineas[0]!;
    expect(l.text).toBe('Estilo NEGRITA fin');
    expect(l.tramos).toEqual([{ runId: 0, inicio: 0, fin: 7 }, { runId: 1, inicio: 7, fin: 14 }, { runId: 2, inicio: 14, fin: 18 }]);
    expect(l.estilos).toEqual([
      { inicio: 0, fin: 7, fontName: 'Helvetica', sizeEfectivoPt: SZ, color: [0, 0, 0, 255] },
      { inicio: 7, fin: 14, fontName: 'Helvetica-Bold', sizeEfectivoPt: SZ, color: [255, 0, 0, 255] },
      { inicio: 14, fin: 18, fontName: 'Helvetica', sizeEfectivoPt: SZ, color: [0, 0, 0, 255] }
    ]);
  });

  test('boxPt es la unión de las cajas originales; originPt y ángulo son los del primer objeto', () => {
    id = 0;
    const l = agruparLineasEditables([r({ text: 'abc', xPt: 40 }), r({ text: 'def', xPt: 55 })])[0]!;
    expect(l.boxPt.xPt).toBe(40);
    expect(l.boxPt.xPt + l.boxPt.wPt).toBeCloseTo(70, 5);
    expect(l.originPt).toEqual({ xPt: 40, yPt: 700 });
    expect(l.anguloDeg).toBe(0);
  });

  test('texto girado 90°: se agrupa en el eje del texto, no en X', () => {
    id = 0;
    // «ab» + «cd» subiendo: la matriz gira 90° y el origen avanza en Y.
    const a = r({ text: 'ab', xPt: 300, yPt: 100, anguloDeg: 90 });
    const b = r({ text: 'cd', xPt: 300, yPt: 110, anguloDeg: 90 });
    const l = agruparLineasEditables([a, b]);
    expect(l.map((x) => x.text)).toEqual(['abcd']);
    expect(l[0]!.anguloDeg).toBe(90);
  });
});

describe('agruparLineasEditables: con el motor real', () => {
  test('por-glifo.pdf p1: 335 objetos de un glifo → 20 líneas, SIN fusionar columnas ni celdas', async () => {
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(fixture('por-glifo.pdf'));
    const runs = eng.getPageText(doc, 0);
    expect(runs).toHaveLength(335);
    const lineas = agruparLineasEditables(runs, 0);
    expect(lineas.map((l) => l.text)).toEqual([
      'Tabla de cifras',
      'Columna izquierda uno', 'Columna izquierda dos', 'Columna derecha uno', 'Columna derecha dos',
      'Bloque amplio izquierdo', 'Bloque amplio derecho',
      'Estilo mixto: normal NEGRITA y fin.',
      'uno dos tres cuatro cinco seis',
      'E=mc2 fin.',
      'Celda A1', 'Celda B1', 'Celda C1', 'Celda A2', 'Celda B2', 'Celda C2',
      'Texto girado',
      'Texto con recorte activo',
      'Capa OCR invisible',
      'Texto NEGRITA final'
    ]);
    eng.close(doc);
  });

  test('por-glifo.pdf: las líneas multiestilo conservan sus tramos y las demás tienen uno', async () => {
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(fixture('por-glifo.pdf'));
    const lineas = agruparLineasEditables(eng.getPageText(doc, 0), 0);
    const multi = lineas.filter((l) => l.estilos.length > 1);
    expect(multi.map((l) => l.text)).toEqual(['Estilo mixto: normal NEGRITA y fin.', 'E=mc2 fin.', 'Texto NEGRITA final']);
    const mixta = lineas.find((l) => l.text.startsWith('Estilo mixto'))!;
    expect(mixta.estilos.map((e) => [mixta.text.slice(e.inicio, e.fin), e.fontName, e.color.slice(0, 3).join(',')])).toEqual([
      ['Estilo mixto: normal ', 'Helvetica', '0,0,0'],
      ['NEGRITA', 'Helvetica-Bold', '255,0,0'],
      [' y fin.', 'Helvetica', '0,0,0']
    ]);
    // Tamaño efectivo 11 pt en todos los tramos (E-080).
    for (const e of mixta.estilos) expect(e.sizeEfectivoPt).toBeCloseTo(11, 1);
    // El título es negrita.
    expect(lineas[0]!.estilos[0]!.fontName).toBe('Helvetica-Bold');
    eng.close(doc);
  });

  test('por-glifo.pdf: la línea girada conserva su dirección y la capa invisible su línea propia', async () => {
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(fixture('por-glifo.pdf'));
    const lineas = agruparLineasEditables(eng.getPageText(doc, 0), 0);
    expect(lineas.find((l) => l.text === 'Texto girado')!.anguloDeg).toBe(90);
    expect(lineas.find((l) => l.text === 'Capa OCR invisible')!.runIds).toHaveLength(18);
    for (const l of lineas.filter((x) => x.text !== 'Texto girado')) expect(l.anguloDeg).toBe(0);
    eng.close(doc);
  });

  test('por-glifo.pdf p2 (/Rotate 90): 2 líneas', async () => {
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(fixture('por-glifo.pdf'));
    expect(agruparLineasEditables(eng.getPageText(doc, 1), 1).map((l) => l.text)).toEqual(['Pagina girada', 'Linea uno de la pagina girada']);
    eng.close(doc);
  });

  test('nativo.pdf queda igual: 8 objetos → 8 líneas, una por objeto', async () => {
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(fixture('nativo.pdf'));
    const runs = eng.getPageText(doc, 0);
    const lineas = agruparLineasEditables(runs, 0);
    expect(runs).toHaveLength(8);
    expect(lineas).toHaveLength(8);
    expect(lineas.map((l) => l.text)).toEqual(runs.map((x) => x.text));
    expect(lineas.every((l) => l.runIds.length === 1)).toBe(true);
    eng.close(doc);
  });

  test('cid-subconjunto.pdf: una línea por objeto', async () => {
    const eng = await PdfiumEngine.create();
    const doc = await eng.open(fixture('cid-subconjunto.pdf'));
    expect(agruparLineasEditables(eng.getPageText(doc, 0), 0).map((l) => l.text)).toEqual(['HOLA MUNDO', 'UNA MANO']);
    eng.close(doc);
  });
});
