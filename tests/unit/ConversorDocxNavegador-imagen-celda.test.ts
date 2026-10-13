import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-110 con el motor REAL: `word-imagen-celda.docx` (ver `generar-fixtures.mjs`): una fila de 2 columnas de 150 pt (x = 72 y 222;
 * relleno 5 pt => interior de 140 pt). Celda A: PNG de 40 x 20 pt centrado. Celda B: PNG de 280 x 70 pt, más ancho que el interior
 * (se escala a 140 x 35). Unidades: pt de página, y hacia ARRIBA. Los números son copia deliberada del generador (ese módulo ejecuta
 * `main()` al importarlo).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const COL_X = [72, 222], INTERIOR = 140, RELLENO = 5, TOL = 0.75;
const A = { w: 40, h: 20 }, B = { w: 280, h: 70 };

test('word-imagen-celda.docx (E-110): imágenes en línea de celda como objetos imagen, centrada y escalada al interior, y la fila crece con ellas', async () => {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-imagen-celda.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  expect(textosAdvertencias(advertencias)).toEqual([]);
  const doc = await engine.open(pdf);
  const imgs = engine.listImageObjects(doc, 0).map((o) => o.rectPt).sort((p, q) => p.xPt - q.xPt);
  expect(imgs).toHaveLength(2);
  const [a, b] = imgs as [typeof imgs[number], typeof imgs[number]];

  // Geometría esperada. Borde superior de la fila = 792 - 72 (margen) - 6 (hueco previo a la tabla) = 714.
  const filaTop = 792 - 72 - 6;
  const escalaB = Math.min(1, INTERIOR / B.w);
  const bW = B.w * escalaB, bH = B.h * escalaB; // 140 x 35
  const alturaFila = Math.max(A.h, bH) + RELLENO * 2; // 45

  // A: 40 x 20 centrada en el interior [77, 217]; pegada al relleno superior.
  expect(a.wPt).toBeCloseTo(A.w, 0);
  expect(a.hPt).toBeCloseTo(A.h, 0);
  expect(Math.abs(a.xPt - (COL_X[0]! + RELLENO + (INTERIOR - A.w) / 2))).toBeLessThanOrEqual(TOL);
  expect(Math.abs(a.yPt + a.hPt - (filaTop - RELLENO))).toBeLessThanOrEqual(TOL);
  // B: escalada proporcionalmente al ancho interior (140 x 35), en el borde interior izquierdo de su celda.
  expect(Math.abs(b.wPt - bW)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(b.hPt - bH)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(b.xPt - (COL_X[1]! + RELLENO))).toBeLessThanOrEqual(TOL);
  expect(Math.abs(b.yPt + b.hPt - (filaTop - RELLENO))).toBeLessThanOrEqual(TOL);
  // Ambas dentro de su celda (x) y de la fila (y).
  for (const [im, k] of [[a, 0], [b, 1]] as const) {
    expect(im.xPt).toBeGreaterThanOrEqual(COL_X[k]! + RELLENO - TOL);
    expect(im.xPt + im.wPt).toBeLessThanOrEqual(COL_X[k]! + RELLENO + INTERIOR + TOL);
    expect(im.yPt).toBeGreaterThanOrEqual(filaTop - alturaFila - TOL);
  }

  // Altura de fila: el párrafo de detrás arranca 8 pt (hueco posterior a la tabla) bajo el borde inferior de la fila (línea de 12 pt;
  // su tinta cae entre la base de la línea y su borde superior).
  const lineaTop = filaTop - alturaFila - 8;
  const chars = engine.getCharBoxes(doc, 0).filter((c) => c.ch.trim() !== '');
  const tintaArriba = Math.max(...chars.map((c) => c.boxPt.yPt + c.boxPt.hPt));
  expect(tintaArriba).toBeLessThanOrEqual(lineaTop + TOL);
  expect(tintaArriba).toBeGreaterThan(lineaTop - 12);
  const baseline = lineaTop - 12 * (1 - 0.28);
  expect(Math.abs(Math.min(...chars.map((c) => c.boxPt.yPt)) - baseline)).toBeLessThanOrEqual(3);
}, 60000);
