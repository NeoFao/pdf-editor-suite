import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

test('insertImage conserva el canal alfa: los píxeles transparentes no salen negros tras guardar y reabrir', async () => {
  const d = await PDFDocument.create();
  d.addPage([100, 100]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  const w = 2, h = 2;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    // Todo el bitmap fuente es negro; solo el primer píxel es opaco, el resto transparente.
    rgba[i * 4] = 0; rgba[i * 4 + 1] = 0; rgba[i * 4 + 2] = 0;
    rgba[i * 4 + 3] = i === 0 ? 255 : 0;
  }
  expect(eng.insertImage(doc, 0, { rgba, imgWidth: w, imgHeight: h, xPt: 10, yPt: 10, wPt: 80, hPt: 80 })).toBe(true);

  const reabierto = await eng.open(eng.save(doc));
  const scale = 2;
  const { width, data } = eng.renderPage(reabierto, 0, scale);
  // Región ocupada por la imagen en px de render: x en [10,90]pt, y en [10,90]pt → en px: [20,180]x[20,180] (100pt página × escala 2, Y invertida).
  const x0 = 10 * scale, x1 = 90 * scale, y0 = 10 * scale, y1 = 90 * scale;
  let blancos = 0, total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const idx = (y * width + x) * 4;
      total++;
      if (data[idx]! > 200 && data[idx + 1]! > 200 && data[idx + 2]! > 200) blancos++;
    }
  }
  console.log('fracción blanca:', blancos / total, 'total', total);
  // 3 de los 4 píxeles fuente son transparentes: la mayoría del área debe salir blanca (fondo), no negra.
  expect(blancos / total).toBeGreaterThan(0.5);
  eng.close(doc);
});
