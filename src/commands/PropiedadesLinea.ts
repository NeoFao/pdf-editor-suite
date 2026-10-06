import type { LineaParaEditar } from '../engine/PdfEngine';
import type { Command, Ctx } from './Command';

/** Lo que el panel de propiedades puede cambiar en una línea compuesta (N1 F4). */
export interface PropiedadesLinea {
  /** RGB 0-255. */
  color?: [number, number, number];
  /** Factor nuevo/actual del tamaño efectivo (E-080), respecto al origen del primer objeto. */
  escala?: number;
  /** Una de las 14 fuentes estándar. */
  fuenteEstandar?: string;
}

const ETIQUETA = { color: 'Color del texto', escala: 'Tamaño de fuente', fuente: 'Fuente' } as const;

/**
 * Cambia color, tamaño o fuente de una LÍNEA EDITABLE compuesta (varios objetos de texto, típico de Chrome) aplicándolo
 * a todos sus objetos en un solo paso (`engine.setLineProps`: una carga de página, un `GenerateContent`). Deshacer por
 * SNAPSHOT, como `EditarLineaCmd`: el cambio de fuente reescribe objetos y el de tamaño mueve glifos, no basta con
 * «aplicar lo contrario». Una línea de UN objeto no pasa por aquí (siguen `SetColorCmd`, `SetRunFontSizeCmd`, `SetRunFontCmd`).
 *
 * Tras `execute()`: `ok`, `razon` y `lineaRunIdInicial` (primer objeto de la línea, para reapuntar la selección).
 */
export class PropiedadesLineaCmd implements Command {
  readonly id = 'propiedades-linea';
  readonly label: string;
  private before: Uint8Array<ArrayBuffer> | null = null;
  ok = false;
  razon: 'not-a-text-run' | 'invalid-size' | 'invalid-font' | 'glyph-missing' | null = null;
  lineaRunIdInicial: number;

  constructor(readonly pageIndex: number, readonly linea: LineaParaEditar, readonly props: PropiedadesLinea) {
    this.label = props.fuenteEstandar !== undefined ? ETIQUETA.fuente : props.escala !== undefined ? ETIQUETA.escala : ETIQUETA.color;
    this.lineaRunIdInicial = linea.runIds[0] ?? -1;
  }

  execute(c: Ctx): void {
    this.ok = false;
    this.razon = null;
    const antes = c.engine.save(c.doc);
    const res = c.engine.setLineProps(c.doc, this.pageIndex, this.linea, this.props);
    if (!res.ok) { this.razon = res.reason; return; }
    this.before = antes;
    this.ok = true;
    this.lineaRunIdInicial = res.lineaRunIdInicial;
    c.refreshPage(this.pageIndex);
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
