import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import type { OutlineItem } from '../../src/engine/PdfEngine';

/**
 * Marcadores del PDF desde los títulos de Word (E-114), con el motor REAL: `word-outline.docx` (ver `generar-fixtures.mjs`): H1, H2, H2,
 * H1, H3 en 3 páginas Carta con margen de 72 pt y líneas de 12 pt. Los valores son copia deliberada del generador (ese módulo ejecuta
 * `main()` al importarlo).
 */
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const LINEA = 12;
const ESPERADO = [
  { texto: 'Introduccion', pagina: 1, yPt: 720 }, { texto: 'Contexto', pagina: 1, yPt: 684 }, { texto: 'Alcance', pagina: 1, yPt: 648 },
  { texto: 'Desarrollo', pagina: 2, yPt: 672 }, { texto: 'Detalle', pagina: 3, yPt: 648 }
];
const plano = (items: OutlineItem[]): OutlineItem[] => items.flatMap((i) => [i, ...plano(i.children)]);

async function convertirFixture(nombre: string) {
  const engine = await PdfiumEngine.create();
  const bytes = new Uint8Array(fs.readFileSync(path.resolve(AQUI, '../fixtures/generados', nombre)));
  const { pdf } = await new ConversorDocxNavegador(engine).convertir(nombre, bytes);
  const doc = await engine.open(engine.save(await engine.open(pdf))); // guardar y reabrir: el outline persiste
  return { engine, doc };
}

test('word-outline.docx: el PDF lleva el arbol H1 > (H2, H2), H1 > H3 con pagina y altura de cada titulo', async () => {
  const { engine, doc } = await convertirFixture('word-outline.docx');
  expect(engine.pageCount(doc)).toBe(3);
  const outline = engine.getOutline(doc);
  // Estructura: Introduccion > (Contexto, Alcance); Desarrollo > Detalle (H3 tras H1 cuelga del H1: se salta el nivel 2).
  expect(outline.map((i) => i.title)).toEqual(['Introduccion', 'Desarrollo']);
  expect(outline[0]!.children.map((i) => i.title)).toEqual(['Contexto', 'Alcance']);
  expect(outline[1]!.children.map((i) => i.title)).toEqual(['Detalle']);
  const titulos = plano(outline);
  expect(titulos.map((i) => i.title)).not.toContain('No soy titulo'); // estilo llamado "heading 4" pero sin outlineLvl
  expect(titulos).toHaveLength(ESPERADO.length);
  for (const [i, esp] of ESPERADO.entries()) {
    const t = titulos[i]!;
    expect(t.title).toBe(esp.texto);
    expect(t.pageIndex).toBe(esp.pagina - 1);
    expect(t.accion).toBeUndefined();
    expect(Math.abs(t.yPt! - esp.yPt)).toBeLessThanOrEqual(LINEA);
  }
  engine.close(doc);
});

test('un documento sin titulos no lleva outline', async () => {
  const { engine, doc } = await convertirFixture('word-enlaces-internos.docx');
  expect(engine.getOutline(doc)).toEqual([]);
  engine.close(doc);
});
