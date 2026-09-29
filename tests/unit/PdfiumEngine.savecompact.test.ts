import { test, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

async function nuevoDoc(): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return d.save();
}

/**
 * E-038 (docs/ERRORES-CONOCIDOS.md): cada `FPDFPage_GenerateContent()` crea
 * un stream de contenido NUEVO para la página y actualiza `/Contents` para
 * apuntar a él, pero el stream ANTERIOR sigue vivo en la tabla de objetos
 * del documento en memoria — `save()` lo sigue escribiendo aunque ya nada lo
 * referencie. Medido antes del arreglo: 100 `editTextRun` alternando dos
 * textos sobre el MISMO run hacían crecer `save()` de 1536 a 26766 bytes
 * (~17×) con el mismo contenido final; `save(open(save()))` (reabrir y
 * volver a guardar) lo dejaba en 1443 bytes — la prueba de que son huérfanos,
 * no contenido real. `saveCompact()` hace ese mismo `open(bytes)+save()` sin
 * mutar `doc` ni obligar al llamador a orquestar el reload.
 */
test('E-038: saveCompact tras 100 editTextRun pesa ~igual que sin ediciones, con el mismo texto final', async () => {
  const eng = await PdfiumEngine.create();

  const docBase = await eng.open(await nuevoDoc());
  eng.insertText(docBase, 0, { xPt: 20, yPt: 700, text: 'AAAA', sizePt: 12 });
  const baseBytes = await eng.saveCompact(docBase);
  eng.close(docBase);

  const doc = await eng.open(await nuevoDoc());
  const runId = eng.insertText(doc, 0, { xPt: 20, yPt: 700, text: 'AAAA', sizePt: 12 });
  for (let i = 0; i < 100; i++) {
    eng.editTextRun(doc, 0, runId, i % 2 === 0 ? 'BBBB' : 'AAAA'); // termina en 'AAAA' (i=99 es impar -> 'AAAA')
  }

  const directBytes = eng.save(doc);
  const compactBytes = await eng.saveCompact(doc);

  // El arreglo: el guardado compacto no arrastra los 100 streams huérfanos.
  expect(compactBytes.length).toBeLessThanOrEqual(baseBytes.length * 1.1);
  // Y el guardado DIRECTO (sin compactar) sí los arrastraba — se conserva la
  // comparación para que quede constancia numérica del defecto original.
  expect(directBytes.length).toBeGreaterThan(baseBytes.length * 2);

  // Mismo contenido final, se guarde compacto o no.
  const docCompacto = await eng.open(compactBytes);
  const textos = eng.getPageText(docCompacto, 0).map((r) => r.text);
  expect(textos).toEqual(['AAAA']);
  eng.close(docCompacto);

  eng.close(doc);
});

test('E-038: saveCompact NO muta el documento vivo (equivalente a E-005 para la app nueva)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await nuevoDoc());
  const runId = eng.insertText(doc, 0, { xPt: 20, yPt: 700, text: 'AAAA', sizePt: 12 });
  for (let i = 0; i < 20; i++) eng.editTextRun(doc, 0, runId, i % 2 === 0 ? 'BBBB' : 'AAAA');

  const primera = await eng.saveCompact(doc);
  const segunda = await eng.saveCompact(doc);

  expect(segunda.length).toBe(primera.length);
  expect(eng.getPageText(doc, 0)).toHaveLength(1); // el doc vivo sigue teniendo un único run, no duplicado

  eng.close(doc);
});

test('E-038: extractPages ya es inmune a los huérfanos por construcción (no hace falta saveCompact ahí)', async () => {
  // Hallazgo negativo, documentado también en ERRORES-CONOCIDOS.md: a
  // diferencia de save() (que reescribe el MISMO documento en memoria,
  // arrastrando cualquier stream huérfano), extractPages() construye un
  // documento NUEVO importando solo las páginas pedidas (FPDF_ImportPages) —
  // al analizarlas, el motor solo trae los objetos alcanzables desde esas
  // páginas, así que los huérfanos se quedan fuera sin necesidad de
  // open()+save() extra. splitByRange()/extractCurrent() en App.ts NO usan
  // saveCompact por esto.
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await nuevoDoc());
  const runId = eng.insertText(doc, 0, { xPt: 20, yPt: 700, text: 'AAAA', sizePt: 12 });
  for (let i = 0; i < 100; i++) eng.editTextRun(doc, 0, runId, i % 2 === 0 ? 'BBBB' : 'AAAA');

  const directBytes = eng.save(doc);
  const extraido = eng.extractPages(doc, [0]);

  expect(directBytes.length).toBeGreaterThan(20_000); // arrastra los 100 huérfanos
  expect(extraido.length).toBeLessThan(directBytes.length / 10); // extractPages no

  eng.close(doc);
});

/**
 * La propiedad que protege el defecto no es "tarda poco" (frágil bajo carga,
 * ver docs/TESTING.md) sino "el coste extra de saveCompact() sobre save() es
 * CONSTANTE: exactamente un save(doc) + un open(bytes) + un save(tmp) +
 * un close(tmp), sin importar cuántas ediciones (ni cuántos streams
 * huérfanos) tenga el documento". Se comprueba contando llamadas con
 * vi.spyOn en vez de cronometrando.
 */
test('E-038: el coste extra de saveCompact frente a save() es CONSTANTE (una llamada a save/open/close), no crece con el número de ediciones', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await nuevoDoc());
  const runId = eng.insertText(doc, 0, { xPt: 20, yPt: 700, text: 'AAAA', sizePt: 12 });
  for (let i = 0; i < 100; i++) eng.editTextRun(doc, 0, runId, i % 2 === 0 ? 'BBBB' : 'AAAA');

  const spySave = vi.spyOn(eng, 'save');
  const spyOpen = vi.spyOn(eng, 'open');
  const spyClose = vi.spyOn(eng, 'close');

  await eng.saveCompact(doc);

  // save(doc) + save(tmp): dos, no una por cada uno de los 100 editTextRun.
  expect(spySave).toHaveBeenCalledTimes(2);
  // open(bytes) del documento temporal: una sola vez.
  expect(spyOpen).toHaveBeenCalledTimes(1);
  // close(tmp): una sola vez (el doc original NO se cierra: E-038 exige que
  // saveCompact no mute ni cierre el documento vivo).
  expect(spyClose).toHaveBeenCalledTimes(1);

  spySave.mockRestore();
  spyOpen.mockRestore();
  spyClose.mockRestore();
  eng.close(doc);
});
