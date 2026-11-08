import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import type { CharBox } from '../../src/engine/PdfEngine';
import { ConversorMarkdownNavegador } from '../../src/convert/ConversorMarkdownNavegador';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { textosAdvertencias } from '../../src/convert/advertencia';
import { construirZip } from './helpers/zipBuilder';

/**
 * E-124, integración con el motor REAL: (1) un .md en UTF-16/cp1252 no puede salir con basura y sin aviso; (2) una palabra
 * más ancha que la línea (URL larga, código largo) se parte por caracteres y ningún carácter queda fuera del área; en una
 * celda estrecha nada invade la celda vecina.
 */
const PAGINA_W = 612;
const MARGEN = 72;

function utf16le(s: string, bom: boolean): Uint8Array {
  const out = new Uint8Array((s.length + (bom ? 1 : 0)) * 2);
  let o = 0;
  if (bom) { out[o++] = 0xff; out[o++] = 0xfe; }
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[o++] = c & 0xff; out[o++] = c >> 8; }
  return out;
}

async function textoPdf(engine: PdfiumEngine, pdf: Uint8Array): Promise<string> {
  const doc = await engine.open(pdf);
  let t = '';
  for (let p = 0; p < engine.pageCount(doc); p++) t += engine.getPageText(doc, p).map((r) => r.text).join(' ') + '\n';
  return t;
}

test('Markdown en UTF-16LE con BOM: el contenido llega intacto, sin ÿ', async () => {
  const engine = await PdfiumEngine.create();
  const { pdf, advertencias } = await new ConversorMarkdownNavegador(engine).convertir('a.md', utf16le('# Título\n\nAño nuevo, señor.', true));
  const t = await textoPdf(engine, pdf);
  expect(t).toContain('Título');
  expect(t).toContain('Año nuevo, señor.');
  expect(t).not.toContain('ÿ');
  expect(textosAdvertencias(advertencias)).toEqual([]);
}, 60_000);

test('Markdown en UTF-16LE SIN BOM y en cp1252: se decodifica y se avisa de la codificación supuesta', async () => {
  const engine = await PdfiumEngine.create();
  const sinBom = await new ConversorMarkdownNavegador(engine).convertir('a.md', utf16le('# Título\n\nAño nuevo.', false));
  expect(await textoPdf(engine, sinBom.pdf)).toContain('Año nuevo.');
  expect(sinBom.advertencias.some((a) => a.tipo === 'aproximado' && /UTF-16/.test(a.mensaje))).toBe(true);
  const cp = Uint8Array.from(Array.from('# Título\n\nAño nuevo, señor.', (c) => c.charCodeAt(0)));
  const r = await new ConversorMarkdownNavegador(engine).convertir('b.md', cp);
  const t = await textoPdf(engine, r.pdf);
  expect(t).toContain('Año nuevo, señor.');
  expect(t).not.toContain('ÿ');
  expect(r.advertencias.some((a) => a.tipo === 'aproximado' && /Windows-1252/.test(a.mensaje))).toBe(true);
}, 60_000);

function docx(cuerpo: string, extra: { nombre: string; datos: Uint8Array }[] = [], docXmlBytes?: Uint8Array): Uint8Array {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;
  return construirZip([
    { nombre: '[Content_Types].xml', datos: new TextEncoder().encode('<Types/>') },
    { nombre: 'word/document.xml', datos: docXmlBytes ?? new TextEncoder().encode(documentXml) },
    ...extra
  ]);
}
const parrafo = (t: string): string => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

/** Ningún carácter visible fuera de [x0, x1] (pt de página). */
function fuera(chars: CharBox[], x0: number, x1: number): CharBox[] {
  return chars.filter((c) => c.ch.trim() !== '' && (c.boxPt.xPt < x0 - 0.5 || c.boxPt.xPt + c.boxPt.wPt > x1 + 0.5));
}

test('Word: una URL de 120 caracteres se parte por caracteres, no sale del área y no pierde ninguno', async () => {
  const engine = await PdfiumEngine.create();
  const url = 'https://ejemplo.org/' + 'a'.repeat(100);
  const { pdf } = await new ConversorDocxNavegador(engine).convertir('u.docx', docx(parrafo(url)));
  const doc = await engine.open(pdf);
  const chars = engine.getCharBoxes(doc, 0);
  expect(fuera(chars, MARGEN, PAGINA_W - MARGEN)).toEqual([]);
  expect(chars.filter((c) => c.ch.trim() !== '').map((c) => c.ch).join('')).toBe(url);
}, 60_000);

