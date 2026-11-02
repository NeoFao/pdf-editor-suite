import { test, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { agruparLineasEditables } from '../../src/texto/lineasEditables';

/** E-117: editar una línea hebrea de un objeto escribe el orden VISUAL, relee el texto lógico y conserva el borde derecho. */
const RTL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/rtl');
const bytes = (n: string): Uint8Array => new Uint8Array(fs.readFileSync(path.join(RTL, n)));
let eng: PdfiumEngine;
beforeAll(async () => { eng = await PdfiumEngine.create(); });

test('cambiar una palabra hebrea: el texto releído es el nuevo y el borde derecho no se mueve', async () => {
  const doc = await eng.open(bytes('rtl-hebreo.pdf'));
  try {
    const antes = agruparLineasEditables(eng.getPageText(doc, 0), 0)[0]!;
    expect(antes.text).toBe('שלום עולם זה טקסט בעברית');
    const nuevo = 'שלום שלום זה טקסט בעברית';
    const res = eng.editLine(doc, 0, antes, nuevo);
    expect(res.ok).toBe(true);
    const despues = agruparLineasEditables(eng.getPageText(doc, 0), 0)[0]!;
    expect(despues.text).toBe(nuevo);
    const derAntes = antes.boxPt.xPt + antes.boxPt.wPt, derDespues = despues.boxPt.xPt + despues.boxPt.wPt;
    expect(Math.abs(derAntes - derDespues)).toBeLessThan(1.5);
  } finally { eng.close(doc); }
});

test('una línea con aviso (varios objetos con RTL) no se reescribe: el motor la rechaza sin tocar nada', async () => {
  const doc = await eng.open(bytes('rtl-mixto.pdf'));
  try {
    const l = agruparLineasEditables(eng.getPageText(doc, 0), 0)[0]!;
    expect(l.aviso?.tipo).toBe('aproximado');
    const res = eng.editLine(doc, 0, l, 'Hola mundo 123 fin');
    expect(res.ok).toBe(false);
    expect(agruparLineasEditables(eng.getPageText(doc, 0), 0)[0]!.text).toBe(l.text);
  } finally { eng.close(doc); }
});
