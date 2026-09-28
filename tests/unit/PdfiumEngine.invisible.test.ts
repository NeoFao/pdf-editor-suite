import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

test('insertText con invisible:true es buscable pero no se ve al renderizar', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  eng.insertText(doc, 0, { xPt: 40, yPt: 100, text: 'BUSCABLE', sizePt: 16, invisible: true });

  // Buscable/extraíble: getPageText lo encuentra.
  const runs = eng.getPageText(doc, 0);
  const run = runs.find((r) => r.text.includes('BUSCABLE'));
  expect(run).toBeDefined();

  // No se ve: al renderizar, ningún píxel queda oscuro.
  const { data } = eng.renderPage(doc, 0, 1);
  for (let i = 0; i < data.length; i += 4) {
    expect(data[i]!).toBeGreaterThan(200);
    expect(data[i + 1]!).toBeGreaterThan(200);
    expect(data[i + 2]!).toBeGreaterThan(200);
  }
  eng.close(doc);
});
