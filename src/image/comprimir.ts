/**
 * Plan de compresión (fila #29 de la tabla de paridad, §9): función PURA que
 * decide, para cada objeto imagen del documento, si hay que reescalarlo (su
 * resolución efectiva supera `dpiMax`) y a qué tamaño en píxeles — sin tocar
 * el motor ni el DOM, para poder testearla en Node. La codificación JPEG en
 * sí (que sí necesita el navegador) vive en
 * `src/ui/adaptadorImagenNavegador.ts`; `src/commands/ComprimirDocumento.ts`
 * une las dos cosas.
 */

/** Datos de una imagen del documento, en las unidades que ya expone el motor. */
export interface ImagenParaComprimir {
  objIndex: number;
  widthPx: number;
  heightPx: number;
  /** Tamaño en la página, en puntos PDF (1/72 in) — de `listImageObjects().rectPt`. */
  wPt: number;
  hPt: number;
  /** Si la imagen tiene transparencia real (algún píxel con alfa < 255). */
  tieneAlfa: boolean;
}

export interface OpcionesCompresion {
  /** Calidad JPEG, 0.1-0.95 (coincide con el rango del slider de la UI /100). */
  calidad: number;
  /** DPI efectivo máximo permitido antes de reescalar. */
  dpiMax: number;
}

export interface PlanCompresionItem {
  objIndex: number;
  /** DPI efectivo actual = max(anchoPx/anchoIn, altoPx/altoIn). */
  dpiEfectivo: number;
  /** Si supera `dpiMax` y por tanto hay que reescalar antes de recodificar. */
  reescalar: boolean;
  targetWidthPx: number;
  targetHeightPx: number;
  tieneAlfa: boolean;
}

/**
 * Calcula, para cada imagen, su DPI efectivo (píxeles / (tamaño en la página
 * en pt / 72)) y, si supera `dpiMax`, las dimensiones objetivo que lo dejan
 * exactamente en `dpiMax` (redondeadas, mínimo 1 px). Si el ancho y el alto
 * no son proporcionales entre sí (imagen ya deformada en la página), manda
 * el DPI más alto de los dos ejes — así ningún eje queda por encima del
 * límite tras reescalar.
 */
export function planDeCompresion(imgs: ImagenParaComprimir[], opciones: OpcionesCompresion): PlanCompresionItem[] {
  return imgs.map((img) => {
    const anchoIn = img.wPt / 72;
    const altoIn = img.hPt / 72;
    const dpiX = anchoIn > 0 ? img.widthPx / anchoIn : 0;
    const dpiY = altoIn > 0 ? img.heightPx / altoIn : 0;
    const dpiEfectivo = Math.max(dpiX, dpiY);
    const reescalar = dpiEfectivo > opciones.dpiMax;
    const factor = reescalar && dpiEfectivo > 0 ? opciones.dpiMax / dpiEfectivo : 1;
    return {
      objIndex: img.objIndex,
      dpiEfectivo,
      reescalar,
      targetWidthPx: reescalar ? Math.max(1, Math.round(img.widthPx * factor)) : img.widthPx,
      targetHeightPx: reescalar ? Math.max(1, Math.round(img.heightPx * factor)) : img.heightPx,
      tieneAlfa: img.tieneAlfa
    };
  });
}

/** Si algún píxel del RGBA no es totalmente opaco (alfa < 255). */
export function tieneCanalAlfa(rgba: Uint8Array | Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] !== 255) return true;
  }
  return false;
}
