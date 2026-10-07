import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * Word fase 2c (§9 fila #4) con el motor REAL: varias secciones (tamaño de página, numeración, encabezados), imágenes y
 * tablas en el encabezado, texto alrededor de una imagen flotante y tabulaciones reales. Los literales son copia
 * deliberada de `generar-fixtures.mjs` (ese módulo ejecuta `main()` al importarlo, ver la nota de `ConversorDocxNavegador.test.ts`).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(AQUI, '../fixtures/generados');
const leer = (nombre: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(FIXTURES, nombre)));

async function convertir(nombre: string) {
  const engine = await PdfiumEngine.create();
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, leer(nombre));
  const doc = await engine.open(pdf);
  return { engine, doc, advertencias: textosAdvertencias(advertencias) };
}

test('word-secciones.docx: la tercera página sale apaisada (792 x 612), con SU encabezado y la numeración reiniciada', async () => {
  const { engine, doc, advertencias } = await convertir('word-secciones.docx');
  expect(advertencias).toEqual([]);
  expect(engine.pageCount(doc)).toBe(3);
  const tam = [0, 1, 2].map((p) => engine.pageSize(doc, p));
  expect(tam.map((t) => [Math.round(t.widthPt), Math.round(t.heightPt)])).toEqual([[612, 792], [612, 792], [792, 612]]);

  const texto = (p: number): string => engine.getPageText(doc, p).map((r) => r.text).join(' ');
  expect(texto(0)).toContain('Encabezado sección uno');
  expect(texto(1)).toContain('Encabezado sección uno');
  expect(texto(2)).toContain('Encabezado apaisado');
  expect(texto(2)).not.toContain('Encabezado sección uno');
  // Numeración: 1, 2 y, tras el reinicio, 1 otra vez; "de 3" es el total físico. El pie de la sección 2 lo HEREDA de la 1.
  expect(texto(0)).toContain('Página 1 de 3');
  expect(texto(1)).toContain('Página 2 de 3');
  expect(texto(2)).toContain('Página 1 de 3');
  expect(texto(2)).toContain('Texto de la sección apaisada.');
  // El pie de la página apaisada está centrado en SU ancho (396 pt), no en el de la vertical (306 pt).
  const pie = engine.getPageText(doc, 2).find((r) => r.text.includes('Página 1'))!;
  expect(Math.abs(pie.boxPt.xPt + pie.boxPt.wPt / 2 - 396)).toBeLessThan(3);
  // El encabezado cae en la parte alta de la página de 612 pt de alto.
  const cab = engine.getPageText(doc, 2).find((r) => r.text.includes('Encabezado apaisado'))!;
  expect(cab.boxPt.yPt).toBeGreaterThan(612 - 72);
  for (let p = 0; p < 3; p++) expect(engine.listImageObjects(doc, p)).toEqual([]);
  engine.close(doc);
});

test('word-encabezado-rico.docx: el logo y la tabla del encabezado salen en CADA página, arriba, sin avisos', async () => {
  const { engine, doc, advertencias } = await convertir('word-encabezado-rico.docx');
  expect(advertencias).toEqual([]);
  expect(engine.pageCount(doc)).toBe(3);
  for (let p = 0; p < 3; p++) {
    const imgs = engine.listImageObjects(doc, p);
    expect(imgs).toHaveLength(1);
    const r = imgs[0]!.rectPt;
    expect(Math.abs(r.wPt - 48)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.hPt - 24)).toBeLessThanOrEqual(1);
    // Encabezado a 18 pt del borde superior (360 twips): el logo cuelga de ahí.
    expect(Math.abs(r.yPt + r.hPt - (792 - 18))).toBeLessThanOrEqual(1.5);
    const runs = engine.getPageText(doc, p);
    const empresa = runs.find((x) => x.text.includes('Empresa S.A.'))!;
    const informe = runs.find((x) => x.text.includes('Informe mensual'))!;
    expect(empresa).toBeDefined();
    expect(informe.boxPt.xPt).toBeGreaterThan(empresa.boxPt.xPt + empresa.boxPt.wPt); // segunda columna a la derecha de la primera
    expect(empresa.boxPt.yPt).toBeLessThan(r.yPt); // la tabla va BAJO el logo
    // El cuerpo no pisa el encabezado: queda bajo la tabla.
    const cuerpo = runs.find((x) => x.text.includes('del informe'))!;
    expect(cuerpo.boxPt.yPt + cuerpo.boxPt.hPt).toBeLessThanOrEqual(empresa.boxPt.yPt + 0.5);
  }
  engine.close(doc);
});

