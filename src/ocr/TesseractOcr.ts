import { createWorker } from 'tesseract.js';
import type { OcrImage, OcrLine, OcrProvider } from './OcrProvider';
import { tesseractDataToLines } from './tesseractLines';

/**
 * Implementación de `OcrProvider` con tesseract.js. Vuelca el bitmap RGBA en
 * un `<canvas>` (tesseract.js reconoce sobre canvas/imagen) y recorre el
 * resultado con `tesseractDataToLines`. Usa las rutas por defecto de
 * tesseract.js: descarga el núcleo y el idioma de su CDN la primera vez; el
 * PDF en sí nunca sale del equipo del usuario, solo el bitmap ya rasterizado
 * se procesa localmente en el worker.
 */
export class TesseractOcr implements OcrProvider {
  async recognize(img: OcrImage, lang: string): Promise<OcrLine[]> {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo obtener el contexto 2D del canvas para OCR.');
    const imageData = new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height);
    ctx.putImageData(imageData, 0, 0);

    const worker = await createWorker(lang);
    try {
      const r = await worker.recognize(canvas, {}, { blocks: true });
      return tesseractDataToLines(r.data);
    } finally {
      await worker.terminate();
    }
  }
}
