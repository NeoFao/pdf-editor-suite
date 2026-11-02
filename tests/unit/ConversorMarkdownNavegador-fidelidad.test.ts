import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { ConversorMarkdownNavegador } from '../../src/convert/ConversorMarkdownNavegador';

/**
 * E-119, integración con el motor REAL: el corpus completo (tests/fixtures/corpus-markdown.md) se convierte y se
 * comprueba en el PDF resultante el texto, las anotaciones /Link (externas e internas), el outline y los avisos.
 */
const corpus = (): Uint8Array => new Uint8Array(readFileSync('tests/fixtures/corpus-markdown.md'));

let cacheCorpus: ReturnType<typeof convertirCorpusSinCache> | undefined;
/** Se convierte UNA vez por fichero de test (el motor WASM es lento con la máquina cargada) y los tests solo leen. */
function convertirCorpus() { return (cacheCorpus ??= convertirCorpusSinCache()); }

async function convertirCorpusSinCache() {
  const engine = await PdfiumEngine.create();
  const { pdf, advertencias } = await new ConversorMarkdownNavegador(engine).convertir('corpus.md', corpus());
  const doc = await engine.open(pdf);
  const paginas = Array.from({ length: engine.pageCount(doc) }, (_v, p) => engine.getPageText(doc, p).map((r) => r.text).join(' '));
  return { engine, doc, pdf, advertencias, paginas, todo: paginas.join('\n') };
}

test('corpus: el texto de cada elemento llega al PDF y nada sale corrompido', async () => {
  const { todo, engine, doc } = await convertirCorpus();
  for (const s of ['Titulo setext uno', 'Titulo setext dos', 'negrita', 'cursiva', 'ambas', 'borrado', 'cinco con start', 'tarea pendiente', 'izq', 'der', 'Texto de la nota.', 'áéíóú', '& < © é', '*literal*']) {
    expect(todo, s).toContain(s);
  }
  expect(todo).not.toContain('=====');
  expect(todo).not.toContain('~~');
  expect(todo).not.toContain('&amp;');
  expect(todo).not.toContain('|:---');
  expect(todo).not.toContain('ÿ');
  expect(todo).toContain('<b>no se interpreta</b>');
  for (let p = 0; p < engine.pageCount(doc); p++) expect(engine.listImageObjects(doc, p).length).toBeLessThanOrEqual(1);
}, 60_000);

test('corpus: enlaces reales /Link externos (https) e internos (destino a la altura del título), sin URI peligrosa', async () => {
  const { pdf, engine, doc } = await convertirCorpus();
  const crudo = Buffer.from(pdf).toString('latin1');
  for (const u of ['https://example.com/x', 'https://ref.example.com/', 'https://auto.example.org', 'https://bare.example.net/p']) expect(crudo).toContain(`/URI(${u})`);
  expect(crudo).not.toMatch(/javascript:|data:image\/png;base64.*\/URI/);
  // El enlace interno [interno](#titulo-dos): anotación hacia la página del título y a su altura (el título está en la parte alta de la página 1).
  const internos = Array.from({ length: engine.pageCount(doc) }, (_v, p) => engine.getLinks(doc, p)).flat().filter((l) => l.destino.tipo === 'pagina');
  expect(internos).toHaveLength(2); // [interno](#titulo-dos) y la referencia de la nota al pie
  const aTitulo = internos.find((l) => l.destino.tipo === 'pagina' && l.destino.pageIndex === 0 && (l.destino.yPt ?? 0) > 600 && (l.destino.yPt ?? 0) < 800);
  expect(aTitulo).toBeDefined();
}, 60_000);

test('corpus: los títulos generan el outline del PDF con su jerarquía', async () => {
  const { engine, doc } = await convertirCorpus();
  const outline = engine.getOutline(doc);
  expect(outline.length).toBeGreaterThan(0);
  const planos: string[] = [];
  const recorrer = (items: typeof outline, d: number): void => { for (const i of items) { planos.push(`${d}:${i.title}:${i.pageIndex}`); recorrer(i.children, d + 1); } };
  recorrer(outline, 0);
  expect(planos[0]).toBe('0:Titulo uno:0');
  expect(planos).toContain('1:Titulo dos:0');
  expect(planos).toContain('2:Titulo tres:0');
  expect(planos.some((p) => p.includes('Titulo setext uno'))).toBe(true);
}, 60_000);

test('corpus: la imagen data: PNG se incrusta y la relativa se omite con aviso; emoji/CJK y HTML avisan', async () => {
  const { engine, doc, advertencias } = await convertirCorpus();
  let imgs = 0;
  for (let p = 0; p < engine.pageCount(doc); p++) imgs += engine.listImageObjects(doc, p).length;
  expect(imgs).toBe(1);
  const msg = advertencias.map((a) => `${a.tipo}:${a.mensaje}`);
  expect(msg.some((m) => m.startsWith('omitido:') && m.includes('./img/foto.png'))).toBe(true);
  expect(msg.some((m) => m.startsWith('aproximado:') && m.includes('😀'))).toBe(true);
  expect(msg.some((m) => m.startsWith('aproximado:') && /HTML/.test(m))).toBe(true);
  expect(msg.filter((m) => m.includes('#titulo-dos'))).toEqual([]);
}, 60_000);

test('un enlace interno a un ancla inexistente conserva el texto y avisa; la conversión no falla', async () => {
  const engine = await PdfiumEngine.create();
  const { advertencias, pdf } = await new ConversorMarkdownNavegador(engine).convertir('a.md', new TextEncoder().encode('# A\n\n[x](#no-existe)'));
  expect(advertencias.some((a) => a.mensaje.includes('#no-existe'))).toBe(true);
  expect(pdf.length).toBeGreaterThan(100);
}, 60_000);

test('los caracteres WinAnsi fuera de Latin-1 (raya, euro, comillas tipográficas, puntos suspensivos) llegan intactos y la coma va pegada', async () => {
  const engine = await PdfiumEngine.create();
  const md = 'Raya — euro € “comillas” ‘simples’ puntos… viñeta • ñandú **negrita**, coma.';
  const { pdf, advertencias } = await new ConversorMarkdownNavegador(engine).convertir('w.md', new TextEncoder().encode(md));
  expect(advertencias).toEqual([]);
  const doc = await engine.open(pdf);
  const texto = engine.getPageText(doc, 0).map((r) => r.text).join('');
  for (const s of ['—', '€', '“comillas”', '‘simples’', '…', '•', 'ñandú']) expect(texto, s).toContain(s);
  expect(texto).toContain('negrita,');
  engine.close(doc);
}, 60_000);
