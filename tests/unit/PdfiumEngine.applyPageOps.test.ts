import { test, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { PageOp } from '../../src/engine/PdfEngine';
import type { Pdfium } from '../../src/engine/pdfium/loadEngine';

async function nuevoDoc(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return d.save();
}

/**
 * E-037 (docs/ERRORES-CONOCIDOS.md): cada método unitario del motor que
 * dibuja/inserta texto (`insertText`, `fillRect`,
 * `drawStroke`, `drawRect`) hacía `FPDF_LoadPage` → mutar →
 * `FPDFPage_GenerateContent` → `FPDF_ClosePage` POR LLAMADA.
 * `FPDFPage_GenerateContent` reserializa TODO el contenido ya insertado en
 * la página, así que N llamadas sueltas sobre la misma página cuestan O(N²):
 * medido antes del arreglo, 200 `insertText` uno a uno tardaban ~1,3 s
 * (frente a ~30 ms para 20). `applyPageOps` carga la página una sola vez,
 * aplica N operaciones y regenera el contenido una sola vez al final.
 */
/**
 * La propiedad que protege el defecto no es "tarda poco" (un umbral en
 * milisegundos es frágil bajo carga y no prueba lo que dice proteger, ver
 * docs/TESTING.md) sino "UNA sola llamada a FPDFPage_GenerateContent por
 * invocación de applyPageOps, sin importar cuántas ops traiga el lote". Se
 * espía el objeto del módulo WASM directamente.
 */
test('E-037: 200 insertText por applyPageOps en un solo lote hacen UNA sola llamada a FPDFPage_GenerateContent, no 200', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await nuevoDoc());
  const ops: PageOp[] = Array.from({ length: 200 }, (_v, i) => ({
    type: 'insertText',
    spec: { xPt: 20, yPt: 20 + (i % 30) * 20, text: `linea ${i} de texto de prueba`, sizePt: 10 }
  }));

  const p = (eng as unknown as { p: Pdfium }).p;
  const spyGenerateContent = vi.spyOn(p, 'FPDFPage_GenerateContent');

  const results = eng.applyPageOps(doc, 0, ops);

  expect(results).toHaveLength(200);
  expect(spyGenerateContent).toHaveBeenCalledTimes(1); // no 200 — ese era el O(N²) de E-037
  spyGenerateContent.mockRestore();

  expect(eng.getPageText(doc, 0)).toHaveLength(200);
  eng.close(doc);
});

test('E-037: applyPageOps en lote produce el MISMO contenido que aplicar cada op una a una', async () => {
  const eng = await PdfiumEngine.create();

  const specs = Array.from({ length: 12 }, (_v, i) => ({
    xPt: 30 + i * 2,
    yPt: 700 - i * 20,
    text: `texto ${i}`,
    sizePt: 11,
    color: [10, 20, 30] as [number, number, number]
  }));

  const docLote = await eng.open(await nuevoDoc());
  eng.applyPageOps(docLote, 0, specs.map((spec) => ({ type: 'insertText' as const, spec })));

  const docUnaAUna = await eng.open(await nuevoDoc());
  for (const spec of specs) eng.insertText(docUnaAUna, 0, spec);

  const runsLote = eng.getPageText(docLote, 0).map((r) => ({ text: r.text, sizePt: Math.round(r.sizePt), color: r.color }));
  const runsUnaAUna = eng.getPageText(docUnaAUna, 0).map((r) => ({ text: r.text, sizePt: Math.round(r.sizePt), color: r.color }));

  expect(runsLote).toEqual(runsUnaAUna);

  eng.close(docLote);
  eng.close(docUnaAUna);
});

test('E-037: applyPageOps mezcla fillRect/drawStroke/drawRect/insertText en un solo lote', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await nuevoDoc());

  const ops: PageOp[] = [
    { type: 'fillRect', rect: { xPt: 10, yPt: 10, wPt: 40, hPt: 8 }, color: [255, 0, 0] },
    { type: 'drawStroke', points: [{ xPt: 0, yPt: 0 }, { xPt: 50, yPt: 50 }], color: [0, 0, 255], widthPt: 1 },
    { type: 'drawRect', rect: { xPt: 60, yPt: 60, wPt: 20, hPt: 20 }, color: [0, 128, 0], widthPt: 1 },
    { type: 'insertText', spec: { xPt: 20, yPt: 700, text: 'hola', sizePt: 12 } }
  ];

  const results = eng.applyPageOps(doc, 0, ops);
  expect(results.map((r) => r.type)).toEqual(['fillRect', 'drawStroke', 'drawRect', 'insertText']);
  expect(results.every((r) => (r.type === 'insertText' ? r.runId >= 0 : r.ok))).toBe(true);

  expect(eng.listPathObjects(doc, 0)).toHaveLength(3); // fillRect + drawStroke + drawRect, todos son PATH
  expect(eng.getPageText(doc, 0)).toHaveLength(1);
  eng.close(doc);
});

test('E-037: dentro de un lote, un drawRect < 3×3 y un drawStroke de un solo punto se rechazan sin tocar el resto', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await nuevoDoc());

  const ops: PageOp[] = [
    { type: 'drawRect', rect: { xPt: 10, yPt: 10, wPt: 1, hPt: 1 }, color: [0, 0, 0], widthPt: 1 }, // rechazado: clic, no arrastre
    { type: 'drawStroke', points: [{ xPt: 5, yPt: 5 }], color: [0, 0, 0], widthPt: 1 },             // rechazado: un solo punto
    { type: 'fillRect', rect: { xPt: 10, yPt: 10, wPt: 40, hPt: 8 }, color: [255, 0, 0] }            // válido
  ];

  const results = eng.applyPageOps(doc, 0, ops);
  expect(results[0]).toEqual({ type: 'drawRect', ok: false });
  expect(results[1]).toEqual({ type: 'drawStroke', ok: false });
  expect(results[2]).toEqual({ type: 'fillRect', ok: true });
  expect(eng.listPathObjects(doc, 0)).toHaveLength(1); // solo el fillRect válido
  eng.close(doc);
});

test('E-037: applyPageOps con un array vacío no revienta y no toca la página', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await nuevoDoc());
  expect(eng.applyPageOps(doc, 0, [])).toEqual([]);
  expect(eng.getPageText(doc, 0)).toEqual([]);
  eng.close(doc);
});
