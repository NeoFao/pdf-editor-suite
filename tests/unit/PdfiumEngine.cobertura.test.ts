import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { fixture } from './_util/fixtures';

/**
 * E-079: en un subconjunto CID `FPDFFont_GetGlyphPath` dice que existen glifos que no están, así que `editTextRun`
 * aceptaba texto que se guardaba como `.notdef` y se perdía en la extracción. `cid-subconjunto.pdf` tiene solo los glifos
 * H O L A M U N D y el espacio.
 */
async function abrir() {
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(fixture('cid-subconjunto.pdf'));
  return { eng, doc };
}

test('el fixture es un subconjunto CID con "HOLA MUNDO" extraíble', async () => {
  const { eng, doc } = await abrir();
  const runs = eng.getPageText(doc, 0);
  expect(runs.map((r) => r.text)).toEqual(['HOLA MUNDO', 'UNA MANO']);
  expect(runs[0]!.fuenteSubconjunto).toBe(true);
  eng.close(doc);
});

test('editar con un carácter AUSENTE del subconjunto devuelve glyph-missing y no cambia nada', async () => {
  const { eng, doc } = await abrir();
  for (const texto of ['HOLA MUNDO €', 'HOLZ', 'QUE']) {
    expect(eng.editTextRun(doc, 0, 0, texto)).toEqual({ ok: false, reason: 'glyph-missing' });
    // Ni en memoria (la página se recarga) ni tras guardar y reabrir queda rastro del intento.
    expect(eng.getPageText(doc, 0)[0]!.text).toBe('HOLA MUNDO');
    const guardado = await eng.open(eng.save(doc));
    expect(eng.getPageText(guardado, 0)[0]!.text).toBe('HOLA MUNDO');
    eng.close(guardado);
  }
  eng.close(doc);
});

test('editar con glifos presentes sigue funcionando en sitio', async () => {
  const { eng, doc } = await abrir();
  expect(eng.editTextRun(doc, 0, 0, 'MANO LUNA')).toEqual({ ok: true });
  const guardado = await eng.open(eng.save(doc));
  expect(eng.getPageText(guardado, 0)[0]!.text).toBe('MANO LUNA');
  eng.close(guardado);
  eng.close(doc);
});

test('con el glifo ausente entra la sustitución de fuente (E-047) y el texto se extrae tras guardar', async () => {
  const { eng, doc } = await abrir();
  const res = eng.replaceRunWithStandardFont(doc, 0, 0, 'HOLA MUNDO €');
  expect(res.ok).toBe(true);
  const guardado = await eng.open(eng.save(doc));
  const textos = eng.getPageText(guardado, 0).map((r) => r.text);
  expect(textos).toContain('HOLA MUNDO €');
  expect(textos).not.toContain('HOLA MUNDO');
  eng.close(guardado);
  eng.close(doc);
});

test('replaceRunWithStandardFont devuelve glyph-missing si la fuente estándar tampoco cubre el texto (CJK) y no toca nada', async () => {
  const { eng, doc } = await abrir();
  expect(eng.replaceRunWithStandardFont(doc, 0, 0, '漢字')).toEqual({ ok: false, reason: 'glyph-missing' });
  expect(eng.getPageText(doc, 0)[0]!.text).toBe('HOLA MUNDO');
  eng.close(doc);
});

test('setRunFontSize conserva el texto y la fuente del subconjunto', async () => {
  const { eng, doc } = await abrir();
  const antes = eng.getPageText(doc, 0)[0]!;
  const r = eng.setRunFontSize(doc, 0, 0, 30);
  expect(r.ok).toBe(true);
  const despues = eng.getPageText(doc, 0).find((x) => x.text === 'HOLA MUNDO');
  expect(despues).toBeDefined();
  expect(despues!.sizeEfectivoPt).toBeCloseTo(30, 1);
  expect(despues!.fuenteSubconjunto).toBe(antes.fuenteSubconjunto);
  eng.close(doc);
});
