import { textosAdvertencias } from '../../src/convert/advertencia';
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { DocxError } from '../../src/convert/docx/DocxError';
import { construirModeloDocx } from '../../src/convert/docx/modelo';
import { renderizarModeloDocx } from '../../src/convert/docx/render';

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
  expect(advertencias.some((a) => /tabla/i.test(a.mensaje))).toBe(false);
  expect(advertencias.some((a) => /imagen/i.test(a.mensaje))).toBe(false);

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
  expect(advertencias.some((a) => /enlace/i.test(a.mensaje))).toBe(true);
  expect(advertencias.some((a) => /tabla/i.test(a.mensaje))).toBe(false);
  expect(advertencias.some((a) => /imagen/i.test(a.mensaje))).toBe(false);

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

test('la línea base del texto de una celda cae ~13,6pt bajo el borde superior de la fila (relleno 5pt + 72% de la altura de línea), no pegada arriba', () => {
  const xml = `<w:document><w:body><w:tbl>
    <w:tblPr><w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/></w:tblBorders></w:tblPr>
    <w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid>
    <w:tr><w:tc><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:sz w:val="20"/></w:rPr><w:t>X</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl></w:body></w:document>`;
  const { trazos, barras } = renderizarModeloDocx(construirModeloDocx(xml, null, null), (_f, _s, t) => t.length * 5);
  const borde = barras.find((b) => b.hPt === 1 && b.wPt > 100)!; // borde superior de la fila (grosor 1pt)
  const topeFila = borde.yPt + borde.hPt;
  // Interlineado exacto de 12 pt (E-103: la celda aplica el interlineado de su párrafo); baseline a 5 + 12*0.72 = 13,64pt bajo el tope.
  expect(topeFila - trazos[0]!.yPt).toBeCloseTo(13.64, 1);
});

test('word-jpeg.docx en Node (sin createImageBitmap): la imagen NO se pierde en silencio, se avisa', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  const { pdf, advertencias } = await conversor.convertir('word-jpeg.docx', leerFixture('word-jpeg.docx'));
  expect(textosAdvertencias(advertencias).join(' | ')).toMatch(/imagen/i);
  const doc = await engine.open(pdf);
  expect(engine.listImageObjects(doc, 0)).toHaveLength(0);
  expect(engine.getPageText(doc, 0).map((r) => r.text).join(' ')).toContain('JPEG');
  engine.close(doc);
});

// ---------------------------------------------------------------------------
// Fase 2b (T6): encabezados/pies, título no huérfano, bordes por celda, imagen flotante.
// Los literales son copia deliberada de `generar-fixtures.mjs` (ver la nota de arriba).
// ---------------------------------------------------------------------------

test('word-encabezados.docx: 3 páginas; encabezado first en la 1, default en la 2 y 3; pie "Página N de 3" en todas, vectorial y sin avisos', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  const { pdf, advertencias } = await conversor.convertir('word-encabezados.docx', leerFixture('word-encabezados.docx'));
  expect(advertencias).toEqual([]);

  const doc = await engine.open(pdf);
  expect(engine.pageCount(doc)).toBe(3);
  const texto = (p: number): string => engine.getPageText(doc, p).map((r) => r.text).join(' ');

  expect(texto(0)).toContain('Encabezado de portada');
  expect(texto(0)).not.toContain('Encabezado general');
  for (const p of [1, 2]) {
    expect(texto(p)).toContain('Encabezado general');
    expect(texto(p)).not.toContain('Encabezado de portada');
  }
  // PAGE (w:fldSimple) y NUMPAGES (w:fldChar/w:instrText) resueltos con las dos pasadas.
  expect(texto(0)).toContain('Página 1 de 3');
  expect(texto(1)).toContain('Página 2 de 3');
  expect(texto(2)).toContain('Página 3 de 3');
  // El texto cacheado por Word ("1") no se duplica: el pie tiene EXACTAMENTE un "de".
  expect(texto(1).match(/ de /g)).toHaveLength(1);

  // Posición: el encabezado va arriba (dentro del margen de 72 pt) y el pie abajo.
  const cab = engine.getPageText(doc, 1).find((r) => r.text.includes('Encabezado general'))!;
  const pie = engine.getPageText(doc, 1).find((r) => r.text.includes('Página 2'))!;
  expect(cab.boxPt.yPt).toBeGreaterThan(792 - 72); // por encima del margen superior
  expect(pie.boxPt.yPt).toBeLessThan(72); // por debajo del margen inferior
  for (let p = 0; p < 3; p++) expect(engine.listImageObjects(doc, p)).toEqual([]);
  engine.close(doc);
});

test('word-encabezados.docx: el título que caería solo al pie de la página 1 se va a la 2 con su párrafo (no queda huérfano)', async () => {
  const engine = await PdfiumEngine.create();
  const { pdf } = await new ConversorDocxNavegador(engine).convertir('word-encabezados.docx', leerFixture('word-encabezados.docx'));
  const doc = await engine.open(pdf);
  const texto = (p: number): string => engine.getPageText(doc, p).map((r) => r.text).join(' ');
  expect(texto(0)).not.toContain('Resultados del informe');
  expect(texto(0)).toContain('Línea de relleno 52'); // la página 1 sí se llenó hasta el final
  expect(texto(1)).toContain('Resultados del informe');
  expect(texto(1)).toContain('Texto que acompaña al título.');
  // Y la tabla con bordes por celda llega entera con su texto.
  for (const celda of ['Celda A1', 'Celda B1', 'Celda A2', 'Celda B2']) expect(texto(1)).toContain(celda);
  expect(texto(2)).toContain('Contenido de la página tres.');
  engine.close(doc);
});

test('word-flotante.docx: la imagen flotante se coloca en su posición de página (72 pt, 144 pt desde arriba) y se avisa "sin ajuste de texto"', async () => {
  const engine = await PdfiumEngine.create();
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir('word-flotante.docx', leerFixture('word-flotante.docx'));
  expect(textosAdvertencias(advertencias).join(' | ')).toMatch(/imagen flotante colocada sin ajuste de texto/i);
  expect(textosAdvertencias(advertencias).join(' | ')).not.toMatch(/omiti/i);

  const doc = await engine.open(pdf);
  const imagenes = engine.listImageObjects(doc, 0);
  expect(imagenes).toHaveLength(1);
  const r = imagenes[0]!.rectPt;
  expect(Math.abs(r.xPt - 72)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.wPt - 72)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.hPt - 72)).toBeLessThanOrEqual(1);
  expect(Math.abs(r.yPt - (792 - 144 - 72))).toBeLessThanOrEqual(1); // y PDF: abajo-izquierda
  // El texto sigue en su sitio (no lo empuja la imagen): el primer párrafo arranca bajo el margen superior.
  const runs = engine.getPageText(doc, 0);
  expect(runs.map((x) => x.text).join(' ')).toContain('Texto del párrafo que ancla la imagen flotante.');
  expect(runs.find((x) => x.text.includes('Texto del párrafo'))!.boxPt.yPt).toBeGreaterThan(792 - 72 - 20);
  engine.close(doc);
});
