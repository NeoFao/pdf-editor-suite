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
  const { pdf: bytes, advertencias } = await conversor.convertir('ejemplo.md', new TextEncoder().encode(markdownDePrueba()));
  expect(advertencias).toEqual([]);

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

test('un enlace [texto](url) genera una anotación /Link real con la URI; un esquema no permitido no crea ninguna (fase 2a)', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorMarkdownNavegador(engine);
  const md = '[haz clic aquí](https://example.com/pagina) y este otro es [peligroso](javascript:alert(1)).';
  const { pdf } = await conversor.convertir('enlace.md', new TextEncoder().encode(md));

  const crudo = Buffer.from(pdf).toString('latin1');
  expect(crudo).toContain('/Link');
  expect(crudo).toContain('https://example.com/pagina');
  expect(crudo).not.toContain('javascript:alert');

  const doc = await engine.open(pdf);
  const texto = engine.getPageText(doc, 0).map((r) => r.text).join(' ');
  expect(texto).toContain('haz');
  expect(texto).toContain('peligroso');
  engine.close(doc);
});

test('convertir con Markdown vacío produce un PDF de 1 página sin texto', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorMarkdownNavegador(engine);
  const { pdf: bytes } = await conversor.convertir('vacio.md', new TextEncoder().encode(''));
  const doc = await engine.open(bytes);
  expect(engine.pageCount(doc)).toBe(1);
  expect(engine.getPageText(doc, 0)).toEqual([]);
  engine.close(doc);
});

test('un enlace con esquema rechazado devuelve una advertencia visible (con la URL); uno válido no', async () => {
  const engine = await PdfiumEngine.create();
  const conversor = new ConversorMarkdownNavegador(engine);
  const md = '[bien](https://example.com) y [mal](javascript:void0) y [rel](pagina.html)';
  const { advertencias } = await conversor.convertir('e.md', new TextEncoder().encode(md));
  expect(advertencias).toHaveLength(2);
  expect(advertencias.join(' | ')).toContain('javascript:void0');
  expect(advertencias.join(' | ')).toContain('pagina.html');
  expect(advertencias.join(' | ')).not.toContain('https://example.com');
});
