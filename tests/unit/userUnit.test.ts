import { test, expect } from 'vitest';
import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { declaraUserUnit, buscarBytes, leerUserUnits } from '../../src/engine/userUnit';
import { fixture } from './_util/fixtures';

const bytesDe = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

async function pdf(uu: number | null, objectStreams: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([300, 200]);
  if (uu !== null) p.node.set(PDFName.of('UserUnit'), PDFNumber.of(uu));
  return doc.save({ useObjectStreams: objectStreams });
}

test('E-099 buscarBytes: busca sobre bytes, sin decodificar', () => {
  expect(buscarBytes(bytesDe('abc/UserUnit 2'), bytesDe('UserUnit'))).toBe(4);
  expect(buscarBytes(bytesDe('abc'), bytesDe('UserUnit'))).toBe(-1);
  expect(buscarBytes(bytesDe('xxUser'), bytesDe('UserUnit'))).toBe(-1);
});

test('E-099 declaraUserUnit: literal en bytes, dentro de un /ObjStm comprimido, ausente con /ObjStm y ausente sin él', async () => {
  const literal = await pdf(2, false);
  expect(buscarBytes(literal, bytesDe('UserUnit'))).toBeGreaterThan(0);
  expect(await declaraUserUnit(literal)).toBe(true);

  const dentro = await pdf(2, true);
  expect(buscarBytes(dentro, bytesDe('UserUnit')), 'el fixture debe tenerlo SOLO comprimido').toBe(-1);
  expect(buscarBytes(dentro, bytesDe('/ObjStm'))).toBeGreaterThan(0);
  expect(await declaraUserUnit(dentro)).toBe(true);
  expect(await declaraUserUnit(fixture('userunit.pdf'))).toBe(true);

  const sin = await pdf(null, true);
  expect(buscarBytes(sin, bytesDe('/ObjStm'))).toBeGreaterThan(0);
  expect(await declaraUserUnit(sin)).toBe(false);
  expect(await declaraUserUnit(await pdf(null, false))).toBe(false);
  expect(await declaraUserUnit(fixture('nativo.pdf'))).toBe(false);
});

test('E-099 declaraUserUnit: un /ObjStm con flujo corrupto o sin Flate se trata como sin UserUnit (límite documentado)', async () => {
  const corrupto = bytesDe('1 0 obj\n<< /Type /ObjStm /Filter /FlateDecode /N 1 /First 4 /Length 4 >>\nstream\nXXXX\nendstream\nendobj\n');
  expect(await declaraUserUnit(corrupto)).toBe(false);
  const otroFiltro = bytesDe('1 0 obj\n<< /Type /ObjStm /Filter /LZWDecode /N 1 /First 4 /Length 4 >>\nstream\nXXXX\nendstream\nendobj\n');
  expect(await declaraUserUnit(otroFiltro)).toBe(false);
});

test('E-099 leerUserUnits: valores de páginas con /UserUnit dentro de un /ObjStm', async () => {
  const mapa = await leerUserUnits(fixture('userunit-mixto.pdf'));
  expect([...mapa.values()].sort()).toEqual([2, 2]); // las páginas 2 y 4; 0 (inválido) y la ausente no cuentan
  expect((await leerUserUnits(fixture('nativo.pdf'))).size).toBe(0);
});
