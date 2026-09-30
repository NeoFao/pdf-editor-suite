import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { DocxError } from '../../src/convert/docx/DocxError';

// NOTA: no se importan las constantes de texto (DOCX_TITULO...) desde
// `generar-fixtures.mjs` a propósito: ese módulo ejecuta `main()` (que
// REGENERA los fixtures en disco y puede `process.exit(1)`) como efecto
// secundario de importarlo. Los literales de abajo son una copia deliberada
// de los mismos textos que ese generador escribe en `word-basico.docx`.

/**
 * Conversor con el motor REAL (no el `medir` falso de `docx-modelo.test.ts`
 * ni de `flujo-layout.test.ts`): comprueba que el PDF que sale de
 * `word-basico.docx` es vectorial de verdad (ningún objeto imagen), trae la
 * ñ y el título con el tamaño/negrita esperados, y que los ficheros con
 * contenido no soportado devuelven advertencias en vez de fallar o perder
 * el contenido en silencio. Espejo de `ConversorMarkdownNavegador.test.ts`.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(AQUI, '../fixtures/generados');

function leerFixture(nombre: string): Uint8Array {
  return new Uint8Array(fs.readFileSync(path.join(FIXTURES, nombre)));
}

test('word-basico.docx produce un PDF de 2 páginas, vectorial, con el título en Helvetica-Bold y la ñ presente', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  const { pdf, advertencias } = await conversor.convertir('word-basico.docx', leerFixture('word-basico.docx'));
  expect(advertencias).toEqual([]);

  const doc = await engine.open(pdf);
  const n = engine.pageCount(doc);
  expect(n).toBe(2);

  const runsPagina1 = engine.getPageText(doc, 0);
  const titulo = runsPagina1.find((r) => r.text.includes('Título'));
  expect(titulo).toBeDefined();
  expect(titulo!.fontName).toContain('Helvetica-Bold');

  const textoPagina1 = runsPagina1.map((r) => r.text).join(' ');
  expect(textoPagina1).toMatch(/ñ/);

  const textoPagina2 = engine.getPageText(doc, 1).map((r) => r.text).join(' ');
  expect(textoPagina2).toContain('Contenido');

  for (let p = 0; p < n; p++) expect(engine.listImageObjects(doc, p)).toEqual([]);

  engine.close(doc);
});

test('word-tabla-imagen.docx: la tabla sale como rejilla real y la imagen como objeto imagen, sin advertencias de tabla/imagen (fase 2a)', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  const { pdf, advertencias } = await conversor.convertir('word-tabla-imagen.docx', leerFixture('word-tabla-imagen.docx'));

  // Ya no se aplana: ninguna advertencia debe mencionar la tabla ni la imagen inline como omitidas.
  expect(advertencias.some((a) => /tabla/i.test(a))).toBe(false);
  expect(advertencias.some((a) => /imagen/i.test(a))).toBe(false);

  const doc = await engine.open(pdf);
  const runs = engine.getPageText(doc, 0);
  const texto = runs.map((r) => r.text).join(' ');
  expect(texto).toContain('Producto');
  expect(texto).toContain('Manzanas');

  // Rejilla real: la X de las celdas de la 2ª columna ("Precio"/"3,50") es mayor que la de la 1ª ("Producto"/"Manzanas").
  const xProducto = runs.find((r) => r.text.includes('Producto'))!.boxPt.xPt;
  const xPrecio = runs.find((r) => r.text.includes('Precio'))!.boxPt.xPt;
  expect(xPrecio).toBeGreaterThan(xProducto);
  const xManzanas = runs.find((r) => r.text.includes('Manzanas'))!.boxPt.xPt;
  const xImporte = runs.find((r) => r.text.includes('3,50'))!.boxPt.xPt;
  expect(xImporte).toBeGreaterThan(xManzanas);

  // La imagen es un objeto imagen real, del tamaño declarado (457200 EMU / 12700 = 36pt), ±1pt.
  const imagenes = engine.listImageObjects(doc, 0);
  expect(imagenes).toHaveLength(1);
  expect(imagenes[0]!.rectPt.wPt).toBeCloseTo(36, 0);
  expect(imagenes[0]!.rectPt.hPt).toBeCloseTo(36, 0);

  engine.close(doc);
});

test('word-completo.docx: tabla con encabezado/combinación/sombreado, imagen y enlaces (uno válido, uno rechazado por esquema)', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  const { pdf, advertencias } = await conversor.convertir('word-completo.docx', leerFixture('word-completo.docx'));

  // El enlace javascript: se avisa; ni tabla ni imagen generan advertencia.
  expect(advertencias.some((a) => /enlace/i.test(a))).toBe(true);
  expect(advertencias.some((a) => /tabla/i.test(a))).toBe(false);
  expect(advertencias.some((a) => /imagen/i.test(a))).toBe(false);

  const doc = await engine.open(pdf);
  const runs = engine.getPageText(doc, 0);
  const texto = runs.map((r) => r.text).join(' ');
  expect(texto).toContain('Encabezado combinado');
  expect(texto).toContain('A1');
  expect(texto).toContain('Ir a example.com');
  expect(texto).toContain('enlace peligroso');

  expect(engine.listImageObjects(doc, 0)).toHaveLength(1);

  // La anotación /Link con la URI válida persiste en el PDF guardado; la de javascript: nunca se creó.
  const crudo = Buffer.from(engine.save(doc)).toString('latin1');
  expect(crudo).toContain('/Link');
  expect(crudo).toContain('https://example.com');
  expect(crudo).not.toContain('javascript:alert');

  engine.close(doc);
});

test('word-hostil.docx (zip bomb real) se rechaza con DocxError, sin colgarse ni agotar memoria', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  await expect(conversor.convertir('word-hostil.docx', leerFixture('word-hostil.docx'))).rejects.toThrow(DocxError);
});
