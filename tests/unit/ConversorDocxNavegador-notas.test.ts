import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-109 con el motor REAL: `word-notas.docx` (ver `generar-fixtures.mjs`): 70 líneas de 12 pt exactos en Carta con margen de 72 pt,
 * 3 notas al pie (líneas 2, 52 y 60) y 2 notas al final (líneas 10 y 65). Cada nota mide 12 pt y el separador 12 pt.
 *   Página 1: líneas 1..51 (la 52 no cabe junto con su nota y pasa a la página 2) y la nota 1.
 *   Zona de notas de la página 1: [72, 96] -> nota en [72, 84], línea base 72 + 12 x 0,28; separador en [84, 96], regla en y = 84 + 5,5.
 *   Página 2: líneas 52..70, notas 2 y 3 (zona [72, 108]) y, tras la línea 70, el separador y las dos notas finales.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE_LINEA = 0.28 * 12; // línea base sobre el borde inferior de una línea de 12 pt (fracción 0,28 del maquetador)

async function convertir() {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-notas.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  const doc = await engine.open(pdf);
  return { engine, doc, advertencias };
}

test('word-notas.docx: superíndice en el cuerpo, la nota en la MISMA página bajo el cuerpo y sobre el margen, y su separador', async () => {
  const { engine, doc, advertencias } = await convertir();
  expect(textosAdvertencias(advertencias)).toEqual([]);
  expect(engine.pageCount(doc)).toBe(2);
  const p0 = engine.getPageText(doc, 0);
  const base = (r: { matriz: number[] }) => r.matriz[5]!;

  // Línea 2 de la página 1: el "1" sube 0,33 x 10 sobre su línea base y mide 10 x 2/3.
  const linea2 = p0.find((r) => r.textoReal.trim() === 'Linea 2')!;
  const sup = p0.filter((r) => r.textoReal.trim() === '1').sort((a, b) => base(b) - base(a))[0]!;
  expect(sup.sizeEfectivoPt).toBeCloseTo(10 * 2 / 3, 1);
  expect(base(sup) - base(linea2)).toBeCloseTo(3.3, 1);

  // Nota 1: en la página 1, bajo el último renglón del cuerpo (línea 51) y sobre el margen inferior (72).
  const nota1 = p0.find((r) => r.textoReal.includes('Texto de la nota uno'))!;
  const ultima = p0.find((r) => r.textoReal.trim() === 'Linea 51')!;
  expect(p0.some((r) => r.textoReal.trim() === 'Linea 52')).toBe(false);
  expect(base(nota1)).toBeLessThan(base(ultima));
  expect(base(nota1)).toBeGreaterThanOrEqual(72);
  expect(base(nota1)).toBeCloseTo(72 + BASE_LINEA, 1);
  // Su número, en superíndice, justo delante de la nota.
  const numero = p0.filter((r) => r.textoReal.trim() === '1').sort((a, b) => base(a) - base(b))[0]!;
  expect(base(numero) - base(nota1)).toBeCloseTo(3.3, 1);
  expect(numero.boxPt.xPt).toBeLessThan(nota1.boxPt.xPt);

  // Separador: UN path de 144 pt de ancho y 1 pt de alto en x = 72, encima de la nota (zona [72, 96]; regla en y = 84 + 5,5).
  const reglas = engine.listPathObjects(doc, 0).map((p) => p.rectPt).filter((r) => Math.abs(r.wPt - 144) < 0.5 && r.hPt < 2);
  expect(reglas).toHaveLength(1);
  expect(reglas[0]!.xPt).toBeCloseTo(72, 1);
  expect(reglas[0]!.yPt).toBeCloseTo(89.5, 1);
  expect(reglas[0]!.yPt).toBeGreaterThan(base(nota1));
  engine.close(doc);
});

test('word-notas.docx: la línea con la referencia 2 no cabe junto a su nota y pasa a la página 2 con ella; la nota 3 apila bajo la 2', async () => {
  const { engine, doc } = await convertir();
  const p0 = engine.getPageText(doc, 0), p1 = engine.getPageText(doc, 1);
  const base = (r: { matriz: number[] }) => r.matriz[5]!;
  expect(p1.some((r) => r.textoReal.trim() === 'Linea 52')).toBe(true);
  expect(p0.some((r) => r.textoReal.includes('nota dos'))).toBe(false);
  const n2 = p1.find((r) => r.textoReal.includes('Texto de la nota dos'))!;
  const n3 = p1.find((r) => r.textoReal.includes('Texto de la nota tres'))!;
  expect(base(n3)).toBeCloseTo(72 + BASE_LINEA, 1);
  expect(base(n2)).toBeCloseTo(84 + BASE_LINEA, 1);
  // Numeración continua: los números 2 y 3 existen en la página 2 (en el cuerpo y delante de cada nota).
  expect(p1.filter((r) => r.textoReal.trim() === '2')).toHaveLength(2);
  expect(p1.filter((r) => r.textoReal.trim() === '3')).toHaveLength(2);
  // Dos reglas cortas en la página 2: el separador de las notas al pie y el de las notas al final.
  expect(engine.listPathObjects(doc, 1).filter((p) => Math.abs(p.rectPt.wPt - 144) < 0.5 && p.rectPt.hPt < 2)).toHaveLength(2);
  engine.close(doc);
});

test('word-notas.docx: las notas al final salen tras el último párrafo, con números i y ii', async () => {
  const { engine, doc } = await convertir();
  const p0 = engine.getPageText(doc, 0), p1 = engine.getPageText(doc, 1);
  const base = (r: { matriz: number[] }) => r.matriz[5]!;
  const ultimo = p1.find((r) => r.textoReal.trim() === 'Linea 70')!;
  const f1 = p1.find((r) => r.textoReal.includes('Nota final uno'))!;
  const f2 = p1.find((r) => r.textoReal.includes('Nota final dos'))!;
  expect(base(f1)).toBeLessThan(base(ultimo));
  expect(base(f2)).toBeLessThan(base(f1));
  // Referencias del cuerpo: "i" en la línea 10 (página 1) y "ii" en la 65 (página 2); delante de cada nota final, su número.
  expect(p0.filter((r) => r.textoReal.trim() === 'i')).toHaveLength(1);
  expect(p1.filter((r) => r.textoReal.trim() === 'i')).toHaveLength(1);
  expect(p1.filter((r) => r.textoReal.trim() === 'ii')).toHaveLength(2);
  const n1 = p1.find((r) => r.textoReal.trim() === 'i')!;
  expect(n1.boxPt.xPt).toBeLessThan(f1.boxPt.xPt);
  expect(Math.abs(base(n1) - 3.3 - base(f1))).toBeLessThan(0.5);
  // Una nota final no ocupa la zona de las notas al pie: queda sobre ella.
  expect(base(f2)).toBeGreaterThan(108);
  engine.close(doc);
});
