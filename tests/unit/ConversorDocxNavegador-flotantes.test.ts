import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { PageOp } from '../../src/engine/PdfEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * Imágenes flotantes de Word con el motor REAL: `word-flotantes.docx` (ver `generar-fixtures.mjs`), Carta con márgenes de 72 pt,
 * una página por modo de ajuste. Unidades: pt de página, y hacia ARRIBA (origen abajo-izquierda). Los números son copia
 * deliberada del generador (ese módulo ejecuta `main()` al importarlo).
 *   P1 `wrapSquare`: cuadrado de 100 pt pegado al margen derecho, en el tope del párrafo -> x = 540 - 100 = 440, y = 720 - 100 = 620.
 *   P2 `wrapTopAndBottom`: 200x80 centrada -> x = 72 + (468 - 200) / 2 = 206, y = 720 - 80 = 640; el texto empieza bajo 640 - 10.
 *   P3 `wrapNone`: azul detrás en (300, 400 desde arriba) y amarilla delante en (330, 410): y = 792 - 400 - 50 = 342 y 792 - 410 - 50 = 332.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const TOL = 1;

async function convertir() {
  const engine = await PdfiumEngine.create();
  const operaciones = new Map<number, PageOp[]>();
  // E-121: el lote de cada página llega ahora por `buildDocumentFromPages` (una entrada por página), no por applyPageOps(doc, pagina, ops).
  const original = engine.buildDocumentFromPages.bind(engine);
  engine.buildDocumentFromPages = (paginas, alProgreso) => { paginas.forEach((p, i) => operaciones.set(i, p.ops)); return original(paginas, alProgreso); };
  const nombre = 'word-flotantes.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  return { engine, doc: await engine.open(pdf), advertencias: textosAdvertencias(advertencias), operaciones };
}

test('word-flotantes.docx: tres páginas, una imagen cada una salvo la última (dos), y ningún aviso (los tres modos son exactos)', async () => {
  const { engine, doc, advertencias } = await convertir();
  expect(advertencias).toEqual([]);
  expect(engine.pageCount(doc)).toBe(3);
  expect([0, 1, 2].map((p) => engine.listImageObjects(doc, p).length)).toEqual([1, 1, 2]);
  engine.close(doc);
});

test('wrapSquare: la imagen está en su x/y y NINGUNA línea de texto que se cruza con su banda invade la imagen ni sus 9 pt de separación', async () => {
  const { engine, doc } = await convertir();
  const img = engine.listImageObjects(doc, 0)[0]!.rectPt;
  expect(Math.abs(img.wPt - 100)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(img.xPt - 440)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(img.yPt - 620)).toBeLessThanOrEqual(TOL);

  const runs = engine.getPageText(doc, 0).filter((r) => r.text.includes('cuad'));
  const enBanda = runs.filter((r) => r.boxPt.yPt < img.yPt + img.hPt && r.boxPt.yPt + r.boxPt.hPt > img.yPt);
  expect(enBanda.length).toBeGreaterThanOrEqual(5);
  for (const r of enBanda) expect(r.boxPt.xPt + r.boxPt.wPt).toBeLessThanOrEqual(img.xPt - 9 + TOL);
  // Bajo la imagen el texto vuelve a usar todo el ancho útil.
  const debajo = runs.filter((r) => r.boxPt.yPt + r.boxPt.hPt <= img.yPt - TOL);
  expect(Math.max(...debajo.map((r) => r.boxPt.xPt + r.boxPt.wPt))).toBeGreaterThan(img.xPt + 20);
  // No se pierde ninguna palabra y siguen en orden.
  const nums = [...engine.getPageText(doc, 0).map((r) => r.textoReal).join(' ').matchAll(/cuad(\d+)/g)].map((m) => Number(m[1]));
  expect(nums).toEqual(Array.from({ length: 150 }, (_v, i) => i + 1));
  engine.close(doc);
});

test('wrapTopAndBottom: imagen centrada entre márgenes y todo el texto empieza por debajo de ella (más sus 10 pt)', async () => {
  const { engine, doc } = await convertir();
  const img = engine.listImageObjects(doc, 1)[0]!.rectPt;
  expect(Math.abs(img.xPt - 206)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(img.yPt - 640)).toBeLessThanOrEqual(TOL);
  expect([Math.round(img.wPt), Math.round(img.hPt)]).toEqual([200, 80]);
  const runs = engine.getPageText(doc, 1);
  expect(runs.some((r) => r.text.includes('TITULOBAJO'))).toBe(true);
  for (const r of runs) expect(r.boxPt.yPt + r.boxPt.hPt).toBeLessThanOrEqual(img.yPt - 10 + TOL);
  engine.close(doc);
});

test('wrapNone: ambas imágenes en su sitio, el texto pasa POR ENCIMA de la de detrás sin apartarse, y la de delante se dibuja DESPUÉS del texto', async () => {
  const { engine, doc, operaciones } = await convertir();
  const imgs = engine.listImageObjects(doc, 2).map((o) => o.rectPt).sort((a, b) => a.xPt - b.xPt);
  const [azul, amarilla] = imgs as [typeof imgs[number], typeof imgs[number]];
  expect([Math.round(azul.xPt), Math.round(azul.yPt)]).toEqual([300, 342]);
  expect([Math.round(amarilla.xPt), Math.round(amarilla.yPt)]).toEqual([330, 332]);

  // El texto cruza el rectángulo de la azul: hay líneas que llegan hasta x > 400 en su banda (no se apartan).
  const enBanda = engine.getPageText(doc, 2).filter((r) => r.boxPt.yPt < azul.yPt + azul.hPt && r.boxPt.yPt + r.boxPt.hPt > azul.yPt);
  expect(enBanda.length).toBeGreaterThan(0);
  expect(Math.max(...enBanda.map((r) => r.boxPt.xPt + r.boxPt.wPt))).toBeGreaterThan(azul.xPt + azul.wPt);
  expect(Math.min(...enBanda.map((r) => r.boxPt.xPt))).toBeLessThanOrEqual(72 + TOL); // y empiezan en el margen izquierdo

  // Orden de dibujo: imagen de detrás < todo el texto < imagen de delante.
  const ops = operaciones.get(2)!;
  const idx = (f: (o: PageOp) => boolean): number[] => ops.flatMap((o, i) => (f(o) ? [i] : []));
  const imagenes = idx((o) => o.type === 'insertImage');
  const textos = idx((o) => o.type === 'insertText');
  expect(imagenes).toHaveLength(2);
  const delanteDeOp = (i: number): number => { const o = ops[i]!; return o.type === 'insertImage' ? o.spec.xPt : -1; };
  const [detras, delante] = [...imagenes].sort((a, b) => delanteDeOp(a) - delanteDeOp(b)) as [number, number];
  expect(detras).toBeLessThan(Math.min(...textos));
  expect(delante).toBeGreaterThan(Math.max(...textos));
  engine.close(doc);
});