test('word-ajuste.docx: las líneas que se cruzan con la imagen quedan a su izquierda; las demás usan todo el ancho; no se pierde ninguna palabra', async () => {
  const { engine, doc, advertencias } = await convertir('word-ajuste.docx');
  expect(advertencias.join(' | ')).not.toMatch(/ajuste de texto/i);
  const imgs = engine.listImageObjects(doc, 0);
  expect(imgs).toHaveLength(1);
  const img = imgs[0]!.rectPt;
  expect(Math.abs(img.wPt - 144)).toBeLessThanOrEqual(1);
  expect(Math.abs(img.xPt + img.wPt - 540)).toBeLessThanOrEqual(1); // pegada al margen derecho

  const runs = engine.getPageText(doc, 0).filter((r) => r.text.includes('texto'));
  const dentro = runs.filter((r) => r.boxPt.yPt >= img.yPt - 0.5 && r.boxPt.yPt + r.boxPt.hPt <= img.yPt + img.hPt + 0.5);
  expect(dentro.length).toBeGreaterThanOrEqual(6);
  for (const r of dentro) expect(r.boxPt.xPt + r.boxPt.wPt).toBeLessThanOrEqual(img.xPt - 9 + 1);
  // Debajo de la imagen el texto vuelve a ocupar todo el ancho útil (más allá del borde izquierdo de la imagen).
  const debajo = runs.filter((r) => r.boxPt.yPt + r.boxPt.hPt < img.yPt - 1);
  expect(debajo.length).toBeGreaterThan(0);
  expect(Math.max(...debajo.map((r) => r.boxPt.xPt + r.boxPt.wPt))).toBeGreaterThan(img.xPt + 20);
  // Ninguna palabra se pierde, y en orden.
  const todo = engine.getPageText(doc, 0).map((r) => r.textoReal).join(' ');
  const nums = [...todo.matchAll(/texto(\d+)/g)].map((m) => Number(m[1]));
  expect(nums).toEqual(Array.from({ length: 150 }, (_v, i) => i + 1));
  expect(todo).toContain('Párrafo final, debajo de todo.');
  engine.close(doc);
});

test('word-tabs.docx: el número del índice acaba en el margen derecho tras el líder de puntos; izquierda y decimal cuadran; el pie alinea "Página X de Y" a la derecha', async () => {
  const { engine, doc, advertencias } = await convertir('word-tabs.docx');
  expect(advertencias).toEqual([]);
  const runs = engine.getPageText(doc, 0);
  const fin = (r: { boxPt: { xPt: number; wPt: number } }): number => r.boxPt.xPt + r.boxPt.wPt;
  for (const [titulo, numero] of [['Capítulo uno', '3'], ['Capítulo dos', '17'], ['Anexo', '120']] as const) {
    const t = runs.find((r) => r.textoReal.trim() === titulo)!;
    expect(t).toBeDefined();
    const n = runs.find((r) => r.textoReal.trim() === numero && Math.abs(r.boxPt.yPt - t.boxPt.yPt) < 4)!;
    expect(Math.abs(fin(n) - 540)).toBeLessThanOrEqual(1.5);
    const puntos = runs.find((r) => /^\.{10,}$/.test(r.textoReal.trim()) && Math.abs(r.boxPt.yPt - t.boxPt.yPt) < 4 && r.boxPt.xPt > fin(t) - 1)!;
    expect(puntos).toBeDefined();
    expect(fin(puntos)).toBeLessThanOrEqual(n.boxPt.xPt + 0.5);
  }
  // Parada izquierda a 3600 twips (180 pt) desde el margen: "Valor" empieza en 72 + 180.
  const valor = runs.find((r) => r.textoReal.trim() === 'Valor')!;
  expect(Math.abs(valor.boxPt.xPt - 252)).toBeLessThanOrEqual(1);
  // Parada decimal a 5400 twips (270 pt): la coma de "1.234,50" cae en 72 + 270 = 342.
  const cifra = runs.find((r) => r.textoReal.trim() === '1.234,50')!;
  const antes = engine.measureText(cifra.fontName, cifra.sizePt, '1.234');
  expect(Math.abs(cifra.boxPt.xPt + antes - 342)).toBeLessThanOrEqual(1.5);
  // Pie: "Informe" a la izquierda y "Página 1 de 1" terminando en el margen derecho (parada derecha del estilo Footer).
  const informe = runs.find((r) => r.textoReal.trim() === 'Informe')!;
  expect(Math.abs(informe.boxPt.xPt - 72)).toBeLessThanOrEqual(1);
  const pagina = runs.find((r) => r.textoReal.includes('Página 1 de 1'))!;
  // (la caja del texto es la de los glifos; se compara el AVANCE medido, que es lo que usa el maquetador)
  expect(Math.abs(pagina.boxPt.xPt + engine.measureText(pagina.fontName, pagina.sizePt, pagina.textoReal.trim()) - 540)).toBeLessThanOrEqual(1);
  expect(pagina.boxPt.yPt).toBeLessThan(72);
  engine.close(doc);
});

test('word-numeracion-tabs.docx (E-101): los marcadores "iv.", "B)" y "xii." salen en el PDF y la tabulación de la celda cae en su parada', async () => {
  const { engine, doc, advertencias } = await convertir('word-numeracion-tabs.docx');
  expect(advertencias).toEqual([]);
  const runs = engine.getPageText(doc, 0);
  // Marcador y texto del ítem salen en la misma línea de texto extraída: "iv. cuatro", "B) beta", "xii. doce".
  const lineas = runs.map((r) => r.textoReal.trim());
  expect(lineas).toContain('iv. cuatro');
  expect(lineas).toContain('B) beta');
  expect(lineas).toContain('xii. doce');
  expect(lineas).toContain('i. uno');
  // Celda de la 2.ª columna: empieza en x = 72 + 150; su interior (relleno de 5 pt) en 227; parada izquierda a 50 pt => "Valor" en 277.
  const valor = runs.find((r) => r.textoReal.trim() === 'Valor')!;
  const concepto = runs.find((r) => r.textoReal.trim() === 'Concepto')!;
  expect(Math.abs(concepto.boxPt.xPt - 227)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(valor.boxPt.xPt - 277)).toBeLessThanOrEqual(1.5);
  engine.close(doc);
});
