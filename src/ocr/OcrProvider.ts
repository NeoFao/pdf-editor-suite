/**
 * Abstracción de reconocimiento óptico de caracteres. No depende del motor PDF:
 * recibe un bitmap ya decodificado y devuelve líneas de texto con su caja en
 * píxeles de esa imagen. La implementación real (Tesseract u otra) vive fuera
 * de este núcleo; aquí solo se define el contrato y el mapeo a coordenadas PDF.
 */

/** Bitmap RGBA a reconocer. */
export interface OcrImage {
  rgba: Uint8Array;
  width: number;
  height: number;
}

/** Línea reconocida, con su caja en píxeles de la imagen (origen arriba-izquierda). */
export interface OcrLine {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrProvider {
  recognize(img: OcrImage, lang: string): Promise<OcrLine[]>;
}
