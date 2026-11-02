import { test, expect } from 'vitest';
import { decodificarTexto, decodificarXml } from '../../src/convert/decodificarEntrada';

/** E-124: la codificación de un .md/.xml se detecta (BOM, UTF-8 estricto, UTF-16 sin BOM, cp1252) y nunca produce basura en silencio. */
const TEXTO = '# Título\n\nAño nuevo, señor.';
const utf16le = (s: string, bom: boolean): Uint8Array => {
  const out = new Uint8Array((s.length + (bom ? 1 : 0)) * 2);
  let o = 0;
  if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[o++] = c & 0xff; out[o++] = c >> 8; }
  return out;
};
const utf16be = (s: string, bom: boolean): Uint8Array => {
  const le = utf16le(s, false);
  const out = new Uint8Array(le.length + (bom ? 2 : 0));
  let o = 0;
  if (bom) { out[o++] = 0xfe; out[o++] = 0xff; }
  for (let i = 0; i < le.length; i += 2) { out[o++] = le[i + 1]!; out[o++] = le[i]!; }
  return out;
};
const cp1252 = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

test('UTF-8 con y sin BOM: texto exacto y sin suposición', () => {
  const u8 = new TextEncoder().encode(TEXTO);
  expect(decodificarTexto(u8)).toMatchObject({ texto: TEXTO, codificacion: 'utf-8', supuesta: false });
  const conBom = new Uint8Array([0xef, 0xbb, 0xbf, ...u8]);
  expect(decodificarTexto(conBom)).toMatchObject({ texto: TEXTO, codificacion: 'utf-8', supuesta: false });
});

test('UTF-16LE y UTF-16BE con BOM', () => {
  expect(decodificarTexto(utf16le(TEXTO, true))).toMatchObject({ texto: TEXTO, codificacion: 'utf-16le', supuesta: false });
  expect(decodificarTexto(utf16be(TEXTO, true))).toMatchObject({ texto: TEXTO, codificacion: 'utf-16be', supuesta: false });
});

test('UTF-16 SIN BOM (NUL alternos) se detecta y se marca como supuesta', () => {
  expect(decodificarTexto(utf16le(TEXTO, false))).toMatchObject({ texto: TEXTO, codificacion: 'utf-16le', supuesta: true });
  expect(decodificarTexto(utf16be(TEXTO, false))).toMatchObject({ texto: TEXTO, codificacion: 'utf-16be', supuesta: true });
});

test('cp1252 (UTF-8 inválido) se decodifica como windows-1252 y se marca como supuesta: "año" sale bien', () => {
  const r = decodificarTexto(cp1252(TEXTO));
  expect(r.texto).toBe(TEXTO);
  expect(r).toMatchObject({ codificacion: 'windows-1252', supuesta: true });
  expect(decodificarTexto(cp1252('año')).texto).toBe('año');
  // Los caracteres de 0x80-0x9F de cp1252 (no de Latin-1): euro y comillas tipográficas.
  expect(decodificarTexto(Uint8Array.from([0x80, 0x93, 0x41, 0x94])).texto).toBe('€“A”');
});

test('ASCII puro y vacío: UTF-8 sin suposición', () => {
  expect(decodificarTexto(new TextEncoder().encode('hola'))).toMatchObject({ texto: 'hola', codificacion: 'utf-8', supuesta: false });
  expect(decodificarTexto(new Uint8Array(0))).toMatchObject({ texto: '', supuesta: false });
});

test('decodificarXml: UTF-8, UTF-16 con BOM y UTF-16 declarado sin BOM', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><w:t>año</w:t>';
  expect(decodificarXml(new TextEncoder().encode(xml))).toBe(xml);
  expect(decodificarXml(utf16le(xml, true))).toBe(xml);
  const x16 = '<?xml version="1.0" encoding="UTF-16"?><w:t>año</w:t>';
  expect(decodificarXml(utf16le(x16, false))).toBe(x16);
  expect(decodificarXml(utf16be(x16, false))).toBe(x16);
});
