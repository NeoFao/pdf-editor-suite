import { test, expect, describe, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables, type LineaEditable } from '../../src/texto/lineasEditables';
import { textoDeRango } from '../../src/texto/seleccionTexto';
import { crearTextRun } from './_util/textRun';

/**
 * Texto de derecha a izquierda (E-117). Los PDF de `tests/fixtures/rtl/` los generó Chromium (`generar-fixtures-rtl.mjs`):
 * un `Tj` por glifo en árabe y por tramo de dirección en el resto, SIEMPRE en orden visual (izquierda a derecha).
 */
const RTL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/rtl');
const bytes = (n: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(RTL, n)));

let eng: PdfiumEngine;
beforeAll(async () => { eng = await PdfiumEngine.create(); });
afterAll(() => undefined);

async function lineasDe(fichero: string): Promise<LineaEditable[]> {
  const doc = await eng.open(bytes(fichero));
  try { return agruparLineasEditables(eng.getPageText(doc, 0), 0); } finally { eng.close(doc); }
}

describe('agrupado de líneas RTL: el texto sale en orden LÓGICO', () => {
  test('hebreo: un objeto por línea, texto lógico y dirección RTL', async () => {
    const ls = await lineasDe('rtl-hebreo.pdf');
    expect(ls.map((l) => l.text)).toEqual(['שלום עולם זה טקסט בעברית', 'הכל בסדר גמור היום', 'Linea latina de control']);
    expect(ls[0]!.direccion).toBe('rtl');
    expect(ls[2]!.direccion).toBe('ltr');
    expect(ls[0]!.aviso).toBeUndefined(); // un objeto hebreo SÍ se edita en su sitio
  });

  test('árabe: decenas de objetos de un glifo → una línea con el texto en orden lógico y aviso aproximado', async () => {
    const ls = await lineasDe('rtl-arabe.pdf');
    expect(ls.map((l) => l.text)).toEqual(['مرحبا بالعالم هذا نص عربي', 'كل شيء على ما يرام اليوم', 'Linea latina de control']);
    expect(ls[0]!.direccion).toBe('rtl');
    expect(ls[0]!.aviso?.tipo).toBe('aproximado');
    expect(ls[0]!.aviso?.mensaje).toMatch(/árabe/i);
    expect(ls[2]!.aviso).toBeUndefined();
  });

  test('mixto: latín con hebreo y cifras, RTL con latín y cifras, latín con árabe', async () => {
    const ls = await lineasDe('rtl-mixto.pdf');
    expect(ls.map((l) => l.text)).toEqual([
      'Hola שלום 123 fin',
      'שלום Hello 456 עולם',
      'Salida مرحبا بالعالم final',
      'שלום עולם'
    ]);
    expect(ls.map((l) => l.direccion)).toEqual(['ltr', 'rtl', 'ltr', 'rtl']);
    // Varios objetos con RTL: no se reescriben a medias (aviso), salvo la línea de un solo objeto.
    expect(ls.map((l) => l.aviso?.tipo)).toEqual(['aproximado', 'aproximado', 'aproximado', undefined]);
  });

  test('los tramos cubren el texto lógico sin huecos ni solapes', async () => {
    for (const f of ['rtl-arabe.pdf', 'rtl-mixto.pdf']) {
      for (const l of await lineasDe(f)) {
        const t = l.tramos.slice().sort((a, b) => a.inicio - b.inicio);
        expect(t[0]!.inicio).toBe(0);
        for (let i = 1; i < t.length; i++) expect(t[i]!.inicio).toBe(t[i - 1]!.fin);
        expect(t[t.length - 1]!.fin).toBe(l.text.length);
      }
    }
  });
});

describe('agrupado de líneas: un texto sin RTL no cambia', () => {
  test('latín: misma línea, dirección ltr y sin aviso', () => {
    const ls = agruparLineasEditables([
      crearTextRun({ text: 'Ho', xPt: 40, yPt: 700, sizePt: 10, runId: 0 }),
      crearTextRun({ text: 'la', xPt: 50, yPt: 700, sizePt: 10, runId: 1 })
    ]);
    expect(ls).toHaveLength(1);
    expect(ls[0]!.text).toBe('Hola');
    expect(ls[0]!.direccion).toBe('ltr');
    expect(ls[0]!.aviso).toBeUndefined();
  });
});

describe('copiar: el texto de un rango sale en orden lógico', () => {
  test('línea mixta: copiar de punta a punta da el texto exacto (no el orden de PDFium)', async () => {
    const doc = await eng.open(bytes('rtl-mixto.pdf'));
    try {
      const chars = eng.getCharBoxes(doc, 0);
      const copiado = textoDeRango(chars, 0, chars.length - 1);
      expect(copiado.split('\n')).toEqual([
        'Hola שלום 123 fin',
        'שלום Hello 456 עולם',
        'Salida مرحبا بالعالم final',
        'שלום עולם'
      ]);
    } finally { eng.close(doc); }
  });

  test('árabe y hebreo puros', async () => {
    for (const [f, esperado] of [
      ['rtl-arabe.pdf', ['مرحبا بالعالم هذا نص عربي', 'كل شيء على ما يرام اليوم', 'Linea latina de control']],
      ['rtl-hebreo.pdf', ['שלום עולם זה טקסט בעברית', 'הכל בסדר גמור היום', 'Linea latina de control']]
    ] as const) {
      const doc = await eng.open(bytes(f));
      try {
        const chars = eng.getCharBoxes(doc, 0);
        expect(textoDeRango(chars, 0, chars.length - 1).split('\n')).toEqual(esperado);
      } finally { eng.close(doc); }
    }
  });
});

describe('buscar: encuentra palabras RTL y secuencias mixtas', () => {
  test('una palabra hebrea y una árabe tienen resultado en su sitio', async () => {
    const heb = await eng.open(bytes('rtl-hebreo.pdf'));
    const ara = await eng.open(bytes('rtl-arabe.pdf'));
    try {
      const h = eng.findText(heb, 0, 'עולם');
      expect(h).toHaveLength(1);
      expect(h[0]!.xPt).toBeGreaterThan(300); // la 2.ª palabra de una línea RTL está hacia la derecha
      const a = eng.findText(ara, 0, 'بالعالم');
      expect(a).toHaveLength(1);
    } finally { eng.close(heb); eng.close(ara); }
  });
});
