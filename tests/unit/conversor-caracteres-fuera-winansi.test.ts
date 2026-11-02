import { test, expect } from 'vitest';
import zlib from 'node:zlib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorMarkdownNavegador } from '../../src/convert/ConversorMarkdownNavegador';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import type { Advertencia } from '../../src/convert/advertencia';
import { construirZip } from './helpers/zipBuilder';

/**
 * E-120: Word → PDF y Markdown → PDF sacaban `ÿ`, SIN aviso, para todo carácter fuera de WinAnsi (polaco, cirílico,
 * griego, CJK, emoji...). Estos tests usan el motor REAL (PDFium) y comprueban sobre el PDF resultante.
 */

const POLACO = 'Zażółć gęślą jaźń';
const GRIEGO = 'Γεια σας αβγδ ΣΩ';
const CIRILICO = 'Привет мир';
const EMOJI = 'Hola 😀 fin';
const FRASES = [POLACO, GRIEGO, CIRILICO, EMOJI];

// Lo que NO tiene glifo en ninguna fuente estándar de PDF (WinAnsi + Symbol + ZapfDingbats): ó sí es WinAnsi; el griego
// sin tildes va en Symbol.
const NO_SOPORTADOS = 'żłćęśąźń' + 'Приветмир' + '😀';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function docxDe(parrafos: string[]): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const cuerpo = parrafos.map((t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${cuerpo}</w:body></w:document>`;
  return construirZip([
    { nombre: '[Content_Types].xml', datos: enc('<Types/>'), metodo: 8 },
    { nombre: 'word/document.xml', datos: enc(xml), metodo: 8 }
  ]);
}

/** Texto de todas las páginas del PDF y las fuentes de cada tramo. */
async function leer(engine: PdfiumEngine, pdf: Uint8Array): Promise<{ texto: string; runs: { text: string; fontName: string }[] }> {
  const doc = await engine.open(pdf);
  try {
    const runs: { text: string; fontName: string }[] = [];
    for (let i = 0; i < engine.pageCount(doc); i++) for (const r of engine.getPageText(doc, i)) runs.push({ text: r.text, fontName: r.fontName });
    return { texto: runs.map((r) => r.text).join('\n'), runs };
  } finally {
    engine.close(doc);
  }
}

/** Streams de contenido descomprimidos del PDF, como texto latin1 (para buscar `/ActualText`). */
function contenidoPdf(pdf: Uint8Array): string {
  const b = Buffer.from(pdf);
  const s = b.toString('latin1');
  const out: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const ini = m.index + m[0].length;
    const fin = s.indexOf('endstream', ini);
    try { out.push(zlib.inflateSync(b.subarray(ini, fin)).toString('latin1')); } catch { /* no es Flate */ }
  }
  return out.join('\n');
}

function contar(texto: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const ch of texto) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}

function verificarAvisoSinFuente(advertencias: Advertencia[]): void {
  const aviso = advertencias.find((a) => a.codigo === 'caracteresSinFuente');
  expect(aviso, 'debe haber un aviso caracteresSinFuente').toBeDefined();
  expect(aviso!.tipo).toBe('omitido');
  const esperado = contar(NO_SOPORTADOS);
  const obtenido = new Map(aviso!.caracteres!.map((c) => [c.caracter, c.veces]));
  expect(obtenido).toEqual(esperado);
  for (const c of aviso!.caracteres!) expect(c.codigo).toBe('U+' + c.caracter.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0'));
  expect(aviso!.mensaje).toContain('U+0142'); // ł
}

function verificarPdf(texto: string, runs: { text: string; fontName: string }[]): void {
  expect(texto).not.toContain('ÿ');
  // El PDF dibuja `?` donde no hay glifo, pero el texto EXTRAÍBLE conserva el original (/ActualText, PDFium lo respeta).
  expect(texto).toContain('Zażółć gęślą jaźń');
  expect(texto).toContain('Привет мир');
  expect(texto).toContain('αβγδ'); // griego sin tilde: glifo real de Symbol
  expect(texto).toContain('Σ');
  // Límite: PDFium no devuelve al extraer los caracteres fuera del BMP (emoji) del /ActualText; el PDF sí lo lleva (test siguiente).
  expect(texto).toMatch(/Frase: Hola\s+fin/);
  expect(runs.some((r) => /Symbol/i.test(r.fontName) && r.text.includes('αβγδ'))).toBe(true);
}

test('Markdown: polaco, griego, cirílico y emoji no salen como ÿ; el griego sale con glifo; el aviso enumera exactamente lo no soportado', async () => {
  const engine = await PdfiumEngine.create();
  const md = FRASES.map((f) => `Frase: ${f}`).join('\n\n');
  const { pdf, advertencias } = await new ConversorMarkdownNavegador(engine).convertir('x.md', enc(md));
  const { texto, runs } = await leer(engine, pdf);
  verificarPdf(texto, runs);
  verificarAvisoSinFuente(advertencias);
});

test('Word: polaco, griego, cirílico y emoji no salen como ÿ; el griego sale con glifo; el aviso enumera exactamente lo no soportado', async () => {
  const engine = await PdfiumEngine.create();
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir('x.docx', docxDe(FRASES.map((f) => `Frase: ${f}`)));
  const { texto, runs } = await leer(engine, pdf);
  verificarPdf(texto, runs);
  verificarAvisoSinFuente(advertencias);
});

test('el texto original de lo sustituido se conserva en el PDF como /ActualText (Markdown y Word)', async () => {
  const engine = await PdfiumEngine.create();
  const md = await new ConversorMarkdownNavegador(engine).convertir('x.md', enc('Hola Привет'));
  const dx = await new ConversorDocxNavegador(engine).convertir('x.docx', docxDe(['Hola Привет']));
  const emoji = await new ConversorMarkdownNavegador(engine).convertir('e.md', enc('Hola 😀'));
  expect(contenidoPdf(emoji.pdf)).toContain(Buffer.from('😀', 'utf8').toString('latin1'));
  for (const { pdf } of [md, dx]) {
    const c = contenidoPdf(pdf);
    expect(c).toContain('/ActualText');
    expect(c).toContain(Buffer.from('Привет', 'utf8').toString('latin1')); // UTF-8 (PDF 2.0, con BOM) dentro de la cadena
  }
});

test('sin caracteres fuera de WinAnsi no hay aviso ni /ActualText', async () => {
  const engine = await PdfiumEngine.create();
  const { pdf, advertencias } = await new ConversorMarkdownNavegador(engine).convertir('x.md', enc('Año nuevo, señor: ¿qué tal? “comillas” — €'));
  expect(advertencias).toEqual([]);
  expect(contenidoPdf(pdf)).not.toContain('/ActualText');
  expect((await leer(engine, pdf)).texto).toContain('Año nuevo, señor');
});

test('símbolos que sí existen en Symbol/ZapfDingbats (flechas, matemáticas, check) se dibujan sin aviso', async () => {
  const engine = await PdfiumEngine.create();
  const { pdf, advertencias } = await new ConversorMarkdownNavegador(engine).convertir('x.md', enc('Flujo a → b, x ≤ y, n ≠ 0, ∞, ✓ hecho'));
  expect(advertencias).toEqual([]);
  const { texto } = await leer(engine, pdf);
  for (const s of ['→', '≤', '≠', '∞', '✓']) expect(texto).toContain(s);
  expect(texto).not.toContain('ÿ');
});

test('Markdown: un NUL no cuelga ni mata el motor; se elimina y se avisa (línea solo-NUL, NUL en medio y en un bloque de código)', async () => {
  const engine = await PdfiumEngine.create();
  const md = '\u0000\n\nANTES\u0000DESPUES\n\n```\ncod\u0000igo\n```\n';
  const { pdf, advertencias } = await new ConversorMarkdownNavegador(engine).convertir('x.md', enc(md));
  const { texto } = await leer(engine, pdf);
  expect(texto).toContain('ANTESDESPUES');
  expect(texto).toContain('codigo');
  const aviso = advertencias.find((a) => a.codigo === 'caracteresControl');
  expect(aviso).toBeDefined();
  expect(aviso!.tipo).toBe('omitido');
  expect(aviso!.mensaje).toContain('U+0000');
  // El motor sigue vivo: convierte otro documento.
  const otro = await new ConversorMarkdownNavegador(engine).convertir('y.md', enc('sigue vivo'));
  expect((await leer(engine, otro.pdf)).texto).toContain('sigue vivo');
});

test('Markdown: un documento que es SOLO NUL (o binario) convierte sin lanzar', async () => {
  const engine = await PdfiumEngine.create();
  const { pdf } = await new ConversorMarkdownNavegador(engine).convertir('x.md', new Uint8Array(100));
  expect((await engine.open(pdf)) > 0).toBe(true);
});

test('Word: un NUL dentro de w:t se elimina con aviso y no trunca el resto de la línea', async () => {
  const engine = await PdfiumEngine.create();
  // En XML 1.0 un NUL literal no es válido; llega como referencia numérica &#0; en algunos generadores, o ya decodificado.
  const { pdf, advertencias } = await new ConversorDocxNavegador(engine).convertir('x.docx', docxDe(['ANTES\u0000DESPUES', '\u0000']));
  const { texto } = await leer(engine, pdf);
  expect(texto).toContain('ANTESDESPUES');
  expect(advertencias.some((a) => a.codigo === 'caracteresControl')).toBe(true);
});

test('el motor rechaza un NUL en escribirTexto con un error recuperable (defensa en profundidad) y sigue vivo', async () => {
  const engine = await PdfiumEngine.create();
  const blank = engine.createBlank(200, 200);
  const doc = await engine.open(blank);
  expect(() => engine.applyPageOps(doc, 0, [{ type: 'insertText', spec: { xPt: 10, yPt: 10, text: 'a\u0000b', sizePt: 10 } }])).toThrow(/NUL|control/i);
  engine.applyPageOps(doc, 0, [{ type: 'insertText', spec: { xPt: 10, yPt: 10, text: 'vivo', sizePt: 10 } }]);
  expect(engine.getPageText(doc, 0).map((r) => r.text).join('')).toContain('vivo');
  engine.close(doc);
});
