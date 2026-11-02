import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';

/**
 * E-118 con el motor REAL: `word-columnas.docx` (ver `generar-fixtures.mjs`). Página de 612 x 312 pt, márgenes laterales de 72 y verticales de 36;
 * el borde superior del área de texto está en y = 276 y las líneas miden 12 pt (la base de la n-ésima, contando desde 1, en 276 - 12 n + 3,36).
 *   Sección 1 (1 columna): 2 líneas, y = 252 al acabar.
 *   Sección 2 (continua, 2 columnas de 216 pt con hueco de 36 y separador): 15 líneas equilibradas 8 + 7; la 2.ª columna empieza en x = 324.
 *   Sección 3 (continua, 3 columnas de 85, 200 y 115 pt con huecos de 30): x = 72, 187 y 417; dos saltos de columna.
 *   Sección 4 (continua, 1 columna): bajo la más alta de la sección 3.
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const BASE_LINEA = 0.28 * 12;
const baseDe = (n: number): number => 276 - 12 * n + BASE_LINEA; // línea base de la línea n-ésima (1-based) contada desde el borde superior

async function convertir() {
  const engine = await PdfiumEngine.create();
  const nombre = 'word-columnas.docx';
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  const doc = await engine.open(pdf);
  const chars = engine.getCharBoxes(doc, 0);
  const todo = chars.map((c) => c.ch).join('');
  /** Caja del primer carácter de `texto` en el orden de lectura del PDF. */
  const caja = (texto: string) => {
    const i = todo.indexOf(texto);
    expect(i, texto).toBeGreaterThanOrEqual(0);
    return { ...chars[i]!.boxPt, orden: i };
  };
  return { engine, doc, advertencias, chars, todo, caja };
}

test('word-columnas.docx: la x de inicio de cada columna (2 iguales y 3 desiguales) y una sola página sin avisos', async () => {
  const { engine, doc, advertencias, caja } = await convertir();
  expect(textosAdvertencias(advertencias)).toEqual([]);
  expect(engine.pageCount(doc)).toBe(1);
  const cerca = (v: number, esperado: number) => expect(Math.abs(v - esperado), `${v} vs ${esperado}`).toBeLessThan(2); // el 'side bearing' del glifo separa un par de pt
  cerca(caja('Titulo 1').xPt, 72);
  cerca(caja('Dos 01').xPt, 72);
  cerca(caja('Dos 08').xPt, 72);
  cerca(caja('Dos 09').xPt, 72 + 216 + 36);
  cerca(caja('Dos 15').xPt, 72 + 216 + 36);
  cerca(caja('Tres A1').xPt, 72);
  cerca(caja('Tres B1').xPt, 72 + 85 + 30);
  cerca(caja('Tres C1').xPt, 72 + 85 + 30 + 200 + 30);
  cerca(caja('Final 1').xPt, 72);
  engine.close(doc);
});

test('word-columnas.docx: orden de lectura (columna 1 entera antes que la 2) y el reparto equilibrado de la sección de 2 columnas (8 + 7)', async () => {
  const { engine, doc, caja } = await convertir();
  const orden = ['Titulo 2', 'Dos 01', 'Dos 08', 'Dos 09', 'Dos 15', 'Tres A1', 'Tres A3', 'Tres B1', 'Tres B3', 'Tres C1', 'Final 1', 'Final 2'].map((t) => caja(t).orden);
  expect(orden).toEqual([...orden].sort((a, b) => a - b));
  const base = (t: string) => { const c = caja(t); return c.yPt; };
  // Parte alta de las columnas igual; la columna 1 llega una línea más abajo que la 2 (8 frente a 7), nunca más.
  const bajo1 = Math.min(...['Dos 01', 'Dos 08'].map(base)), bajo2 = Math.min(...['Dos 09', 'Dos 15'].map(base));
  expect(Math.abs(base('Dos 01') - base('Dos 09'))).toBeLessThan(1.5);
  expect(Math.abs(bajo2 - bajo1 - 12)).toBeLessThan(1.5);
  // Las líneas se apilan cada 12 pt y la sección 2 arranca bajo las 2 líneas de la sección 1.
  expect(Math.abs(base('Dos 01') - base('Titulo 2') + 12)).toBeLessThan(1.5);
  expect(Math.abs(base('Dos 01') - base('Dos 02') - 12)).toBeLessThan(1.5);
  // La sección 3 empieza bajo la columna MÁS ALTA de la 2 (8 líneas), las 3 columnas arrancan a la misma altura y los saltos de columna se respetan.
  expect(Math.abs(base('Dos 08') - base('Tres A1') - 12)).toBeLessThan(1.5);
  expect(Math.abs(base('Tres A1') - base('Tres B1'))).toBeLessThan(1.5);
  expect(Math.abs(base('Tres A1') - base('Tres C1'))).toBeLessThan(1.5);
  // La sección 4 sigue bajo las 3 líneas de la sección 3.
  expect(Math.abs(base('Tres A3') - base('Final 1') - 12)).toBeLessThan(1.5);
  expect(Math.abs(base('Final 1') - (baseDe(14)))).toBeLessThan(3);
  engine.close(doc);
});

test('word-columnas.docx: el separador (w:sep) es UN path fino y vertical centrado en el hueco, de la parte alta de la región al final de la columna más larga', async () => {
  const { engine, doc } = await convertir();
  const finos = engine.listPathObjects(doc, 0).map((p) => p.rectPt).filter((r) => r.wPt < 1 && r.hPt > 20);
  expect(finos).toHaveLength(1); // la sección de 3 columnas no lleva separador
  const s = finos[0]!;
  expect(s.xPt + s.wPt / 2).toBeCloseTo(72 + 216 + 18, 0);
  expect(s.yPt + s.hPt).toBeCloseTo(252, 0); // parte alta de la región (bajo las dos líneas de título)
  expect(s.yPt).toBeCloseTo(252 - 8 * 12, 0); // fin de la columna de 8 líneas
  engine.close(doc);
});

test('word-columnas.docx: la nota al pie va al pie de la PÁGINA con el ancho de la primera columna, aunque su referencia esté en una sección de columnas', async () => {
  const { engine, doc, chars, todo } = await convertir();
  const i = todo.indexOf('Nota al pie');
  expect(i).toBeGreaterThanOrEqual(0);
  const fin = todo.indexOf('primera columna', i) + 'primera columna'.length;
  const nota = chars.slice(i, fin).filter((c) => c.ch.trim() !== '' && c.boxPt.wPt > 0);
  const ys = new Set(nota.map((c) => Math.round(c.boxPt.yPt)));
  expect(ys.size).toBeGreaterThanOrEqual(3); // a 216 pt el texto da 3 renglones (a 468 pt cabría en 2)
  expect(Math.max(...nota.map((c) => c.boxPt.xPt + c.boxPt.wPt))).toBeLessThanOrEqual(72 + 216 + 1);
  expect(Math.min(...nota.map((c) => c.boxPt.xPt))).toBeGreaterThanOrEqual(71);
  expect(Math.min(...nota.map((c) => c.boxPt.yPt))).toBeGreaterThanOrEqual(36 - 1); // sobre el margen inferior
  // Su separador: la regla de 144 pt empieza en el margen izquierdo.
  const reglas = engine.listPathObjects(doc, 0).map((p) => p.rectPt).filter((r) => Math.abs(r.wPt - 144) < 0.5 && r.hPt < 2);
  expect(reglas).toHaveLength(1);
  expect(reglas[0]!.xPt).toBeCloseTo(72, 1);
  engine.close(doc);
});
