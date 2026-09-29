import type { ConversorDocumento, ResultadoConversion } from './ConversorDocumento';
import type { PdfEngine, DocHandle, PageOp } from '../engine/PdfEngine';
import { abrirZip } from './docx/zip';
import { DocxError } from './docx/DocxError';
import { construirModeloDocx } from './docx/modelo';
import { renderizarModeloDocx } from './docx/render';

/**
 * Conversor `.docx` (Word) -> PDF, 100% en el navegador, con el motor
 * PDFium (§9 fila #4, FASE 1). Igual que `ConversorMarkdownNavegador`: el
 * PDF resultante tiene texto REAL y vectorial (`insertText`), nunca una
 * imagen rasterizada — a diferencia de la app vieja (`docx-preview` +
 * `html2pdf`).
 *
 * Fase 1 (ver `docx/modelo.ts` y `docx/render.ts` para el detalle):
 * párrafos con negrita/cursiva/subrayado/tamaño/color, alineación,
 * sangrías, espaciado, saltos de página, encabezados por estilo, listas con
 * viñeta/numeración correlativa, tablas aplanadas a texto con advertencia.
 * Sin tablas reales, imágenes, encabezados/pies de página, cuadros de
 * texto, notas al pie, campos ni control de cambios resuelto — todo eso se
 * CUENTA en `advertencias` (nunca se pierde en silencio, ver
 * `ConversorDocumento.ResultadoConversion`).
 *
 * Fuentes: Calibri/Arial y similares se mapean a Helvetica, Times New
 * Roman/Cambria a Times, Consolas/Courier New a Courier (`fontClassify`),
 * conservando negrita/cursiva. Las métricas de Calibri no son las de
 * Helvetica, así que los saltos de línea no serán IDÉNTICOS a Word — se
 * resolverá con el futuro conversor de escritorio (LibreOffice/Word reales,
 * mismo puerto `ConversorDocumento`, ver ese fichero).
 */
export class ConversorDocxNavegador implements ConversorDocumento {
  readonly acepta = ['docx'] as const;
  readonly nombreFuente = 'Word';

  constructor(private readonly engine: PdfEngine) {}

  async convertir(_nombre: string, bytes: Uint8Array): Promise<ResultadoConversion> {
    const zip = abrirZip(bytes);
    const documentXmlBytes = await zip.leer('word/document.xml');
    if (!documentXmlBytes) {
      throw new DocxError('El archivo no es un documento de Word válido: falta word/document.xml.');
    }
    const decodificador = new TextDecoder('utf-8', { fatal: false });
    const documentXml = decodificador.decode(documentXmlBytes);
    const stylesBytes = await zip.leer('word/styles.xml');
    const stylesXml = stylesBytes ? decodificador.decode(stylesBytes) : null;
    const numberingBytes = await zip.leer('word/numbering.xml');
    const numberingXml = numberingBytes ? decodificador.decode(numberingBytes) : null;

    const modelo = construirModeloDocx(documentXml, stylesXml, numberingXml);

    // Mismo caché de `measureText` por conversión que `ConversorMarkdownNavegador`
    // (ver el comentario allí): evita cruzar la frontera WASM por cada
    // repetición de una misma palabra/fuente/tamaño.
    const cache = new Map<string, number>();
    const medir = (font: string, sizePt: number, s: string): number => {
      const key = `${font}\u0000${sizePt}\u0000${s}`;
      let w = cache.get(key);
      if (w === undefined) { w = this.engine.measureText(font, sizePt, s); cache.set(key, w); }
      return w;
    };
    const { totalPaginas, trazos, barras } = renderizarModeloDocx(modelo, medir);

    const blank = this.engine.createBlank(modelo.paginaAnchoPt, modelo.paginaAltoPt);
    const doc: DocHandle = await this.engine.open(blank);
    for (let i = 1; i < totalPaginas; i++) this.engine.importPages(doc, blank, i);

    // Lote por página (E-037, docs/ERRORES-CONOCIDOS.md): ver el mismo
    // razonamiento en `ConversorMarkdownNavegador`.
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
    return { pdf: out, advertencias: modelo.advertencias };
  }
}
