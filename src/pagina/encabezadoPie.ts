/**
 * Encabezado/pie, numeración y marca de agua: lógica PURA (sin motor ni DOM).
 *
 * UNIDADES. Todo en puntos PDF (pt) salvo que se diga otra cosa. Hay dos marcos:
 *  - VISUAL: la página tal como se VE (con /Rotate aplicado), origen abajo-izquierda,
 *    Y hacia arriba. `anchoPt`x`altoPt` es lo que devuelve `PdfEngine.pageSize` (pdfium
 *    incluye el /Rotate en el ancho y alto de página que devuelve el motor).
 *  - USUARIO: el espacio de contenido del PDF (sin /Rotate), el que usa `insertText`.
 * El paso visual -> usuario lo hace `PageGeometry` (única autoridad de coordenadas).
 * Un texto que se ve derecho en una página con /Rotate = R se escribe en espacio de
 * usuario girado R grados antihorario: R se SUMA al ángulo visual.
 */
import { PageGeometry, type Rotation } from '../coords/PageGeometry';

/** Valores de las macros `<<n>>`, `<<total>>` y `<<fecha>>`. */
export interface ContextoMacros { n: number; total: number; fecha: Date }

/** Fecha local `dd/mm/aaaa`. */
export function formatoFecha(d: Date): string {
  const dos = (v: number): string => String(v).padStart(2, '0');
  return `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Sustituye `<<n>>`, `<<total>>` y `<<fecha>>` (sin distinguir mayúsculas). El resto del texto queda tal cual. */
export function expandirMacros(texto: string, ctx: ContextoMacros): string {
  return texto.replace(/<<\s*(n|total|fecha)\s*>>/gi, (_m, nombre: string) => {
    switch (nombre.toLowerCase()) {
      case 'n': return String(ctx.n);
      case 'total': return String(ctx.total);
      default: return formatoFecha(ctx.fecha);
    }
  });
}

/** `#rrggbb` a [r, g, b] 0-255 (negro si no es válido). */
export function hexARgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export type Alineacion = 'izq' | 'centro' | 'der';
export type Zona = 'arriba' | 'abajo';

/** Una de las seis cajas del diálogo. */
export interface CajaEncabezado { zona: Zona; alineacion: Alineacion; texto: string }

/** Posición de un texto ya resuelta al espacio de usuario del PDF (pt) y giro en grados antihorario. */
export interface TextoColocado { xPt: number; yPt: number; giroGrados: number }

/**
 * Tamaño visual de la página (pt) y su /Rotate. `origenPt` (pt de usuario) es la esquina inferior-izquierda de la
 * caja visible sin girar (E-084); sin él vale (0,0), que es lo que quiere la vista previa del diálogo (dibuja en
 * pt visuales, no en espacio de usuario).
 */
export interface PaginaVisual { anchoPt: number; altoPt: number; rotation: Rotation; origenPt?: { xPt: number; yPt: number } }

/** Ascendente/descendente aproximados de las fuentes estándar, en fracción del cuerpo. */
const ASCENDENTE = 0.72;
const DESCENDENTE = 0.2;

/** Punto VISUAL (origen abajo-izq, pt) a punto de usuario (pt). */
export function visualAUsuario(p: PaginaVisual, vx: number, vy: number): { xPt: number; yPt: number } {
  // Escala 1: px CSS = pt. El tamaño visual -> de usuario lo hace la fábrica (E-053).
  const geo = PageGeometry.desdeTamanoVisual(p.anchoPt, p.altoPt, 1, p.rotation, p.origenPt);
  // visual (Y arriba) -> css (Y abajo, escala 1) -> usuario.
  return geo.cssToPt(vx, p.altoPt - vy);
}

/**
 * Coloca el texto de una caja. `anchoTextoPt` es el ancho medido del texto ya
 * expandido. Márgenes: `margenHorizPt` al borde izq/der VISUAL, `margenVertPt` al
 * borde superior/inferior VISUAL (arriba: hasta lo alto de las mayúsculas; abajo:
 * hasta el pie de los descendentes).
 */
export function colocarCaja(
  p: PaginaVisual,
  caja: Pick<CajaEncabezado, 'zona' | 'alineacion'>,
  anchoTextoPt: number,
  sizePt: number,
  margenHorizPt: number,
  margenVertPt: number
): TextoColocado {
  const vx = caja.alineacion === 'izq' ? margenHorizPt
    : caja.alineacion === 'der' ? p.anchoPt - margenHorizPt - anchoTextoPt
    : (p.anchoPt - anchoTextoPt) / 2;
  const vy = caja.zona === 'arriba' ? p.altoPt - margenVertPt - ASCENDENTE * sizePt : margenVertPt + DESCENDENTE * sizePt;
  const o = visualAUsuario(p, vx, vy);
  return { xPt: o.xPt, yPt: o.yPt, giroGrados: p.rotation };
}

/**
 * Coloca una marca de agua centrada en la página VISUAL y girada `anguloVisualGrados`
 * (antihorario, como se ve). El origen de la línea base se desplaza desde el centro
 * para que el CENTRO del texto (a media altura de las mayúsculas) caiga en el centro.
 */
export function colocarMarcaCentrada(p: PaginaVisual, anchoTextoPt: number, sizePt: number, anguloVisualGrados: number): TextoColocado {
  const t = (anguloVisualGrados * Math.PI) / 180;
  const lx = -anchoTextoPt / 2;
  const ly = -(ASCENDENTE * sizePt) / 2;
  const vx = p.anchoPt / 2 + lx * Math.cos(t) - ly * Math.sin(t);
  const vy = p.altoPt / 2 + lx * Math.sin(t) + ly * Math.cos(t);
  const o = visualAUsuario(p, vx, vy);
  return { xPt: o.xPt, yPt: o.yPt, giroGrados: anguloVisualGrados + p.rotation };
}

/** Valores de `/PDFEditor` con que se marcan los objetos que inserta esta función. */
export const MARCA_ENCABEZADO = 'Encabezado';
export const MARCA_AGUA = 'MarcaAgua';
