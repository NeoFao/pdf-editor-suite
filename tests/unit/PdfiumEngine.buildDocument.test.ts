import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { PageOp } from '../../src/engine/PdfEngine';

/** E-121: `buildDocumentFromPages` equivale a «páginas en blanco + applyPageOps sobre el documento completo». */
const textoOp = (x: number, y: number, text: string): PageOp => ({ type: 'insertText', spec: { xPt: x, yPt: y, text, sizePt: 12, fontName: 'Helvetica' } });

test('E-121: buildDocumentFromPages da las mismas páginas, textos y posiciones que aplicar las ops sobre el documento completo', async () => {
  const engine = await PdfiumEngine.create();
  const paginas = [
    { widthPt: 612, heightPt: 792, ops: [textoOp(50, 700, 'uno'), { type: 'fillRect', rect: { xPt: 10, yPt: 10, wPt: 100, hPt: 20 }, color: [255, 0, 0] } as PageOp] },
    { widthPt: 792, heightPt: 612, ops: [] as PageOp[] }, // apaisada y sin ops: queda en blanco
    { widthPt: 612, heightPt: 792, ops: [textoOp(60, 650, 'tres'), { type: 'addLink', rect: { xPt: 60, yPt: 650, wPt: 40, hPt: 12 }, url: 'https://example.com/x' } as PageOp] }
  ];
  const avances: number[] = [];
  const nuevo = await engine.buildDocumentFromPages(paginas, (hechas) => avances.push(hechas));

  // Referencia: la ruta antigua (blancas importadas + un applyPageOps por página sobre el mismo documento).
  const blanco = engine.createBlank(612, 792);
  const ref = await engine.open(blanco);
  engine.importPages(ref, engine.createBlank(792, 612), 1);
  engine.importPages(ref, blanco, 2);
  paginas.forEach((p, i) => { if (p.ops.length) engine.applyPageOps(ref, i, p.ops); });

  expect(engine.pageCount(nuevo)).toBe(3);
  expect(avances.at(-1)).toBe(3);
  for (let i = 0; i < 3; i++) {
    expect(engine.pageSize(nuevo, i)).toEqual(engine.pageSize(ref, i));
    expect(engine.getPageText(nuevo, i)).toEqual(engine.getPageText(ref, i));
    expect(engine.getLinks(nuevo, i)).toEqual(engine.getLinks(ref, i));
  }
  expect(JSON.stringify(engine.getLinks(nuevo, 2))).toContain('https://example.com/x');
  engine.close(nuevo);
  engine.close(ref);
});

test('E-121: buildDocumentFromPages sin páginas es un error claro', async () => {
  const engine = await PdfiumEngine.create();
  await expect(engine.buildDocumentFromPages([])).rejects.toThrow(/al menos una página/);
});
