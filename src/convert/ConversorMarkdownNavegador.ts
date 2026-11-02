import type { ConversorDocumento, ResultadoConversion } from './ConversorDocumento';
import { aproximado, type Advertencia } from './advertencia';
import { parseMarkdown } from './markdown/parse';
import { layoutMarkdown, PAGE_WIDTH_PT, PAGE_HEIGHT_PT, type TituloColocado } from './markdown/layout';
import type { Block, Inline } from './markdown/ast';
import { decodificarImagenDocx, MAX_IMG_BYTES } from './imagenes/decodificarImagenDocx';
import { OUTLINE_MAX_DEPTH, OUTLINE_MAX_NODES } from '../engine/cotasOutline';
import type { PdfEngine, DocHandle, PageOp, OutlineItem } from '../engine/PdfEngine';

/**
 * Conversor Markdown → PDF, 100% en el navegador, con el motor PDFium: el
 * PDF resultante tiene texto REAL y vectorial (`insertText`), nunca una
 * imagen rasterizada — a diferencia de la app vieja, que usa `marked` +
 * `html2pdf` y produce un PDF donde el texto es en realidad un dibujo sin
 * glifos seleccionables. Ver docs/superpowers/specs/2026-09-25-cimientos-
 * motor-pdfium-design.md, §9 fila #32.
 *
 * Enlaces: cada enlace externo del AST se emite como una anotación `/Link`
 * real (`PdfEngine.addLink`, vía el lote `applyPageOps`); la validación de
 * esquema (solo `http:`/`https:`/`mailto:`) la hace el propio motor
 * (`validarUrlEnlace.ts`) — un esquema rechazado simplemente no genera
 * anotación y se avisa. Los enlaces internos `#titulo` se resuelven contra
 * los títulos del documento y se emiten con `addInternalLink` (E-106), con el
 * destino a la altura del título.
 *
 * E-119: los títulos generan los marcadores del PDF (outline, `setOutline`),
 * las imágenes `data:` PNG/JPEG se incrustan (el conversor no descarga ni lee
 * archivos externos) y todo lo que no se puede reproducir fielmente sale en
 * las advertencias (nunca se pierde en silencio).
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
    const { rgbaPorSrc } = await resolverImagenes(ast);
    const dimensiones = new Map([...rgbaPorSrc].map(([src, im]) => [src, { width: im.width, height: im.height }]));
    const { totalPaginas, trazos, barras, imagenes, enlaces, enlacesInternos, titulos, advertencias } = layoutMarkdown(ast, medir, { imagenes: dimensiones });

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
    for (const img of imagenes) {
      const rgba = rgbaPorSrc.get(img.imgId);
      if (rgba) agregar(img.page, { type: 'insertImage', spec: { rgba: rgba.rgba, imgWidth: rgba.width, imgHeight: rgba.height, xPt: img.xPt, yPt: img.yPt, wPt: img.wPt, hPt: img.hPt } });
    }
    for (const t of trazos) {
      agregar(t.page, { type: 'insertText', spec: { xPt: t.xPt, yPt: t.yPt, text: t.text, sizePt: t.sizePt, fontName: t.font, color: t.color } });
    }
    for (const e of enlaces) {
      agregar(e.page, { type: 'addLink', rect: { xPt: e.xPt, yPt: e.yPt, wPt: e.wPt, hPt: e.hPt }, url: e.url });
    }
    for (const [page, ops] of opsPorPagina) this.engine.applyPageOps(doc, page, ops);
    // Enlaces internos (`#titulo`): ya con página y altura de su destino. Van DESPUÉS del lote porque necesitan que todas las páginas existan.
    for (const e of enlacesInternos) {
      this.engine.addInternalLink(doc, e.page, { xPt: e.xPt, yPt: e.yPt, wPt: e.wPt, hPt: e.hPt }, e.destPage, e.destYPt);
    }

    const avisos: Advertencia[] = [...advertencias];
    const outline = construirOutline(titulos);
    if (outline.items.length > 0) {
      try { this.engine.setOutline(doc, outline.items); }
      catch { avisos.push(aproximado('No se pudieron crear los marcadores (outline) del PDF a partir de los títulos.')); }
    }
    if (outline.recortado) avisos.push(aproximado(`El documento tiene más de ${OUTLINE_MAX_NODES} títulos: solo los primeros ${OUTLINE_MAX_NODES} entran en los marcadores del PDF.`));

    const out = this.engine.save(doc);
    this.engine.close(doc);
    // Un enlace o imagen que no se pudo reproducir no se pierde en silencio: el texto se conserva y se avisa (misma política que DOCX).
    return { pdf: out, advertencias: avisos };
  }
}

/** Árbol de marcadores por nivel de título: cada título cuelga del anterior de nivel menor (los saltos de nivel no crean huecos). */
function construirOutline(titulos: TituloColocado[]): { items: OutlineItem[]; recortado: boolean } {
  const raiz: OutlineItem[] = [];
  const pila: { nivel: number; item: OutlineItem; prof: number }[] = [];
  let total = 0;
  for (const t of titulos) {
    if (total >= OUTLINE_MAX_NODES) return { items: raiz, recortado: true };
    while (pila.length > 0 && pila[pila.length - 1]!.nivel >= t.nivel) pila.pop();
    const padre = pila[pila.length - 1];
    const prof = (padre?.prof ?? 0) + 1;
    if (prof > OUTLINE_MAX_DEPTH) continue;
    const item: OutlineItem = { title: t.texto === '' ? '(sin título)' : t.texto, pageIndex: t.page, children: [] };
    (padre ? padre.item.children : raiz).push(item);
    pila.push({ nivel: t.nivel, item, prof });
    total++;
  }
  return { items: raiz, recortado: false };
}

const RE_DATA_IMAGEN = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]*)$/i;
/** Cota de imágenes distintas que se decodifican por documento (cada una puede ser grande). */
const MAX_IMAGENES = 200;

function srcsDeImagenes(bloques: Block[], out: Set<string>): void {
  const enInline = (nodos: Inline[]): void => {
    for (const n of nodos) {
      if (n.type === 'image') { if (n.src.startsWith('data:')) out.add(n.src); }
      else if (n.type === 'strong' || n.type === 'em' || n.type === 'del') enInline(n.children);
      else if (n.type === 'link' && n.children) enInline(n.children);
    }
  };
  for (const b of bloques) {
    if (b.type === 'paragraph') enInline(b.children);
    else if (b.type === 'blockquote') srcsDeImagenes(b.children, out);
  }
}

/**
 * Decodifica las imágenes `data:` PNG/JPEG del documento (las únicas que se incrustan: nunca se descarga ni se lee
 * nada externo). Una que no se pueda decodificar queda fuera del mapa y el maquetador la sustituye por su texto
 * alternativo con un aviso `omitido`.
 */
async function resolverImagenes(ast: Block[]): Promise<{ rgbaPorSrc: Map<string, { rgba: Uint8Array; width: number; height: number }> }> {
  const srcs = new Set<string>();
  srcsDeImagenes(ast, srcs);
  const rgbaPorSrc = new Map<string, { rgba: Uint8Array; width: number; height: number }>();
  for (const src of [...srcs].slice(0, MAX_IMAGENES)) {
    const m = RE_DATA_IMAGEN.exec(src);
    if (!m) continue;
    const b64 = m[2]!.replace(/\s+/g, '');
    if (b64.length > MAX_IMG_BYTES * 1.4) continue;
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { continue; }
    const r = await decodificarImagenDocx(bytes);
    if (r.ok) rgbaPorSrc.set(src, r.imagen);
  }
  return { rgbaPorSrc };
}

