/**
 * Quita el fondo casi blanco de una firma subida como imagen (#20 de la
 * tabla de paridad, §9): pone alfa 0 en los píxeles casi blancos (R, G y B
 * por encima de `umbral`) con un borde suave —alfa proporcional en una
 * banda de `BANDA_BORDE` niveles justo por debajo del umbral— para que el
 * trazo de la firma no quede dentado al recortar el fondo a pelo.
 *
 * Pura: no toca el DOM ni el motor, solo transforma un array de píxeles
 * RGBA (no muta la entrada). `umbral` y `BANDA_BORDE` son niveles de 0-255.
 */
export function quitarFondo(rgba: Uint8ClampedArray, umbral = 235): Uint8ClampedArray {
  const BANDA_BORDE = 20; // niveles bajo el umbral donde el alfa se degrada linealmente
  const out = new Uint8ClampedArray(rgba.length);
  out.set(rgba);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i]!, g = out[i + 1]!, b = out[i + 2]!;
    // El canal MÁS oscuro manda: solo cuenta como fondo un píxel casi
    // blanco en los TRES canales a la vez (no basta con que uno lo sea).
    const minCanal = Math.min(r, g, b);
    if (minCanal >= umbral) {
      out[i + 3] = 0;
    } else if (minCanal >= umbral - BANDA_BORDE) {
      // Borde suave: en el umbral, alfa 0; BANDA_BORDE niveles más oscuro, alfa completo (original).
      const t = (umbral - minCanal) / BANDA_BORDE;
      out[i + 3] = Math.round((out[i + 3] ?? 255) * t);
    }
    // Por debajo de la banda (trazo claramente oscuro): alfa original, sin tocar.
  }
  return out;
}
