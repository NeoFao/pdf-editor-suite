import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { fixture } from './_util/fixtures';

/**
 * E-081: `FPDFText_SetText(obj, "")` provoca `RuntimeError: unreachable` y mata el WASM del motor (todas las páginas
 * abiertas quedan inservibles). El motor lo prohíbe: una línea no puede quedar vacía; borrarla es eliminar el objeto.
 */
test('editTextRun con cadena vacía devuelve empty-text, no toca el PDF y el motor sigue vivo', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('nativo.pdf'));
  const antes = eng.getPageText(doc, 0)[1]!.text;
  expect(eng.editTextRun(doc, 0, 1, '')).toEqual({ ok: false, reason: 'empty-text' });
  // El motor no murió: sigue leyendo y editando.
  expect(eng.getPageText(doc, 0)[1]!.text).toBe(antes);
  expect(eng.editTextRun(doc, 0, 1, 'Sigo vivo')).toEqual({ ok: true });
  expect(eng.getPageText(doc, 0)[1]!.text).toBe('Sigo vivo');
  eng.close(doc);
});

test('insertText con texto vacío lanza un error recuperable en vez de matar el motor', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('nativo.pdf'));
  expect(() => eng.insertText(doc, 0, { xPt: 10, yPt: 10, text: '', sizePt: 12 })).toThrow(/vac/i);
  expect(eng.getPageText(doc, 0).length).toBeGreaterThan(0); // el motor sigue vivo
  eng.close(doc);
});

test('borrar la línea con deleteRun sí funciona (el borrado elimina el objeto)', async () => {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('nativo.pdf'));
  const n = eng.getPageText(doc, 0).length;
  expect(eng.deleteRun(doc, 0, 1)).toBe(true);
  expect(eng.getPageText(doc, 0)).toHaveLength(n - 1);
  eng.close(doc);
});
