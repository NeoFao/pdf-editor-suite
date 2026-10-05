import { test, expect } from 'vitest';
import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

test('setNoteText reescribe /Contents y persiste tras guardar y reabrir (ñ, emoji, texto largo)', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const idx = eng.addNote(doc, 0, { xPt: 50, yPt: 150, text: 'original' });

  const nuevo = 'Año nuevo ñandú 🎉 — revisar';
  expect(eng.setNoteText(doc, 0, idx, nuevo)).toBe(true);
  expect(eng.getNotes(doc, 0)[0]!.text).toBe(nuevo);

  const doc2 = await eng.open(eng.save(doc));
  expect(eng.getNotes(doc2, 0)[0]!.text).toBe(nuevo);

  const largo = 'y'.repeat(5000);
  expect(eng.setNoteText(doc2, 0, idx, largo)).toBe(true);
  expect(eng.getNotes(doc2, 0)[0]!.text).toBe(largo);

  expect(eng.setNoteText(doc2, 0, 99, 'x')).toBe(false);
  eng.close(doc);
  eng.close(doc2);
});

test('getComments lee autor (/T), tipo y texto; incluye anotaciones ajenas con /Contents y excluye enlaces', async () => {
  const d = await PDFDocument.create();
  const page = d.addPage([300, 200]);
  const ctx = d.context;
  const mk = (extra: Record<string, unknown>) => ctx.register(ctx.obj({ Type: 'Annot', ...extra }));
  const refs = [
    mk({ Subtype: 'Text', Rect: [10, 10, 30, 30], Contents: PDFHexString.fromText('Nota con autor'), T: PDFHexString.fromText('Ñoño') }),
    mk({ Subtype: 'Highlight', Rect: [10, 50, 100, 62], QuadPoints: [10, 62, 100, 62, 10, 50, 100, 50], Contents: PDFString.of('Comentario del resaltado') }),
    mk({ Subtype: 'Highlight', Rect: [10, 80, 100, 92], QuadPoints: [10, 92, 100, 92, 10, 80, 100, 80] }), // sin /Contents: SÍ se lista (T11: el marcado se lista siempre, como Acrobat)
    mk({ Subtype: 'Link', Rect: [10, 100, 50, 120], Contents: PDFString.of('enlace') })
  ];
  page.node.set(PDFName.of('Annots'), ctx.obj(refs));
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  const c = eng.getComments(doc, 0);
  expect(c.map((x) => x.kind)).toEqual(['note', 'highlight', 'highlight']);
  expect(c[0]!.text).toBe('Nota con autor');
  expect(c[0]!.author).toBe('Ñoño');
  expect(c[0]!.index).toBe(0);
  expect(c[1]!.text).toBe('Comentario del resaltado');
  expect(c[1]!.author).toBe('');
  expect(c[1]!.index).toBe(1);
  // setNoteText sirve también para anotaciones de marcado ajenas, no para enlaces.
  expect(eng.setNoteText(doc, 0, 1, 'Editado')).toBe(true);
  expect(eng.getComments(doc, 0)[1]!.text).toBe('Editado');
  expect(eng.setNoteText(doc, 0, 3, 'x')).toBe(false);
  eng.close(doc);
});
