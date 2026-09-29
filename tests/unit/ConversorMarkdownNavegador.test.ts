import { test, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorMarkdownNavegador } from '../../src/convert/ConversorMarkdownNavegador';

/**
 * Conversor con el motor REAL (no el `medir` falso de los tests de
 * `layout.test.ts`): comprueba que el PDF que sale es vectorial de verdad
 * (ningún objeto imagen) y que el título llega con la fuente/tamaño de
 * encabezado esperados — la garantía central de la fila #32: "mejorada:
 * vectorial, sin rasterizar".
 */
function markdownDePrueba(): string {
  const parrafoLargo = Array.from({ length: 400 }, (_v, i) => `palabra${i}`).join(' ');
  return [
    '# Título del documento',
    '',
    parrafoLargo,
    '',
    '- primer ítem',
    '- segundo ítem',
    '',
    '```js',
    'const x = 1;',
    '```'
  ].join('\n');
}

test('convertir produce un PDF de al menos 2 páginas con texto vectorial (sin imágenes)', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorMarkdownNavegador(engine);
  const bytes = await conversor.convertir('ejemplo.md', new TextEncoder().encode(markdownDePrueba()));

  const doc = await engine.open(bytes);
  const n = engine.pageCount(doc);
  expect(n).toBeGreaterThanOrEqual(2);

  const runsPagina1 = engine.getPageText(doc, 0);
  const titulo = runsPagina1.find((r) => r.text === 'Título' || r.text.includes('Título'));
  expect(titulo).toBeDefined();
  expect(titulo!.fontName).toContain('Helvetica-Bold');
  expect(Math.round(titulo!.sizePt)).toBe(22);

  for (let p = 0; p < n; p++) {
    expect(engine.listImageObjects(doc, p)).toEqual([]);
  }

  engine.close(doc);
});

test('convertir con Markdown vacío produce un PDF de 1 página sin texto', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorMarkdownNavegador(engine);
  const bytes = await conversor.convertir('vacio.md', new TextEncoder().encode(''));
  const doc = await engine.open(bytes);
  expect(engine.pageCount(doc)).toBe(1);
  expect(engine.getPageText(doc, 0)).toEqual([]);
  engine.close(doc);
});
