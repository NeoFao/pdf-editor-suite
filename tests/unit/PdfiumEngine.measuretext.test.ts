import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';

/**
 * `measureText` (§9 fila #32, maquetador Markdown → PDF): ancho en puntos PDF
 * de un texto en una de las 14 fuentes estándar, a un tamaño dado. Usa
 * `FPDFText_LoadStandardFont` + `FPDFFont_GetGlyphWidth`. La fuente se
 * cachea por nombre (como mucho 14 nunca se recrean) — sin caché, cada
 * `measureText` dejaría un `FPDF_FONT` sin cerrar (la propia PDFium exige
 * `FPDFFont_Close` para lo que devuelve `LoadStandardFont`, a diferencia de
 * la fuente que crea `FPDFPageObj_NewTextObj` internamente, que no hay que
 * cerrar — ver el comentario de `swapTextObject` en PdfiumEngine.ts).
 */
test('measureText("Helvetica", 10, "Hola") coincide con el ancho AFM conocido (±0.2pt)', async () => {
  const eng = await PdfiumEngine.create();
  // H=722, o=556, l=222, a=556 (unidades/1000) -> (722+556+222+556)/1000*10 = 20.56pt
  const w = eng.measureText('Helvetica', 10, 'Hola');
  expect(w).toBeGreaterThan(20.36);
  expect(w).toBeLessThan(20.76);
});

test('measureText de cadena vacía es 0', async () => {
  const eng = await PdfiumEngine.create();
  expect(eng.measureText('Helvetica', 12, '')).toBe(0);
});

test('measureText escala linealmente con el tamaño', async () => {
  const eng = await PdfiumEngine.create();
  const w10 = eng.measureText('Helvetica-Bold', 10, 'ABC');
  const w20 = eng.measureText('Helvetica-Bold', 20, 'ABC');
  expect(w20).toBeCloseTo(w10 * 2, 1);
});

test('measureText: 1000 mediciones con caché no crean fuentes nuevas cada vez', async () => {
  const eng = await PdfiumEngine.create();
  for (let i = 0; i < 1000; i++) {
    eng.measureText('Helvetica', 11, 'palabra de prueba ' + i);
  }
  // Caja blanca: el caché interno de fuentes no puede tener más de una entrada
  // por nombre de fuente usado (aquí, solo 'Helvetica').
  const cache = (eng as unknown as { measureFontCache: Map<string, number> }).measureFontCache;
  expect(cache.size).toBe(1);
});

test('measureText con varias fuentes estándar cachea cada una por separado, sin crecer sin límite', async () => {
  const eng = await PdfiumEngine.create();
  const nombres = ['Helvetica', 'Helvetica-Bold', 'Times-Roman', 'Courier'];
  for (let i = 0; i < 250; i++) {
    for (const n of nombres) eng.measureText(n, 12, 'texto');
  }
  const cache = (eng as unknown as { measureFontCache: Map<string, number> }).measureFontCache;
  expect(cache.size).toBe(nombres.length);
});
