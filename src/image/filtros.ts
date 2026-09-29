/**
 * Filtros de imagen puros (fila #25 de la tabla de paridad, §9). A diferencia
 * de la app vieja (`js/app.js`, `applyFilterToCurrentPage`), que rasteriza la
 * PÁGINA entera y pinta el filtro sobre ese canvas, estas funciones operan
 * solo sobre los píxeles RGBA de un objeto imagen del PDF: el texto y los
 * vectores de la página nunca se tocan (siguen seleccionables y nítidos).
 *
 * Puras: no tocan el DOM ni el motor, no mutan la entrada, conservan el canal
 * alfa. `src/commands/FiltrarPagina.ts` las aplica sobre cada imagen de una
 * página vía `PdfEngine.getImagePixels`/`replaceImagePixels`.
 */

/** Luminancia ITU-R BT.601 (misma fórmula que usaba `js/app.js`). */
function luminancia(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Escala de grises: cada canal pasa a valer la luminancia del píxel. Alfa intacto. */
export function escalaDeGrises(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const gray = Math.round(luminancia(out[i]!, out[i + 1]!, out[i + 2]!));
    out[i] = gray; out[i + 1] = gray; out[i + 2] = gray;
  }
  return out;
}

/**
 * Umbral de Otsu sobre el histograma de luminancia (256 niveles): el que
 * maximiza la varianza ENTRE las dos clases (fondo/trazo) que resultarían de
 * partir por ese nivel — el método estándar, no un valor fijo a ojo (a
 * diferencia de la app vieja, que usaba 145 fijo para B/N).
 */
export function otsuThreshold(rgba: Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0);
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const gray = Math.round(luminancia(rgba[i]!, rgba[i + 1]!, rgba[i + 2]!));
    hist[Math.min(255, Math.max(0, gray))]!++;
    total++;
  }
  if (total === 0) return 128;

  let sumaTotal = 0;
  for (let t = 0; t < 256; t++) sumaTotal += t * hist[t]!;

  let pesoFondo = 0;
  let sumaFondo = 0;
  let varianzaMax = -1;
  let umbral = 0;
  for (let t = 0; t < 256; t++) {
    pesoFondo += hist[t]!;
    if (pesoFondo === 0) continue;
    const pesoTrazo = total - pesoFondo;
    if (pesoTrazo === 0) break;
    sumaFondo += t * hist[t]!;
    const mediaFondo = sumaFondo / pesoFondo;
    const mediaTrazo = (sumaTotal - sumaFondo) / pesoTrazo;
    const varianzaEntre = pesoFondo * pesoTrazo * (mediaFondo - mediaTrazo) * (mediaFondo - mediaTrazo);
    if (varianzaEntre > varianzaMax) { varianzaMax = varianzaEntre; umbral = t; }
  }
  return umbral;
}

/**
 * Blanco y negro binario: cada píxel se convierte en negro o blanco puro
 * según su luminancia supere o no `umbral`. Por defecto calcula el umbral de
 * Otsu de la propia imagen; se puede fijar un nivel 0-255 explícito. Alfa
 * intacto.
 */
export function blancoYNegro(rgba: Uint8ClampedArray, umbral: 'otsu' | number = 'otsu'): Uint8ClampedArray {
  const t = umbral === 'otsu' ? otsuThreshold(rgba) : umbral;
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const val = luminancia(out[i]!, out[i + 1]!, out[i + 2]!) > t ? 255 : 0;
    out[i] = val; out[i + 1] = val; out[i + 2] = val;
  }
  return out;
}

/**
 * "Color mágico": realce de contraste para documentos escaneados (estilo
 * CamScanner, igual intención que la app vieja pero con un cálculo real en
 * vez de un boost/oscurecido lineal a ojo). Estira el contraste por los
 * percentiles 2-98 de la luminancia de la propia imagen: el nivel del
 * percentil 2 pasa a 0 y el del percentil 98 pasa a 255, con el resto
 * interpolado linealmente (y recortado a 0-255) — así el fondo del papel
 * (cerca del percentil alto) se aclara hacia blanco y la tinta (percentil
 * bajo) se oscurece hacia negro, sin depender de un umbral fijo. Se aplica el
 * MISMO desplazamiento/escala a los tres canales (derivados de la
 * luminancia, no percentiles por canal) para no desviar el balance de color.
 * Alfa intacto.
 */
export function colorMagico(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const n = rgba.length / 4;
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  if (n === 0) return out;

  const luminancias = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    luminancias[i] = luminancia(rgba[p]!, rgba[p + 1]!, rgba[p + 2]!);
  }
  const ordenadas = Float64Array.from(luminancias).sort();
  const percentil = (pct: number): number => {
    const idx = Math.min(ordenadas.length - 1, Math.max(0, Math.floor((pct / 100) * (ordenadas.length - 1))));
    return ordenadas[idx]!;
  };
  const p2 = percentil(2);
  const p98 = percentil(98);
  const rango = Math.max(1, p98 - p2); // evita división por 0 si la imagen es plana

  for (let i = 0; i < n; i++) {
    const p = i * 4;
    out[p] = Math.round(((out[p]! - p2) * 255) / rango);
    out[p + 1] = Math.round(((out[p + 1]! - p2) * 255) / rango);
    out[p + 2] = Math.round(((out[p + 2]! - p2) * 255) / rango);
  }
  return out;
}
