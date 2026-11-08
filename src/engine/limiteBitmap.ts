/**
 * Tope ABSOLUTO del bitmap de una página (E-129, A-2/A-3 del QA de funciones).
 *
 * Antes solo `factorNitidez` (E-078) acotaba los píxeles, y solo el FACTOR de DPR, que nunca baja de 1: a escala 1 una
 * página de 14400x14400 pt pedía 207 Mpx (830 MB RGBA), 18-23 s de hilo bloqueado, y un MediaBox de 1e9 pedía un
 * `Uint8ClampedArray` de 4e18 bytes («Invalid typed array length»). El tope vive aquí, en una función pura que usa el
 * motor (`PdfiumEngine.renderPage`, el punto único por el que pasan visor, miniaturas y OCR), de modo que ningún
 * llamador puede saltárselo.
 *
 * Solo acota la RESOLUCIÓN del bitmap. Las coordenadas (`PageGeometry`, `sizePt`, capas de texto) siguen en pt y px CSS
 * exactos: el llamador pone el canvas a su tamaño CSS por separado (`canvas.style.width/height`), así que un bitmap
 * reducido se estira a la misma caja y la capa de texto no se desalinea.
 *
 * Unidades: `escala` = px de bitmap por pt de usuario; `wPt`/`hPt` = pt de usuario.
 */

/**
 * Píxeles máximos de un bitmap de página: 8 Mpx = 32 MB RGBA. Es el MISMO límite que ya usaba la nitidez (E-078,
 * `MAX_PIXELES_PAGINA`; con el tope de 12 páginas pintadas de E-045 el peor caso son ~384 MB), ahora aplicado también a
 * escalas < 1/DPR y a todos los caminos de render.
 */
export const MAX_PIXELES_BITMAP = 8_000_000;

/**
 * Lado máximo de un bitmap (px). Chromium/Firefox admiten 32767 y Safari 16384 por lado: se usa el menor para que una
 * página muy alargada no pase de largo por área y reviente el canvas.
 */
export const MAX_LADO_BITMAP = 16384;

/** Lado máximo de una página válida en unidades de usuario con `/UserUnit` 1 (límite de la especificación PDF/Acrobat: 200 in). */
export const MAX_LADO_PAGINA_PT = 14400;

/** Margen para que el redondeo a píxeles enteros del llamador no rebase el tope. */
const MARGEN = 0.999;

/**
 * Escala efectiva para renderizar `wPt` x `hPt` pt a `escala`: la pedida si el bitmap cabe en `MAX_PIXELES_BITMAP` y
 * `MAX_LADO_BITMAP`, o la mayor que cabe. `reducida` indica que se bajó la resolución pedida. Una escala no válida (NaN,
 * ≤ 0) se trata como 1; un tamaño no válido no se puede acotar y devuelve la escala tal cual (el llamador lo valida
 * antes con `tamanoPaginaValido`).
 */
export function escalaAcotada(wPt: number, hPt: number, escala: number): { escala: number; reducida: boolean } {
  const s = Number.isFinite(escala) && escala > 0 ? escala : 1;
  if (!(Number.isFinite(wPt) && wPt > 0 && Number.isFinite(hPt) && hPt > 0)) return { escala: s, reducida: false };
  let f = 1;
  const px = wPt * s * hPt * s;
  if (px > MAX_PIXELES_BITMAP) f = Math.min(f, Math.sqrt(MAX_PIXELES_BITMAP / px) * MARGEN);
  const lado = Math.max(wPt, hPt) * s;
  if (lado > MAX_LADO_BITMAP) f = Math.min(f, (MAX_LADO_BITMAP / lado) * MARGEN);
  return f < 1 ? { escala: s * f, reducida: true } : { escala: s, reducida: false };
}

/**
 * ¿Es el tamaño de página mostrable? Finito, > 0 y ≤ 14400 pt × `/UserUnit` por lado (un `MediaBox` de 1e9, NaN o
 * negativo no es una página, es un fichero corrupto o hostil). `userUnit` no válido cuenta como 1.
 */
export function tamanoPaginaValido(wPt: number, hPt: number, userUnit: number): boolean {
  const uu = Number.isFinite(userUnit) && userUnit > 0 ? userUnit : 1;
  const max = MAX_LADO_PAGINA_PT * uu;
  return Number.isFinite(wPt) && Number.isFinite(hPt) && wPt > 0 && hPt > 0 && wPt <= max && hPt <= max;
}

/** Tamaño con el que se MUESTRA una página de tamaño no válido (A4, pt): el aviso de error ocupa esa caja. */
export const TAMANO_PAGINA_SUSTITUTO = { widthPt: 595, heightPt: 842 } as const;
