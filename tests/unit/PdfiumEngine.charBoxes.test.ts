import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

async function abrir() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 200]);
  p.drawText('HOLA MUNDO', { x: 40, y: 150, size: 20, font: f, color: rgb(0, 0, 0) });
  p.drawText('segunda linea', { x: 40, y: 110, size: 12, font: f });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  return { eng, doc };
}

test('getCharBoxes: el texto por carácter coincide con getPageText y cada carácter visible tiene caja dentro de la de su run', async () => {
  const { eng, doc } = await abrir();
  const chars = eng.getCharBoxes(doc, 0);
  const runs = eng.getPageText(doc, 0);
  const visible = chars.filter((c) => !/[\r\n]/.test(c.ch)).map((c) => c.ch).join('');
  expect(visible).toBe(runs.map((r) => r.text).join(''));
  // Cada carácter con caja cae dentro de la caja de algún run (tolerancia 1 pt).
  for (const c of chars.filter((x) => x.boxPt.wPt > 0 && x.ch.trim() !== '')) {
    const dentro = runs.some((r) => c.boxPt.xPt >= r.boxPt.xPt - 1 && c.boxPt.xPt + c.boxPt.wPt <= r.boxPt.xPt + r.boxPt.wPt + 1);
    expect(dentro, c.ch).toBe(true);
  }
  // El orden es de lectura: la primera "H" empieza en x≈40 y avanza a la derecha.
  const H = chars[0]!;
  expect(H.ch).toBe('H');
  expect(H.boxPt.xPt).toBeGreaterThan(39); // caja del glifo: el 'side bearing' lo separa un par de pt de x=40
  expect(H.boxPt.xPt).toBeLessThan(44);
  expect(chars[1]!.boxPt.xPt).toBeGreaterThan(H.boxPt.xPt);
  eng.close(doc);
});
