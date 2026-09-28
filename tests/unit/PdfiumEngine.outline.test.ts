import { test, expect } from 'vitest';
import { PDFDocument, PDFName, PDFHexString, type PDFPage } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

/**
 * Construye un outline (marcadores) de bajo nivel con la API `context.obj` /
 * `context.register` de pdf-lib, que no ofrece un helper de alto nivel para
 * esto. `nodos` describe el árbol como una lista de
 * `{ title, page, children }`; el destino de cada nodo es `[pageRef /Fit]`
 * (E-0xx / spec de marcadores: el título va en `PDFHexString.fromText` para
 * que los caracteres no ASCII —Ñ, la raya— viajen en UTF-16, tal como los lee
 * `FPDFBookmark_GetTitle`).
 */
function construirOutline(
  doc: PDFDocument,
  nodos: Array<{ title: string; page: PDFPage; children?: Array<{ title: string; page: PDFPage }> }>
): void {
  const { context, catalog } = doc;
  const dest = (page: PDFPage) => context.obj([page.ref, PDFName.of('Fit')]);

  const refs = nodos.map(() => context.nextRef());
  const rootRef = context.nextRef();

  nodos.forEach((nodo, i) => {
    const hijos = nodo.children ?? [];
    const hijoRefs = hijos.map(() => context.nextRef());

    hijos.forEach((hijo, j) => {
      context.assign(hijoRefs[j]!, context.obj({
        Title: PDFHexString.fromText(hijo.title),
        Parent: refs[i]!,
        ...(j > 0 ? { Prev: hijoRefs[j - 1]! } : {}),
        ...(j < hijos.length - 1 ? { Next: hijoRefs[j + 1]! } : {}),
        Dest: dest(hijo.page)
      }));
    });

    context.assign(refs[i]!, context.obj({
      Title: PDFHexString.fromText(nodo.title),
      Parent: rootRef,
      ...(i > 0 ? { Prev: refs[i - 1]! } : {}),
      ...(i < nodos.length - 1 ? { Next: refs[i + 1]! } : {}),
      Dest: dest(nodo.page),
      ...(hijos.length > 0 ? { First: hijoRefs[0]!, Last: hijoRefs[hijoRefs.length - 1]!, Count: hijos.length } : {})
    }));
  });

  context.assign(rootRef, context.obj({
    Type: 'Outlines',
    First: refs[0]!,
    Last: refs[refs.length - 1]!,
    Count: nodos.length
  }));

  catalog.set(PDFName.of('Outlines'), rootRef);
}

async function crearMarcadores(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([320, 200]);
  const p2 = doc.addPage([320, 200]);
  const p3 = doc.addPage([320, 200]);
  construirOutline(doc, [
    { title: 'Capítulo 1', page: p1, children: [{ title: 'Sección 1.1', page: p2 }] },
    { title: 'Capítulo 2 — Ñandú', page: p3 }
  ]);
  return doc.save();
}

/** Sin /Outlines en el catálogo: documento nativo sin marcadores. */
async function crearSinMarcadores(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([320, 200]);
  return doc.save();
}

/** Outline hostil: el /Next del segundo nodo apunta de vuelta al primero (ciclo entre hermanos). */
async function crearOutlineCiclo(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p1 = doc.addPage([320, 200]);
  const p2 = doc.addPage([320, 200]);

  const { context, catalog } = doc;
  const dest = (page: PDFPage) => context.obj([page.ref, PDFName.of('Fit')]);
  const rootRef = context.nextRef();
  const nodoARef = context.nextRef();
  const nodoBRef = context.nextRef();

  context.assign(rootRef, context.obj({ Type: 'Outlines', First: nodoARef, Last: nodoBRef, Count: 2 }));
  context.assign(nodoARef, context.obj({ Title: PDFHexString.fromText('Nodo A'), Parent: rootRef, Next: nodoBRef, Dest: dest(p1) }));
  // Hostil: en vez de terminar la lista, el segundo nodo vuelve a apuntar al primero.
  context.assign(nodoBRef, context.obj({ Title: PDFHexString.fromText('Nodo B'), Parent: rootRef, Next: nodoARef, Dest: dest(p2) }));

  catalog.set(PDFName.of('Outlines'), rootRef);
  return doc.save();
}

test('getOutline devuelve el árbol exacto: títulos con Ñ y raya, pageIndex y anidación', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearMarcadores());

  const outline = eng.getOutline(doc);

  expect(outline).toHaveLength(2);
  expect(outline[0]!.title).toBe('Capítulo 1');
  expect(outline[0]!.pageIndex).toBe(0);
  expect(outline[0]!.children).toHaveLength(1);
  expect(outline[0]!.children[0]!.title).toBe('Sección 1.1');
  expect(outline[0]!.children[0]!.pageIndex).toBe(1);
  expect(outline[0]!.children[0]!.children).toEqual([]);

  expect(outline[1]!.title).toBe('Capítulo 2 — Ñandú');
  expect(outline[1]!.pageIndex).toBe(2);
  expect(outline[1]!.children).toEqual([]);

  eng.close(doc);
});

test('getOutline devuelve [] cuando el documento no tiene marcadores', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearSinMarcadores());

  expect(eng.getOutline(doc)).toEqual([]);

  eng.close(doc);
});

test('getOutline termina sin colgarse ante un outline hostil con un ciclo, y visita cada nodo como mucho una vez', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await crearOutlineCiclo());

  const outline = eng.getOutline(doc);

  // Si no terminara, el test no llegaría aquí (timeout). El ciclo A→B→A se
  // corta al reencontrar A: la lista de hermanos se detiene con A y B, cada
  // uno una sola vez.
  expect(outline.map((n) => n.title)).toEqual(['Nodo A', 'Nodo B']);

  eng.close(doc);
});
