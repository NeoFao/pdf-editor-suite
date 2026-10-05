import { type Pt, type CssPx, css, pt } from './units';
import type { RectPt } from '../engine/PdfEngine';

export type Rotation = 0 | 90 | 180 | 270;

export interface CssPoint { x: CssPx; y: CssPx }
export interface PtPoint { xPt: Pt; yPt: Pt }
export interface CssRect { left: CssPx; top: CssPx; width: CssPx; height: CssPx }

/**
 * Única autoridad de conversión de coordenadas. Aplica escala, el volteo del
 * eje Y (PDF tiene el origen abajo-izquierda) y la rotación de página. Ningún
 * otro módulo hace aritmética entre unidades.
 *
 * Bajo rotación 90/270 los ejes se intercambian, por eso la conversión es SIEMPRE
 * por punto (x e y juntos): un `ptToCssX(x)` aislado no está bien definido.
 *
 * CONTRATO (E-053): `widthPt`/`heightPt` son el tamaño de la página SIN girar
 * (espacio de usuario, el de la MediaBox), porque las fórmulas de 90/270 se
 * escriben sobre ese espacio. Lo que devuelve el motor (`engine.pageSize`) es el
 * tamaño VISUAL, ya girado: por eso el constructor es privado y se entra por
 * `PageGeometry.desdeTamanoVisual`, que hace el intercambio en un único sitio.
 */
export class PageGeometry {
  private constructor(
    /** Ancho de la página SIN girar, pt PDF. */
    readonly widthPt: number,
    /** Alto de la página SIN girar, pt PDF. */
    readonly heightPt: number,
    /** px CSS por pt PDF. */
    readonly scale: number,
    readonly rotation: Rotation
  ) {}

  /**
   * Fábrica única. `anchoVisualPt`/`altoVisualPt` es el tamaño con la rotación
   * ya aplicada (pt PDF), tal como lo da `engine.pageSize`; con 90/270 el
   * ancho de usuario es el alto visual y viceversa.
   */
  static desdeTamanoVisual(anchoVisualPt: number, altoVisualPt: number, scale: number, rotation: Rotation): PageGeometry {
    const gira = rotation === 90 || rotation === 270;
    return new PageGeometry(gira ? altoVisualPt : anchoVisualPt, gira ? anchoVisualPt : altoVisualPt, scale, rotation);
  }

  /** Punto PDF (origen abajo-izq, Y arriba) → punto CSS (origen arriba-izq, Y abajo). */
  ptToCss(xPt: number, yPt: number): CssPoint {
    const s = this.scale, W = this.widthPt, H = this.heightPt;
    switch (this.rotation) {
      case 0:   return { x: css(xPt * s), y: css((H - yPt) * s) };
      case 90:  return { x: css(yPt * s), y: css(xPt * s) };
      case 180: return { x: css((W - xPt) * s), y: css(yPt * s) };
      case 270: return { x: css((H - yPt) * s), y: css((W - xPt) * s) };
    }
  }

  /** Inverso de ptToCss. */
  cssToPt(x: number, y: number): PtPoint {
    const s = this.scale, W = this.widthPt, H = this.heightPt;
    switch (this.rotation) {
      case 0:   return { xPt: pt(x / s), yPt: pt(H - y / s) };
      case 90:  return { xPt: pt(y / s), yPt: pt(x / s) };
      case 180: return { xPt: pt(W - x / s), yPt: pt(y / s) };
      case 270: return { xPt: pt(W - y / s), yPt: pt(H - x / s) };
    }
  }

  /** Caja PDF (origen abajo-izq) → caja CSS (origen arriba-izq), robusta a rotación. */
  rectPtToCss(r: RectPt): CssRect {
    const a = this.ptToCss(r.xPt, r.yPt);                 // esquina inferior-izq
    const b = this.ptToCss(r.xPt + r.wPt, r.yPt + r.hPt); // esquina superior-der
    return {
      left: css(Math.min(a.x, b.x)),
      top: css(Math.min(a.y, b.y)),
      width: css(Math.abs(b.x - a.x)),
      height: css(Math.abs(b.y - a.y))
    };
  }
}
