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

test('word-tabla-imagen.docx: la tabla se aplana y se avisa de la tabla y de la imagen omitidas', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  const { pdf, advertencias } = await conversor.convertir('word-tabla-imagen.docx', leerFixture('word-tabla-imagen.docx'));

  expect(advertencias.some((a) => /tabla/i.test(a))).toBe(true);
  expect(advertencias.some((a) => /imagen/i.test(a))).toBe(true);

  const doc = await engine.open(pdf);
  const texto = engine.getPageText(doc, 0).map((r) => r.text).join(' ');
  expect(texto).toContain('Producto');
  expect(texto).toContain('Manzanas');
  engine.close(doc);
});

test('word-hostil.docx (zip bomb real) se rechaza con DocxError, sin colgarse ni agotar memoria', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  await expect(conversor.convertir('word-hostil.docx', leerFixture('word-hostil.docx'))).rejects.toThrow(DocxError);
});
