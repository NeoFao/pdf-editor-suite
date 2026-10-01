import { test, expect } from 'vitest';
import { PDFDocument, PDFName, PDFHexString, type PDFPage } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { OutlineItem } from '../../src/engine/PdfEngine';

async function docConPaginas(n: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([320, 200]);
  return d.save();
}

/** Outline hostil: A→B→A por /Next. */
async function outlineCiclo(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([320, 200]);
  const p2 = doc.addPage([320, 200]);
  const { context, catalog } = doc;
  const dest = (page: PDFPage) => context.obj([page.ref, PDFName.of('Fit')]);
  const root = context.nextRef(), a = context.nextRef(), b = context.nextRef();
  context.assign(root, context.obj({ Type: 'Outlines', First: a, Last: b, Count: 2 }));
  context.assign(a, context.obj({ Title: PDFHexString.fromText('A'), Parent: root, Next: b, Dest: dest(p1) }));
  context.assign(b, context.obj({ Title: PDFHexString.fromText('B'), Parent: root, Next: a, Dest: dest(p2) }));
  catalog.set(PDFName.of('Outlines'), root);
  return doc.save();
}

const ARBOL: OutlineItem[] = [
  {
    title: 'Capítulo ñandú 😀', pageIndex: 0, children: [
      { title: 'Sección 1.1 — “comillas”', pageIndex: 1, children: [{ title: 'Apartado 1.1.1 🚀', pageIndex: 2, children: [] }] },
      { title: 'Sección 1.2', pageIndex: 1, children: [] }
    ]
  },
  { title: 'Capítulo 2', pageIndex: 2, children: [] },
  { title: 'Sin destino', pageIndex: null, children: [] }
];

test('setOutline: el árbol escrito se relee idéntico tras guardar y reabrir (ñ, emoji, 3 niveles)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConPaginas(3));
  eng.setOutline(doc, ARBOL);
  expect(eng.getOutline(doc)).toEqual(ARBOL);

  const guardado = eng.save(doc);
  const doc2 = await eng.open(guardado);
  expect(eng.getOutline(doc2)).toEqual(ARBOL);
  eng.close(doc); eng.close(doc2);
});

test('setOutline reemplaza por completo un outline previo y [] lo vacía', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConPaginas(3));
  eng.setOutline(doc, ARBOL);
  const nuevo: OutlineItem[] = [{ title: 'Solo', pageIndex: 2, children: [] }];
  eng.setOutline(doc, nuevo);
  expect(eng.getOutline(doc)).toEqual(nuevo);
  eng.setOutline(doc, []);
  const doc2 = await eng.open(eng.save(doc));
  expect(eng.getOutline(doc2)).toEqual([]);
  eng.close(doc); eng.close(doc2);
});

test('setOutline sobre un outline hostil con ciclo termina y deja el árbol pedido (E-031)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await outlineCiclo());
  eng.setOutline(doc, [{ title: 'Limpio', pageIndex: 0, children: [] }]);
  expect(eng.getOutline(doc)).toEqual([{ title: 'Limpio', pageIndex: 0, children: [] }]);
  eng.close(doc);
});

test('setOutline rechaza (sin tocar el documento) un árbol más profundo que OUTLINE_MAX_DEPTH', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConPaginas(1));
  eng.setOutline(doc, [{ title: 'Previo', pageIndex: 0, children: [] }]);
  let hostil: OutlineItem = { title: 'hoja', pageIndex: 0, children: [] };
  for (let i = 0; i < 40; i++) hostil = { title: `n${i}`, pageIndex: 0, children: [hostil] };
  expect(() => eng.setOutline(doc, [hostil])).toThrow(/profundidad/i);
  expect(eng.getOutline(doc).map((n) => n.title)).toEqual(['Previo']);
  eng.close(doc);
});

test('setOutline rechaza un árbol con más de OUTLINE_MAX_NODES nodos', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConPaginas(1));
  const muchos: OutlineItem[] = Array.from({ length: 10001 }, (_, i) => ({ title: `n${i}`, pageIndex: 0, children: [] }));
  expect(() => eng.setOutline(doc, muchos)).toThrow(/nodos/i);
  expect(eng.getOutline(doc)).toEqual([]);
  eng.close(doc);
});

test('setOutline: una página fuera de rango se escribe sin destino (pageIndex null)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConPaginas(2));
  eng.setOutline(doc, [{ title: 'Fuera', pageIndex: 99, children: [] }]);
  expect(eng.getOutline(doc)).toEqual([{ title: 'Fuera', pageIndex: null, children: [] }]);
  eng.close(doc);
});
