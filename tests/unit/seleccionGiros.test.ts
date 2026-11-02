import { test, expect } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { CharBox } from '../../src/engine/PdfEngine';
import { PageGeometry } from '../../src/coords/PageGeometry';
import { ordenLecturaCaracteres, quadsDeRango, textoDeRango } from '../../src/texto/seleccionTexto';

// E-122: orden de lectura de los caracteres y rectángulos por línea en páginas giradas.

const ROTACIONES = [0, 90, 180, 270] as const;

/** Página 300x400 con 4 líneas "L<k>ab" (texto normal, horizontal en el espacio de usuario) y /Rotate dado. */
async function charsReales(rot: 0 | 90 | 180 | 270, crop?: [number, number, number, number]) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  const p = d.addPage([300, 400]);
  if (crop) p.setCropBox(...crop);
  p.setRotation(degrees(rot));
  for (let k = 1; k <= 4; k++) p.drawText(`L${k}ab`, { x: 50, y: 340 - 40 * (k - 1), size: 14, font: f });
  const eng = await PdfiumEngine.create();
  const doc = await eng.open(await d.save());
  const chars = eng.getCharBoxes(doc, 0);
  const tam = eng.pageSize(doc, 0);
  eng.close(doc);
  return { chars, tam };
}

const caja = (ch: string, x: number, y: number): CharBox => ({ ch, boxPt: { xPt: x, yPt: y, wPt: 7, hPt: 10 } });
const salto = (): CharBox[] => [{ ch: '\r', boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } }, { ch: '\n', boxPt: { xPt: 0, yPt: 0, wPt: 0, hPt: 0 } }];
/** Una línea horizontal de usuario con las letras dadas, a altura y. */
const linea = (txt: string, y: number): CharBox[] => [...txt].map((c, i) => caja(c, 50 + 8 * i, y));

test('ordenLecturaCaracteres: con /Rotate 90 y las líneas de abajo arriba las pone de arriba abajo, sin tocar el orden interno', () => {
  const alReves = [...linea('L4', 220), ...salto(), ...linea('L3', 260), ...salto(), ...linea('L2', 300), ...salto(), ...linea('L1', 340)];
  const r = ordenLecturaCaracteres(alReves, 90);
  expect(textoDeRango(r, 0, r.length - 1)).toBe('L1\nL2\nL3\nL4');
});

test('ordenLecturaCaracteres: no toca 0, 180 ni 270, ni un orden que ya es el natural', () => {
  const alReves = [...linea('L4', 220), ...salto(), ...linea('L3', 260)];
  for (const rot of [0, 180, 270] as const) expect(ordenLecturaCaracteres(alReves, rot)).toBe(alReves);
  const natural = [...linea('L1', 340), ...salto(), ...linea('L2', 300)];
  expect(ordenLecturaCaracteres(natural, 90)).toBe(natural);
});

test('ordenLecturaCaracteres: con texto contragirado (líneas verticales en usuario) no se toca', () => {
  const vertical = (txt: string, x: number): CharBox[] => [...txt].map((c, i) => caja(c, x, 100 + 11 * i));
  const cs = [...vertical('AB', 50), ...salto(), ...vertical('CD', 90)];
  expect(ordenLecturaCaracteres(cs, 90)).toBe(cs);
});

test('ordenLecturaCaracteres: una sola línea o sin saltos devuelve el mismo array', () => {
  const una = linea('L1ab', 300);
  expect(ordenLecturaCaracteres(una, 90)).toBe(una);
});

for (const rot of ROTACIONES) {
  test(`PDFium real /Rotate ${rot}: tras ordenar, el texto sale L1..L4 y un rango de L1 a L3 copia cola, L2 y cabeza`, async () => {
    const { chars } = await charsReales(rot);
    const cs = ordenLecturaCaracteres(chars, rot);
    expect(textoDeRango(cs, 0, cs.length - 1)).toBe('L1ab\nL2ab\nL3ab\nL4ab');
    expect(textoDeRango(cs, cs.findIndex((c) => c.ch === '1') + 1, cs.findIndex((c) => c.ch === '3'))).toBe('ab\nL2ab\nL3');
  });

  test(`PDFium real /Rotate ${rot}: quadsDeRango da UN quad por línea (4 líneas, 4 quads) y uno solo para una línea`, async () => {
    const { chars, tam } = await charsReales(rot);
    const cs = ordenLecturaCaracteres(chars, rot);
    const geo = PageGeometry.desdeTamanoVisual(tam.widthPt, tam.heightPt, 1, rot);
    expect(quadsDeRango(cs, 0, cs.length - 1, geo)).toHaveLength(4);
    const i1 = cs.findIndex((c) => c.ch === '1');
    expect(quadsDeRango(cs, i1 - 1, i1 + 2, geo)).toHaveLength(1);
  });
}

test('PDFium real /Rotate 90 con CropBox desplazado: orden de lectura y un quad por línea', async () => {
  const { chars, tam } = await charsReales(90, [20, 30, 280, 380]);
  const cs = ordenLecturaCaracteres(chars, 90);
  expect(textoDeRango(cs, 0, cs.length - 1)).toBe('L1ab\nL2ab\nL3ab\nL4ab');
  const geo = PageGeometry.desdeTamanoVisual(tam.widthPt, tam.heightPt, 1, 90, { xPt: 20, yPt: 30 });
  expect(quadsDeRango(cs, 0, cs.length - 1, geo)).toHaveLength(4);
});
