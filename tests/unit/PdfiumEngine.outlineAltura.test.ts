import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { OutlineItem } from '../../src/engine/PdfEngine';
import { cambiarDestino, sinPaginaBorrada } from '../../src/outline/arbol';

/** E-114: un marcador puede llevar la altura del destino (`yPt`, [página /XYZ null y null]); sin ella sigue siendo [página /Fit]. */
async function docConPaginas(n: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([320, 200]);
  return d.save();
}

const ARBOL: OutlineItem[] = [
  { title: 'Con altura', pageIndex: 1, yPt: 123.5, children: [{ title: 'Hijo con altura', pageIndex: 2, yPt: 40, children: [] }] },
  { title: 'Sin altura', pageIndex: 0, children: [] }
];

test('setOutline con yPt: tras guardar y reabrir se relee la pagina y la altura; sin yPt no aparece la clave', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConPaginas(3));
  eng.setOutline(doc, ARBOL);
  const doc2 = await eng.open(eng.save(doc));
  const leido = eng.getOutline(doc2);
  expect(leido).toHaveLength(2);
  expect(leido[0]).toMatchObject({ title: 'Con altura', pageIndex: 1 });
  expect(leido[0]!.yPt).toBeCloseTo(123.5, 2);
  expect(leido[0]!.children[0]).toMatchObject({ title: 'Hijo con altura', pageIndex: 2 });
  expect(leido[0]!.children[0]!.yPt).toBeCloseTo(40, 2);
  expect(leido[1]).toEqual({ title: 'Sin altura', pageIndex: 0, children: [] });
  expect('yPt' in leido[1]!).toBe(false);
  eng.close(doc2);
});

test('reapuntar un marcador a otra pagina descarta la altura (era de la pagina anterior) y borrar una pagina anterior la conserva', () => {
  expect(cambiarDestino(ARBOL, [0], 2)![0]!.yPt).toBeUndefined();
  expect(cambiarDestino(ARBOL, [0], 2)![0]!.pageIndex).toBe(2);
  const tras = sinPaginaBorrada(ARBOL, 0)!;
  expect(tras.map((i) => [i.title, i.pageIndex, i.yPt])).toEqual([['Con altura', 0, 123.5]]);
});
