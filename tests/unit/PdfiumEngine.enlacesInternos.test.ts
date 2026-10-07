import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

/** Documento de 3 páginas de 300x200 pt (origen abajo-izquierda). */
async function abrir() {
  const d = await PDFDocument.create();
  for (let i = 0; i < 3; i++) d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  return { eng, doc: await eng.open(await d.save()) };
}

test('addInternalLink crea una /Link GoTo [página /XYZ x y] que getLinks lee, y persiste tras save + abrir', async () => {
  const { eng, doc } = await abrir();
  const ok = eng.addInternalLink(doc, 0, { xPt: 40, yPt: 120, wPt: 160, hPt: 24 }, 2, 150);
  expect(ok).toBe(true);

  const leer = (d: typeof doc) => eng.getLinks(d, 0);
  const antes = leer(doc);
  expect(antes).toHaveLength(1);
  expect(antes[0]!.rectPt).toEqual({ xPt: 40, yPt: 120, wPt: 160, hPt: 24 });
  expect(antes[0]!.destino).toEqual({ tipo: 'pagina', pageIndex: 2, yPt: 150 });

  const doc2 = await eng.open(eng.save(doc));
  const despues = eng.getLinks(doc2, 0);
  expect(despues).toHaveLength(1);
  expect(despues[0]!.destino).toEqual({ tipo: 'pagina', pageIndex: 2, yPt: 150 });
  eng.close(doc); eng.close(doc2);
});

test('getLinks distingue enlaces externos (URI) de internos y no confunde páginas sin enlaces', async () => {
  const { eng, doc } = await abrir();
  expect(eng.getLinks(doc, 1)).toEqual([]);
  eng.addLink(doc, 0, { xPt: 10, yPt: 10, wPt: 50, hPt: 20 }, 'https://example.com/x');
  eng.addInternalLink(doc, 0, { xPt: 10, yPt: 50, wPt: 50, hPt: 20 }, 1, 100);
  const l = eng.getLinks(doc, 0);
  expect(l.map((e) => e.destino)).toEqual([{ tipo: 'uri', uri: 'https://example.com/x' }, { tipo: 'pagina', pageIndex: 1, yPt: 100 }]);
  eng.close(doc);
});

test('addInternalLink rechaza una página de destino fuera de rango o no finita, sin crear nada', async () => {
  const { eng, doc } = await abrir();
  const r = { xPt: 10, yPt: 10, wPt: 50, hPt: 20 };
  expect(eng.addInternalLink(doc, 0, r, 3, 10)).toBe(false);
  expect(eng.addInternalLink(doc, 0, r, -1, 10)).toBe(false);
  expect(eng.addInternalLink(doc, 0, r, 1, Number.NaN)).toBe(false);
  expect(eng.getLinks(doc, 0)).toEqual([]);
  eng.close(doc);
});
