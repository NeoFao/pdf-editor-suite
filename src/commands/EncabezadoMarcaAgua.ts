import type { Command, Ctx } from './Command';
import type { DocHandle, PageOp, PdfEngine } from '../engine/PdfEngine';
import {
  colocarCaja, colocarMarcaCentrada, expandirMacros, hexARgb, MARCA_AGUA, MARCA_ENCABEZADO,
  type CajaEncabezado, type PaginaVisual
} from '../pagina/encabezadoPie';

export interface OpcionesEncabezado {
  cajas: CajaEncabezado[];
  /** Número que recibe la primera página del rango (`<<n>>`). */
  numeroInicial: number;
  /** Índices 0-based de las páginas destino, en orden. */
  paginas: number[];
  fuente: string;
  sizePt: number;
  colorHex: string;
  /** Margen al borde izquierdo/derecho VISUAL, pt. */
  margenHorizPt: number;
  /** Margen al borde superior/inferior VISUAL, pt. */
  margenVertPt: number;
  fecha?: Date;
}

export interface OpcionesMarcaAgua {
  texto: string;
  paginas: number[];
  fuente: string;
  sizePt: number;
  colorHex: string;
  /** 0..1 */
  opacidad: number;
  /** Ángulo VISUAL en grados antihorario (45 = diagonal ascendente). */
  anguloGrados: number;
  /** true = detrás del contenido de la página. */
  detras: boolean;
}

export type Progreso = (hechas: number, total: number) => void;

/** Cada cuántas páginas se cede el hilo al navegador (la UI sigue viva y puede pintar el progreso). */
const PAGINAS_POR_TANDA = 10;
const ceder = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function paginaVisual(engine: PdfEngine, doc: DocHandle, i: number): PaginaVisual {
  // guard-disable-next-line pagegeometry-con-origen: aquí solo se lee el tamaño visual; el origen viene de pageBox en la línea siguiente
  const s = engine.pageSize(doc, i);
  // E-084: el origen de la caja visible (pt de usuario) entra en la conversión visual -> usuario.
  return { anchoPt: s.widthPt, altoPt: s.heightPt, rotation: engine.pageRotation(doc, i), origenPt: engine.pageBox(doc, i).origenPt };
}

/** Lote de operaciones de encabezado/pie de UNA página (para `applyPageOps`, E-037). */
export function opsEncabezado(engine: PdfEngine, doc: DocHandle, pageIndex: number, total: number, k: number, o: OpcionesEncabezado): PageOp[] {
  const p = paginaVisual(engine, doc, pageIndex);
  const color = hexARgb(o.colorHex);
  const ops: PageOp[] = [];
  for (const caja of o.cajas) {
    const texto = expandirMacros(caja.texto, { n: o.numeroInicial + k, total, fecha: o.fecha ?? new Date() });
    if (!texto.trim()) continue;
    const ancho = engine.measureText(o.fuente, o.sizePt, texto);
    const pos = colocarCaja(p, caja, ancho, o.sizePt, o.margenHorizPt, o.margenVertPt);
    ops.push({ type: 'insertText', spec: { xPt: pos.xPt, yPt: pos.yPt, text: texto, sizePt: o.sizePt, fontName: o.fuente, color, giroGrados: pos.giroGrados, marca: MARCA_ENCABEZADO } });
  }
  return ops;
}

/** Operación de marca de agua de UNA página. */
export function opsMarcaAgua(engine: PdfEngine, doc: DocHandle, pageIndex: number, o: OpcionesMarcaAgua): PageOp[] {
  if (!o.texto.trim()) return [];
  const p = paginaVisual(engine, doc, pageIndex);
  const ancho = engine.measureText(o.fuente, o.sizePt, o.texto);
  const pos = colocarMarcaCentrada(p, ancho, o.sizePt, o.anguloGrados);
  return [{
    type: 'insertText',
    spec: {
      xPt: pos.xPt, yPt: pos.yPt, text: o.texto, sizePt: o.sizePt, fontName: o.fuente, color: hexARgb(o.colorHex),
      opacidad: o.opacidad, giroGrados: pos.giroGrados, alFondo: o.detras, marca: MARCA_AGUA
    }
  }];
}

/**
 * Añade encabezado/pie/numeración O una marca de agua a un rango de páginas, TODO
 * vectorial (texto real, buscable) y en un solo paso de deshacer (snapshot).
 *
 * Reaplicar sustituye lo anterior del MISMO tipo en esas páginas (no se apila):
 * antes de insertar se quitan los objetos marcados del mismo tipo. Un lote
 * (`applyPageOps`) por página (E-037) y se cede el hilo cada
 * `PAGINAS_POR_TANDA` páginas informando del progreso.
 */
export class AnadirEncabezadoMarcaCmd implements Command {
  readonly id = 'anadir-encabezado-marca';
  readonly label: string;
  private before: Uint8Array<ArrayBuffer> | null = null;
  /** Objetos de texto insertados en la última ejecución. */
  insertados = 0;

  constructor(
    private readonly tipo: { encabezado: OpcionesEncabezado } | { marca: OpcionesMarcaAgua },
    private readonly alProgreso?: Progreso
  ) {
    this.label = 'encabezado' in tipo ? 'Encabezado y pie' : 'Marca de agua';
  }

  async execute(c: Ctx): Promise<void> {
    this.before = c.engine.save(c.doc);
    this.insertados = 0;
    const total = c.engine.pageCount(c.doc);
    const enc = 'encabezado' in this.tipo ? this.tipo.encabezado : null;
    const marca = 'marca' in this.tipo ? this.tipo.marca : null;
    const paginas = (enc ?? marca)!.paginas.filter((i) => i >= 0 && i < total);
    const valor = enc ? MARCA_ENCABEZADO : MARCA_AGUA;

    for (let k = 0; k < paginas.length; k++) {
      const i = paginas[k]!;
      c.engine.removeMarkedObjects(c.doc, i, valor);
      const ops = enc ? opsEncabezado(c.engine, c.doc, i, total, k, enc) : opsMarcaAgua(c.engine, c.doc, i, marca!);
      if (ops.length > 0) { c.engine.applyPageOps(c.doc, i, ops); this.insertados += ops.length; }
      if ((k + 1) % PAGINAS_POR_TANDA === 0 && k + 1 < paginas.length) {
        this.alProgreso?.(k + 1, paginas.length);
        await ceder();
      }
    }
    this.alProgreso?.(paginas.length, paginas.length);
    c.refresh();
  }

  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}

/**
 * Quita de TODO el documento los encabezados, la numeración y las marcas de agua que
 * añadió este editor (objetos marcados `/Artifact` + `/PDFEditor`); no toca nada más.
 * Deshacer por snapshot.
 */
export class QuitarEncabezadosMarcasCmd implements Command {
  readonly id = 'quitar-encabezados-marcas';
  readonly label = 'Quitar encabezados y marcas de agua';
  private before: Uint8Array<ArrayBuffer> | null = null;
  /** Objetos eliminados en la última ejecución. */
  quitados = 0;

  constructor(private readonly alProgreso?: Progreso) {}

  async execute(c: Ctx): Promise<void> {
    this.before = c.engine.save(c.doc);
    this.quitados = 0;
    const total = c.engine.pageCount(c.doc);
    for (let i = 0; i < total; i++) {
      this.quitados += c.engine.removeMarkedObjects(c.doc, i);
      if ((i + 1) % PAGINAS_POR_TANDA === 0 && i + 1 < total) { this.alProgreso?.(i + 1, total); await ceder(); }
    }
    this.alProgreso?.(total, total);
    c.refresh();
  }

  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
