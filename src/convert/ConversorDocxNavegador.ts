import type { ConversorDocumento, ResultadoConversion } from './ConversorDocumento';
import type { PdfEngine, DocHandle, PageOp } from '../engine/PdfEngine';
import { omitido, type Advertencia } from './advertencia';
import { abrirZip } from './docx/zip';
import { DocxError } from './docx/DocxError';
import { construirModeloDocx } from './docx/modelo';
import { leerRelaciones, rutaMediaDesdeWord } from './docx/rels';
import { renderizarModeloDocx } from './docx/render';
import { decodificarImagenDocx, type ResultadoImagenDocx } from './imagenes/decodificarImagenDocx';
import type { ImagenColocada } from './flujo/layout';

/**
 * Conversor `.docx` (Word) -> PDF, 100% en el navegador, con el motor
 * PDFium (§9 fila #4, FASE 2a + 2b). Igual que `ConversorMarkdownNavegador`: el
 * PDF resultante tiene texto REAL y vectorial (`insertText`), nunca una
 * imagen rasterizada — a diferencia de la app vieja (`docx-preview` +
 * `html2pdf`).
 *
 * Fase 2a añade sobre la fase 1 (ver `docx/modelo.ts` y `docx/render.ts`
 * para el detalle): TABLAS reales (grid, spans, merges, bordes, sombreado),
 * IMÁGENES inline (`w:drawing`, PNG/JPEG, decodificadas por
 * `decodificarImagenDocx` y colocadas con `insertImage`) y ENLACES clicables
 * (`w:hyperlink` externo, anotación `/Link` real vía `addLink`, con la
 * misma validación de esquema que el motor). Sigue sin cuadros de texto,
 * notas al pie, otros campos ni control de cambios
 * resuelto — todo eso se CUENTA en `advertencias` (nunca se pierde en
 * silencio, ver `ConversorDocumento.ResultadoConversion`).
 *
 * Fase 2b: ENCABEZADOS y PIES repetidos en cada página (default/first/even,
 * con `PAGE`/`NUMPAGES` resueltos en dos pasadas), título no huérfano
 * (`w:keepNext`/`w:keepLines`), bordes por celda (`w:tcBorders`) e imágenes
 * flotantes (`wp:anchor`) colocadas SIN ajuste de texto (con aviso).
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
    const relsBytes = await zip.leer('word/_rels/document.xml.rels');
    const relsXml = relsBytes ? decodificador.decode(relsBytes) : null;

    // Fase 2b: encabezados y pies (`word/header*.xml`/`footer*.xml`, los que enlazan las relaciones del documento) y `settings.xml`
    // (`w:evenAndOddHeaders`). Se leen aquí (el modelo es puro y no toca el ZIP) y se pasan ya decodificados.
    const settingsBytes = await zip.leer('word/settings.xml');
    const partes: Record<string, string> = {};
    if (relsXml) {
      for (const rel of leerRelaciones(relsXml).values()) {
        if (!/(^|\/)(header|footer)\d*\.xml$/i.test(rel.target)) continue;
        const ruta = rutaMediaDesdeWord(rel.target);
        const bytesParte = await zip.leer(ruta);
        if (bytesParte) partes[ruta] = decodificador.decode(bytesParte);
      }
    }

    const modelo = construirModeloDocx(documentXml, stylesXml, numberingXml, relsXml, { settingsXml: settingsBytes ? decodificador.decode(settingsBytes) : null, partes });

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
    const { totalPaginas, trazos, barras, imagenes, enlaces } = renderizarModeloDocx(modelo, medir);

    const { rgbaPorId, advertenciasImagenes } = await this.resolverImagenes(zip, imagenes);
    const advertencias = [...modelo.advertencias, ...advertenciasImagenes];

    const blank = this.engine.createBlank(modelo.paginaAnchoPt, modelo.paginaAltoPt);
    const doc: DocHandle = await this.engine.open(blank);
    for (let i = 1; i < totalPaginas; i++) this.engine.importPages(doc, blank, i);

    // Lote por página (E-037, docs/ERRORES-CONOCIDOS.md): ver el mismo
    // razonamiento en `ConversorMarkdownNavegador`. Orden de dibujo: fondos
    // y bordes (fillRect) primero, luego imágenes, luego texto encima;
    // los enlaces son anotaciones transparentes (no compiten por z-order).
    const opsPorPagina = new Map<number, PageOp[]>();
    const agregar = (page: number, op: PageOp): void => {
      let lista = opsPorPagina.get(page);
      if (!lista) { lista = []; opsPorPagina.set(page, lista); }
      lista.push(op);
    };
    for (const b of barras) {
      agregar(b.page, { type: 'fillRect', rect: { xPt: b.xPt, yPt: b.yPt, wPt: b.wPt, hPt: b.hPt }, color: b.color });
    }
    for (const img of imagenes) {
      const rgba = rgbaPorId.get(img.imgId);
      if (!rgba) continue; // decodificación fallida: ya se avisó en resolverImagenes, el hueco queda en blanco
      agregar(img.page, { type: 'insertImage', spec: { rgba: rgba.rgba, imgWidth: rgba.width, imgHeight: rgba.height, xPt: img.xPt, yPt: img.yPt, wPt: img.wPt, hPt: img.hPt } });
    }
    for (const t of trazos) {
      agregar(t.page, { type: 'insertText', spec: { xPt: t.xPt, yPt: t.yPt, text: t.text, sizePt: t.sizePt, fontName: t.font, color: t.color } });
    }
    for (const e of enlaces) {
      agregar(e.page, { type: 'addLink', rect: { xPt: e.xPt, yPt: e.yPt, wPt: e.wPt, hPt: e.hPt }, url: e.url });
    }
    for (const [page, ops] of opsPorPagina) this.engine.applyPageOps(doc, page, ops);

    const out = this.engine.save(doc);
    this.engine.close(doc);
    return { pdf: out, advertencias };
  }

  /**
   * Lee y decodifica (una sola vez por `imgId`, aunque la misma imagen se
   * use varias veces en el documento) cada imagen que el maquetador dejó
   * colocada. Una imagen que no se pueda leer del ZIP o decodificar no
   * aborta la conversión: se cuenta en advertencias y su hueco en el
   * layout queda en blanco (mejor que perder el documento entero).
   */
  private async resolverImagenes(
    zip: ReturnType<typeof abrirZip>, imagenes: ImagenColocada[]
  ): Promise<{ rgbaPorId: Map<string, { rgba: Uint8Array; width: number; height: number }>; advertenciasImagenes: Advertencia[] }> {
    const rgbaPorId = new Map<string, { rgba: Uint8Array; width: number; height: number }>();
    const advertenciasImagenes: Advertencia[] = [];
    const idsUnicos = [...new Set(imagenes.map((i) => i.imgId))];
    for (const id of idsUnicos) {
      const bytesImagen = await zip.leer(id);
      if (!bytesImagen) {
        advertenciasImagenes.push(omitido(`No se pudo insertar una imagen del documento (no se encontró "${id}" dentro del paquete).`));
        continue;
      }
      const resultado: ResultadoImagenDocx = await decodificarImagenDocx(bytesImagen);
      if (!resultado.ok) {
        const motivo = resultado.razon === 'demasiado-grande' ? 'demasiado grande'
          : resultado.razon === 'formato-no-soportado' ? 'formato no soportado (solo PNG y JPEG en esta fase)'
            : 'no se pudo decodificar (archivo dañado o variante no soportada)';
        advertenciasImagenes.push(omitido(`No se pudo insertar una imagen del documento (${motivo}).`));
        continue;
      }
      rgbaPorId.set(id, resultado.imagen);
    }
    return { rgbaPorId, advertenciasImagenes };
  }
}
