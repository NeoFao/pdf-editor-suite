import type { ConversorDocumento, ResultadoConversion } from './ConversorDocumento';
import { parseMarkdown } from './markdown/parse';
import { layoutMarkdown, PAGE_WIDTH_PT, PAGE_HEIGHT_PT } from './markdown/layout';
import type { PdfEngine, DocHandle, PageOp } from '../engine/PdfEngine';

/**
 * Conversor Markdown → PDF, 100% en el navegador, con el motor PDFium: el
 * PDF resultante tiene texto REAL y vectorial (`insertText`), nunca una
 * imagen rasterizada — a diferencia de la app vieja, que usa `marked` +
 * `html2pdf` y produce un PDF donde el texto es en realidad un dibujo sin
 * glifos seleccionables. Ver docs/superpowers/specs/2026-09-25-cimientos-
 * motor-pdfium-design.md, §9 fila #32.
 *
 * Fase 1 (documentado también en `layout.ts` y `parse.ts`): sin tablas, sin
 * imágenes embebidas, sin URL de enlace como anotación clicable — el texto
 * del enlace se pinta en azul, pero el destino no queda clicable todavía
 * (`InsertTextSpec`/`PdfEngine` no tienen hoy un método para anotaciones
 * `/Link`; añadirlo es candidato para la fase 2, fuera de alcance de este
 * PR: no tocar el motor solo para esto).
 */
export class ConversorMarkdownNavegador implements ConversorDocumento {
  readonly acepta = ['md', 'markdown'] as const;
  readonly nombreFuente = 'Markdown';

  constructor(private readonly engine: PdfEngine) {}

  async convertir(_nombre: string, bytes: Uint8Array): Promise<ResultadoConversion> {
    const texto = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const ast = parseMarkdown(texto);
    // El maquetador mide CADA palabra (y el espacio tras ella) para el
    // ajuste de línea; un documento normal repite muchísimas palabras
    // (artículos, conectores...) y espacios con el mismo font+tamaño. Sin
    // memoizar, cada repetición vuelve a cruzar la frontera WASM del motor
    // (una llamada nativa por carácter) — con un párrafo de varios cientos
    // de palabras eso se nota (varios segundos, todos en el hilo principal:
    // measureText es síncrono). El caché es solo de esta conversión (una
    // `Map` nueva por llamada a `convertir`), no del motor.
    const cache = new Map<string, number>();
    const medir = (font: string, sizePt: number, s: string): number => {
      const key = `${font}\u0000${sizePt}\u0000${s}`;
      let w = cache.get(key);
      if (w === undefined) { w = this.engine.measureText(font, sizePt, s); cache.set(key, w); }
      return w;
    };
    const { totalPaginas, trazos, barras } = layoutMarkdown(ast, medir);

    // Documento base: una página en blanco (createBlank), y tantas páginas
    // más como haga falta importando la MISMA página en blanco una y otra
    // vez (importPages ya existe en el contrato; evita tener que añadir un
    // método de "página nueva" solo para esto).
    const blank = this.engine.createBlank(PAGE_WIDTH_PT, PAGE_HEIGHT_PT);
    const doc: DocHandle = await this.engine.open(blank);
    for (let i = 1; i < totalPaginas; i++) this.engine.importPages(doc, blank, i);

    // Lote por página (E-037, docs/ERRORES-CONOCIDOS.md): fillRect/insertText
    // sueltos regeneran el contenido de la página en CADA llamada (coste que
    // crece con el número de objetos ya insertados) — con cientos de trazos
    // eso son varios segundos, todos en el hilo principal. Se agrupan las
    // ops por página (barras antes que trazos DENTRO de cada página, para
    // conservar el mismo orden de dibujo/z-order que el bucle original) y se
    // aplican con una sola llamada a applyPageOps por página.
    const opsPorPagina = new Map<number, PageOp[]>();
    const agregar = (page: number, op: PageOp): void => {
      let lista = opsPorPagina.get(page);
      if (!lista) { lista = []; opsPorPagina.set(page, lista); }
      lista.push(op);
    };
    for (const b of barras) {
      agregar(b.page, { type: 'fillRect', rect: { xPt: b.xPt, yPt: b.yPt, wPt: b.wPt, hPt: b.hPt }, color: b.color });
    }
    for (const t of trazos) {
      agregar(t.page, { type: 'insertText', spec: { xPt: t.xPt, yPt: t.yPt, text: t.text, sizePt: t.sizePt, fontName: t.font, color: t.color } });
    }
    for (const [page, ops] of opsPorPagina) this.engine.applyPageOps(doc, page, ops);

    const out = this.engine.save(doc);
    this.engine.close(doc);
    return { pdf: out, advertencias: [] };
  }
}
