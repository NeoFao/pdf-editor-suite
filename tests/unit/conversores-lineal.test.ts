import { test, expect, vi } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorMarkdownNavegador } from '../../src/convert/ConversorMarkdownNavegador';
import { ConversorDocxNavegador } from '../../src/convert/ConversorDocxNavegador';
import { construirZip } from './helpers/zipBuilder';

/**
 * E-121 (docs/ERRORES-CONOCIDOS.md): convertir un documento largo costaba
 * O(páginas²) porque `applyPageOps` se aplicaba sobre UN documento con TODAS
 * las páginas, y en PDFium cada `GenerateContent` de texto se encarece con lo
 * ya escrito en el documento (medido: 10 ms por página con 8 páginas, 160 ms
 * con 600). Per E-040 no se mide el reloj: se CUENTA el trabajo. La magnitud
 * es «páginas que tiene el documento sobre el que se llama a `applyPageOps`,
 * sumadas en todas las llamadas»: cuadrática si cada página se escribe en el
 * documento completo, lineal si se escribe en un documento de una página.
 */
async function trabajoAplicarOps(engine: PdfiumEngine, convertir: () => Promise<unknown>): Promise<{ llamadas: number; paginasSumadas: number }> {
  const original = engine.applyPageOps.bind(engine);
  let llamadas = 0;
  let paginasSumadas = 0;
  const espia = vi.spyOn(engine, 'applyPageOps').mockImplementation((doc, pageIndex, ops) => {
    llamadas++;
    paginasSumadas += engine.pageCount(doc);
    return original(doc, pageIndex, ops);
  });
  try {
    await convertir();
  } finally {
    espia.mockRestore();
  }
  return { llamadas, paginasSumadas };
}

const lorem = 'lorem ipsum dolor sit amet '.repeat(8);
const markdownDe = (n: number): Uint8Array => new TextEncoder().encode(Array.from({ length: n }, (_v, i) => `P${i} ${lorem}`).join('\n\n'));

function docxDe(n: number): Uint8Array {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const cuerpo = Array.from({ length: n }, (_v, i) => `<w:p><w:r><w:t xml:space="preserve">P${i} ${lorem}</w:t></w:r></w:p>`).join('');
  const xml = `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${cuerpo}</w:body></w:document>`;
  return construirZip([
    { nombre: '[Content_Types].xml', datos: new TextEncoder().encode('<Types/>'), metodo: 8 },
    { nombre: 'word/document.xml', datos: new TextEncoder().encode(xml), metodo: 8 }
  ]);
}

test('E-121: Markdown a PDF aplica las operaciones sobre documentos pequeños, el trabajo crece ~lineal (N vs 4N párrafos)', async () => {
  const engine = await PdfiumEngine.create();
  const conv = new ConversorMarkdownNavegador(engine);
  const chico = await trabajoAplicarOps(engine, () => conv.convertir('a.md', markdownDe(150)));
  const grande = await trabajoAplicarOps(engine, () => conv.convertir('a.md', markdownDe(600)));
  expect(chico.llamadas).toBeGreaterThanOrEqual(5); // sin esto la razón no significaría nada
  // 4× párrafos ≈ 4× páginas. Lineal: ~4×; cuadrático (antes del arreglo): ~16×.
  expect(grande.paginasSumadas / chico.paginasSumadas).toBeLessThan(6);
}, 120000);

test('E-121: Word a PDF aplica las operaciones sobre documentos pequeños, el trabajo crece ~lineal (N vs 4N párrafos)', async () => {
  const engine = await PdfiumEngine.create();
  const conv = new ConversorDocxNavegador(engine);
  const chico = await trabajoAplicarOps(engine, () => conv.convertir('a.docx', docxDe(150)));
  const grande = await trabajoAplicarOps(engine, () => conv.convertir('a.docx', docxDe(600)));
  expect(chico.llamadas).toBeGreaterThanOrEqual(5);
  expect(grande.paginasSumadas / chico.paginasSumadas).toBeLessThan(6);
}, 120000);
