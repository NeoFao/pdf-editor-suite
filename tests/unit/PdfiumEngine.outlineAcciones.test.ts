import { test, expect } from 'vitest';
import { PDFDocument, PDFName, PDFHexString, PDFString } from 'pdf-lib';

type DatosAccion = Parameters<PDFDocument['context']['obj']>[0];
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

/** Outline plano de bajo nivel: cada nodo con /Dest a su página o con una /A arbitraria. */
async function docConAcciones(especs: Array<{ title: string; pagina: number; accion?: () => DatosAccion }>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const paginas = [doc.addPage([320, 200]), doc.addPage([320, 200])];
  const { context, catalog } = doc;
  const root = context.nextRef();
  const refs = especs.map(() => context.nextRef());
  especs.forEach((e, i) => {
    context.assign(refs[i]!, context.obj({
      Title: PDFHexString.fromText(e.title),
      Parent: root,
      ...(i > 0 ? { Prev: refs[i - 1]! } : {}),
      ...(i < especs.length - 1 ? { Next: refs[i + 1]! } : {}),
      ...(e.accion ? { A: context.obj(e.accion()) } : { Dest: context.obj([paginas[e.pagina]!.ref, PDFName.of('Fit')]) })
    }));
  });
  context.assign(root, context.obj({ Type: 'Outlines', First: refs[0]!, Last: refs[refs.length - 1]!, Count: especs.length }));
  catalog.set(PDFName.of('Outlines'), root);
  return doc.save();
}

const uri = (u: string) => () => ({ S: 'URI', URI: PDFString.of(u) });

test('getOutline lee la acción URI de un marcador; el de página no lleva acción', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConAcciones([
    { title: 'Página', pagina: 1 },
    { title: 'Web', pagina: 0, accion: uri('https://example.com/a?b=1') }
  ]));
  expect(eng.getOutline(doc)).toEqual([
    { title: 'Página', pageIndex: 1, children: [] },
    { title: 'Web', pageIndex: null, children: [], accion: { tipo: 'uri', uri: 'https://example.com/a?b=1' } }
  ]);
  eng.close(doc);
});

test('renombrar el marcador de página deja intacto el marcador URI tras guardar y reabrir', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConAcciones([
    { title: 'Página', pagina: 1 },
    { title: 'Web', pagina: 0, accion: uri('mailto:a@b.es') }
  ]));
  const arbol = eng.getOutline(doc);
  arbol[0]!.title = 'Renombrado ñ 😀';
  eng.setOutline(doc, arbol);
  const re = await eng.open(eng.save(doc));
  expect(eng.getOutline(re)).toEqual([
    { title: 'Renombrado ñ 😀', pageIndex: 1, children: [] },
    { title: 'Web', pageIndex: null, children: [], accion: { tipo: 'uri', uri: 'mailto:a@b.es' } }
  ]);
  eng.close(doc); eng.close(re);
});

test.each([
  ['Launch', () => ({ S: 'Launch', F: PDFString.of('calc.exe') })],
  ['JavaScript', () => ({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') })],
  ['GoToR', () => ({ S: 'GoToR', F: PDFString.of('otro.pdf'), D: [0, PDFName.of('Fit')] })],
  ['URI con esquema peligroso', uri('javascript:alert(1)')]
])('un marcador %s se marca no-soportada y setOutline se niega a reescribir (el PDF no cambia)', async (_n, accion) => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConAcciones([
    { title: 'Página', pagina: 0 },
    { title: 'Peligro', pagina: 0, accion }
  ]));
  const arbol = eng.getOutline(doc);
  expect(arbol[1]!.accion?.tipo).toBe('no-soportada');
  expect(arbol[0]!.accion).toBeUndefined();
  const antes = eng.save(doc);
  arbol[0]!.title = 'Cambio';
  expect(() => eng.setOutline(doc, arbol)).toThrow(/acciones|soportada/i);
  expect(Buffer.from(eng.save(doc)).equals(Buffer.from(antes))).toBe(true);
  expect(eng.getOutline(doc)[0]!.title).toBe('Página');
  eng.close(doc);
});

test('setOutline rechaza un URI con esquema no permitido en el árbol que se le pasa', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await docConAcciones([{ title: 'P', pagina: 0 }]));
  expect(() => eng.setOutline(doc, [{ title: 'x', pageIndex: null, children: [], accion: { tipo: 'uri', uri: 'file:///etc/passwd' } }])).toThrow(/esquema/i);
  eng.close(doc);
});
