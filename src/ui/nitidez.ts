/**
 * Nitidez del bitmap de página (N3, E-078): la página se pinta a `escala × factor` px de bitmap por pt, con el CSS
 * al tamaño de siempre (`escala` px CSS por pt), para que en pantallas de alta densidad (retina, móviles) un
 * píxel CSS use `factor` píxeles físicos y el texto no salga borroso.
 *
 * Unidades: `cssAncho`/`cssAlto` son px CSS de la página a la escala actual; el factor es px de bitmap por px CSS.
 */

/** Tope del factor (DPR 3 de un móvil gasta 2,25x más memoria que 2: 2,5 es nítido sin disparar la RAM). */
export const MAX_DPR_PAGINA = 2.5;

/**
 * Tope de píxeles de bitmap por página (8 Mpx = 32 MB RGBA). El visor mantiene como mucho 12 páginas pintadas
 * (E-045), así que el peor caso son ~384 MB; sin este límite un zoom alto a DPR 2,5 pasaría de 1 GB.
 */
export const MAX_PIXELES_PAGINA = 8_000_000;

/** Factor de bitmap por px CSS: el DPR acotado a `MAX_DPR_PAGINA`, reducido si la página superaría `MAX_PIXELES_PAGINA`, nunca por debajo de 1. */
export function factorNitidez(dpr: number, cssAncho: number, cssAlto: number): number {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  let f = Math.min(d, MAX_DPR_PAGINA);
  const area = Math.max(1, cssAncho * cssAlto);
  if (area * f * f > MAX_PIXELES_PAGINA) f = Math.sqrt(MAX_PIXELES_PAGINA / area);
  return Math.max(1, f);
}
