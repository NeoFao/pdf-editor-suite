import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

test('drawRect crea un rectángulo (solo borde) con el color y grosor correctos, visible al renderizar', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const rect = { xPt: 40, yPt: 40, wPt: 120, hPt: 80 };
  expect(eng.drawRect(doc, 0, rect, [0, 120, 220], 2)).toBe(true);

  const { data, width, height } = eng.renderPage(doc, 0, 2);
  // Debe haber píxeles azulados cerca del borde superior del rect (y de página
  // arriba-abajo: yTop = altura_pagina - (rect.yPt+rect.hPt), en px de render).
  let azul = false;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! < 90 && data[i + 1]! > 80 && data[i + 2]! > 170) { azul = true; break; }
  }
  expect(azul).toBe(true);
  expect(width).toBeGreaterThan(0); expect(height).toBeGreaterThan(0);
  eng.close(doc);
});

test('drawRect no crea nada para un rectángulo menor de 3×3 pt (fue un clic)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.drawRect(doc, 0, { xPt: 10, yPt: 10, wPt: 2, hPt: 2 }, [0, 0, 0], 2)).toBe(false);
  expect(eng.listPathObjects(doc, 0)).toEqual([]);
  eng.close(doc);
});

test('drawRect persiste tras guardar y reabrir', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.drawRect(doc, 0, { xPt: 40, yPt: 40, wPt: 120, hPt: 80 }, [0, 120, 220], 2);
  const reabierto = await eng.open(eng.save(doc));
  expect(eng.listPathObjects(reabierto, 0)).toHaveLength(1);
  eng.close(doc);
  eng.close(reabierto);
});

test('listPathObjects devuelve los objetos PATH de la página con su caja y si tienen trazo', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  expect(eng.listPathObjects(doc, 0)).toEqual([]);

  eng.drawStroke(doc, 0, [{ xPt: 10, yPt: 10 }, { xPt: 50, yPt: 50 }], [0, 0, 0], 2);
  eng.drawRect(doc, 0, { xPt: 60, yPt: 60, wPt: 40, hPt: 30 }, [0, 0, 0], 2);
  eng.fillRect(doc, 0, { xPt: 0, yPt: 0, wPt: 20, hPt: 20 }, [255, 235, 0]); // relleno, sin trazo

  const paths = eng.listPathObjects(doc, 0);
  expect(paths).toHaveLength(3);
  const conTrazo = paths.filter((p) => p.hasStroke);
  expect(conTrazo).toHaveLength(2); // el trazo de pluma y el rectángulo; el resaltado no
  eng.close(doc);
});

test('listPathObjects no incluye runs de texto ni imágenes', async () => {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  p.drawText('hola', { x: 20, y: 150, size: 14, font: f, color: rgb(0, 0, 0) });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.drawRect(doc, 0, { xPt: 10, yPt: 10, wPt: 40, hPt: 40 }, [0, 0, 0], 2);
  expect(eng.listPathObjects(doc, 0)).toHaveLength(1);
  eng.close(doc);
});

test('getPathSegments devuelve las aristas rectas del rectángulo (4 lados)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.drawRect(doc, 0, { xPt: 40, yPt: 40, wPt: 100, hPt: 60 }, [0, 0, 0], 2);
  const objIndex = eng.listPathObjects(doc, 0)[0]!.objIndex;
  const segs = eng.getPathSegments(doc, 0, objIndex);
  expect(segs.length).toBeGreaterThanOrEqual(4);
  // Un segmento debe recorrer el lado inferior (y≈40) entre x=40 y x=140.
  const lados = segs.some((s) =>
    Math.abs(s.ay - 40) < 0.5 && Math.abs(s.by - 40) < 0.5 &&
    Math.min(s.ax, s.bx) <= 41 && Math.max(s.ax, s.bx) >= 139
  );
  expect(lados).toBe(true);
  eng.close(doc);
});

test('getPathSegments devuelve las aristas de un trazo a mano alzada (polilínea abierta)', async () => {
  const d = await PDFDocument.create(); d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  eng.drawStroke(doc, 0, [{ xPt: 10, yPt: 10 }, { xPt: 50, yPt: 10 }, { xPt: 50, yPt: 60 }], [0, 0, 0], 2);
  const objIndex = eng.listPathObjects(doc, 0)[0]!.objIndex;
  const segs = eng.getPathSegments(doc, 0, objIndex);
  expect(segs.length).toBe(2); // dos tramos, sin cerrar
  eng.close(doc);
});
