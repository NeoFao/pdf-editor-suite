import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PDFDocument } from 'pdf-lib';

// E-028: FPDFTextObj_GetText (como el resto de getters de cadena de PDFium)
// devuelve el tamaño necesario y, si el buffer es menor, NO lo rellena: queda
// memoria sin inicializar, no un texto truncado. Un buffer fijo de 1024 bytes
// (512 caracteres UTF-16) se queda corto con un run de más de ~511 caracteres.
test('getPageText no trunca ni devuelve basura en un run de texto largo (>511 caracteres UTF-16)', async () => {
  const d = await PDFDocument.create();
  d.addPage([200, 4000]);
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());

  const largo = 'a'.repeat(1200);
  eng.insertText(doc, 0, { xPt: 10, yPt: 3900, text: largo, sizePt: 8 });

  // Reabre desde los bytes guardados: getPageText lee FPDFTextObj_GetText
  // desde cero, sin ningún estado en memoria que "recuerde" el texto original.
  const doc2 = await eng.open(eng.save(doc));
  const runs = eng.getPageText(doc2, 0);
  expect(runs).toHaveLength(1);
  expect(runs[0]!.text.length).toBe(1200);
  expect(runs[0]!.text).toBe(largo);

  eng.close(doc);
  eng.close(doc2);
});

// FPDFFont_GetBaseFontName tiene el mismo defecto (buffer fijo de 256 bytes,
// UTF-8/Latin-1) pero no hay forma razonable de reproducirlo con un test de
// comportamiento: `FPDFPageObj_NewTextObj` exige un nombre de la familia
// estándar de 14 fuentes y, con cualquier nombre no reconocido -incluso corto-,
// devuelve un objeto nulo (`insertText` da runId -1; comprobado con nombres de
// 10 a 300 caracteres, todos rechazados igual). No hay ruta en este motor para
// producir en pruebas un BaseFontName real de más de 255 bytes. Se arregla por
// construcción, compartiendo el mismo helper `leerCadenaPdfium` que ya cubre
// `getPageText` y `getNotes`, y queda cubierto por la regla determinista
// `pdfium-buffer-fijo` (scripts/guards/reglas.mjs), que bloquea cualquier
// getter de cadena de PDFium con un tamaño de buffer fijo en el código fuente.