test('Word: palabra larga en una lista y tras sangría derecha también se parte', async () => {
  const engine = await PdfiumEngine.create();
  const larga = 'x'.repeat(150);
  const cuerpo = `<w:p><w:pPr><w:ind w:left="720" w:right="720"/></w:pPr><w:r><w:t>${larga}</w:t></w:r></w:p>`;
  const { pdf } = await new ConversorDocxNavegador(engine).convertir('l.docx', docx(cuerpo));
  const doc = await engine.open(pdf);
  const chars = engine.getCharBoxes(doc, 0);
  expect(fuera(chars, MARGEN + 36, PAGINA_W - MARGEN - 36)).toEqual([]);
  expect(chars.filter((c) => c.ch === 'x').length).toBe(150);
}, 60_000);

test('Word: palabras largas en celdas estrechas (50 pt) no pisan la celda vecina', async () => {
  const engine = await PdfiumEngine.create();
  const celda = (t: string): string => `<w:tc><w:tcPr><w:tcW w:w="1000" w:type="dxa"/></w:tcPr>${parrafo(t)}</w:tc>`;
  const palabras = ['Identificación', 'Responsabilidad', 'Observaciones'];
  const cuerpo = `<w:tbl><w:tblPr><w:tblW w:w="3000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/><w:gridCol w:w="1000"/></w:tblGrid><w:tr>${palabras.map(celda).join('')}</w:tr></w:tbl>`;
  const { pdf } = await new ConversorDocxNavegador(engine).convertir('t.docx', docx(cuerpo));
  const doc = await engine.open(pdf);
  const chars = engine.getCharBoxes(doc, 0).filter((c) => c.ch.trim() !== '');
  // Celdas de 50 pt desde x = 72: [72,122], [122,172], [172,222]. Cada letra pertenece a la celda de su palabra.
  expect(chars.map((c) => c.ch).join('').split('').sort().join('')).toBe(palabras.join('').split('').sort().join(''));
  const bordes = [72, 122, 172, 222];
  for (const c of chars) {
    const centro = c.boxPt.xPt + c.boxPt.wPt / 2;
    const k = bordes.findIndex((b, i) => i < 3 && centro >= b && centro < bordes[i + 1]!);
    expect(k, `carácter "${c.ch}" en x=${c.boxPt.xPt} fuera de la tabla`).toBeGreaterThanOrEqual(0);
    expect(c.boxPt.xPt, `"${c.ch}" invade la celda anterior`).toBeGreaterThanOrEqual(bordes[k]! - 0.5);
    expect(c.boxPt.xPt + c.boxPt.wPt, `"${c.ch}" invade la celda siguiente`).toBeLessThanOrEqual(bordes[k + 1]! + 0.5);
  }
}, 60_000);

test('Markdown: línea de código de 150 caracteres y URL de 200 no salen del área ni pierden caracteres', async () => {
  const engine = await PdfiumEngine.create();
  const codigo = '$ ' + 'comando-largo-'.repeat(10) + 'fin';
  const url = 'https://ejemplo.org/' + 'b'.repeat(180);
  const md = '```\n' + codigo + '\n```\n\n' + url + '\n';
  const { pdf } = await new ConversorMarkdownNavegador(engine).convertir('c.md', new TextEncoder().encode(md));
  const doc = await engine.open(pdf);
  const chars = engine.getCharBoxes(doc, 0);
  expect(fuera(chars, 56, 595 - 56)).toEqual([]); // A4 con margen de 56 pt (Markdown)
  const sinEsp = chars.filter((c) => c.ch.trim() !== '').map((c) => c.ch).join('');
  expect(sinEsp).toContain(codigo.replace(/ /g, ''));
  expect(sinEsp).toContain(url);
}, 60_000);

test('Word: una parte XML en UTF-16 con BOM se lee bien (la especificación admite UTF-8 y UTF-16)', async () => {
  const engine = await PdfiumEngine.create();
  const xml = `<?xml version="1.0" encoding="UTF-16"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${parrafo('Año nuevo')}</w:body></w:document>`;
  const { pdf } = await new ConversorDocxNavegador(engine).convertir('x.docx', docx('', [], utf16le(xml, true)));
  expect(await textoPdf(engine, pdf)).toContain('Año nuevo');
}, 60_000);

test('Word con macros (.docm): el conversor acepta la extensión, convierte y avisa de que las macros se ignoran', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorDocxNavegador(engine);
  expect(conversor.acepta).toContain('docm');
  const zip = docx(parrafo('Con macros'), [{ nombre: 'word/vbaProject.bin', datos: new Uint8Array([1, 2, 3]) }]);
  const r = await conversor.convertir('m.docm', zip);
  expect(await textoPdf(engine, r.pdf)).toContain('Con macros');
  expect(r.advertencias.some((a) => a.tipo === 'omitido' && /macros/i.test(a.mensaje))).toBe(true);
  const sin = await conversor.convertir('s.docx', docx(parrafo('Sin macros')));
  expect(sin.advertencias.some((a) => /macros/i.test(a.mensaje))).toBe(false);
}, 60_000);
