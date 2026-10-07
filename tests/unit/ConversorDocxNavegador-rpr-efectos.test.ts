import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-105 con el motor REAL: `word-rpr-efectos.docx` (ver `generar-fixtures.mjs`), 8 líneas de 20 pt. Se mide, en el PDF resultante, el
 * tamaño efectivo y la línea base del superíndice, los objetos path del tachado (banda vertical y ancho), el texto de `w:caps`,
 * los trozos de `w:smallCaps`, el fondo del resaltado y que el texto oculto no esté.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));

test('word-rpr-efectos.docx (E-105): superíndice, tachado, caps, smallCaps, fondo y vanish en el PDF', async () => {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-rpr-efectos.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  expect(textosAdvertencias(advertencias)).toEqual([]);
  const doc = await engine.open(pdf);
  const runs = engine.getPageText(doc, 0);
  const paths = engine.listPathObjects(doc, 0).map((p) => p.rectPt);
  const de = (texto: string) => {
    const r = runs.find((x) => x.textoReal.trim() === texto);
    expect(r, `objeto de texto "${texto}"`).toBeDefined();
    return r!;
  };
  const baseY = (r: { matriz: number[] }) => r.matriz[5]!;

  // Superíndice / subíndice: 2/3 de 20 pt; la base sube 0,33 × 20 y baja 0,14 × 20 respecto a "Normal".
  const normal = de('Normal'), sup = de('Sup'), sub = de('Sub');
  expect(normal.sizeEfectivoPt).toBeCloseTo(20, 1);
  expect(sup.sizeEfectivoPt).toBeCloseTo(20 * 2 / 3, 1);
  expect(sub.sizeEfectivoPt).toBeCloseTo(20 * 2 / 3, 1);
  expect(baseY(sup) - baseY(normal)).toBeCloseTo(20 * 0.33, 1);
  expect(baseY(normal) - baseY(sub)).toBeCloseTo(20 * 0.14, 1);

  // Tachado simple: UN path del ancho del texto con su centro a 0,26 × 20 sobre la línea base; doble: DOS, a ± grosor.
  const t = Math.max(0.6, 20 * 0.05);
  const bandaDe = (r: { boxPt: { xPt: number; wPt: number }; matriz: number[] }) =>
    paths.filter((p) => Math.abs(p.xPt - r.boxPt.xPt) < 3 && Math.abs(p.wPt - r.boxPt.wPt) < 4 && p.hPt < 3);
  const tach = de('Tachado'), dob = de('Doble');
  const b1 = bandaDe(tach);
  expect(b1).toHaveLength(1);
  expect(b1[0]!.yPt + b1[0]!.hPt / 2).toBeCloseTo(baseY(tach) + 0.26 * 20, 1);
  expect(b1[0]!.hPt).toBeCloseTo(t, 1);
  const b2 = bandaDe(dob).map((p) => p.yPt + p.hPt / 2).sort((a, b) => a - b);
  expect(b2).toHaveLength(2);
  expect(b2[0]!).toBeCloseTo(baseY(dob) + 0.26 * 20 - t, 1);
  expect(b2[1]!).toBeCloseTo(baseY(dob) + 0.26 * 20 + t, 1);

  // Caps: el texto del PDF es "TÍTULO" (como al exportar desde Word).
  expect(runs.some((r) => r.textoReal.trim() === 'TÍTULO')).toBe(true);
  expect(runs.some((r) => r.textoReal.includes('título'))).toBe(false);

  // smallCaps: "H" a 20 pt y "OLA" a 80 % (16 pt).
  expect(de('H').sizeEfectivoPt).toBeCloseTo(20, 1);
  expect(de('OLA').sizeEfectivoPt).toBeCloseTo(16, 1);

  // Fondo: resaltado y sombreado dejan un path de 1,12 × 20 de alto bajo el texto.
  for (const txt of ['Resaltado', 'Sombreado']) {
    const r = de(txt);
    const fondo = paths.filter((p) => Math.abs(p.xPt - r.boxPt.xPt) < 3 && Math.abs(p.hPt - 1.12 * 20) < 0.5 && Math.abs(p.yPt - (baseY(r) - 0.21 * 20)) < 0.5);
    expect(fondo, `fondo de ${txt}`).toHaveLength(1);
    expect(fondo[0]!.yPt).toBeCloseTo(baseY(r) - 0.21 * 20, 1);
  }

  // vanish: "Oculto" no está; "Visible" sí.
  expect(runs.some((r) => r.textoReal.includes('Oculto'))).toBe(false);
  expect(runs.some((r) => r.textoReal.includes('Visible'))).toBe(true);
  engine.close(doc);
});
