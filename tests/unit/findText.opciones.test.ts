import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { buscarEnRuns } from '../../src/texto/buscarReemplazar';

const LINEAS = [
  'Casa casa CASA cAsA',
  'casado casas (casa), casa-casa',
  'la casa_roja y 1casa casa1',
  'inter',
  'nacional casa',
  'año años añoranza a á a1',
  'ñcasa casañ ácasa'
];

async function motorYDoc() {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([400, 300]);
  LINEAS.forEach((l, i) => p.drawText(l, { x: 20, y: 280 - i * 26, size: 14, font: f, color: rgb(0, 0, 0) }));
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  return { eng, doc };
}

const CASOS = [
  { q: 'casa', mayusculas: false, palabraCompleta: false },
  { q: 'casa', mayusculas: true, palabraCompleta: false },
  { q: 'casa', mayusculas: false, palabraCompleta: true },
  { q: 'casa', mayusculas: true, palabraCompleta: true },
  { q: 'Casa', mayusculas: true, palabraCompleta: true },
  { q: 'casa', mayusculas: false, palabraCompleta: true },
  { q: 'CASA', mayusculas: true, palabraCompleta: true },
  { q: 'año', mayusculas: false, palabraCompleta: true },
  { q: 'a', mayusculas: false, palabraCompleta: true },
  { q: 'AÑO', mayusculas: false, palabraCompleta: false },
  { q: 'casa', mayusculas: false, palabraCompleta: true }
];

test('findText con opciones y buscarEnRuns cuentan EXACTAMENTE lo mismo (mismo criterio)', async () => {
  const { eng, doc } = await motorYDoc();
  const runs = eng.getPageText(doc, 0).map((r) => ({ runId: r.runId, text: r.text }));
  for (const c of CASOS) {
    const pdfium = eng.findText(doc, 0, c.q, { mayusculas: c.mayusculas, palabraCompleta: c.palabraCompleta }).length;
    const puro = buscarEnRuns(runs, c.q, c).dentro.length;
    expect({ caso: c, n: pdfium }).toEqual({ caso: c, n: puro });
  }
  eng.close(doc);
});

test('findText sin opciones sigue siendo insensible a mayúsculas (compatibilidad)', async () => {
  const { eng, doc } = await motorYDoc();
  const base = eng.findText(doc, 0, 'casa').length;
  expect(eng.findText(doc, 0, 'casa', {}).length).toBe(base);
  expect(eng.findText(doc, 0, 'casa', { mayusculas: true }).length).toBeLessThan(base);
  eng.close(doc);
});
