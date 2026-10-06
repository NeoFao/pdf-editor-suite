import { test, expect } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { OcrPageCmd } from '../../src/commands/OcrPage';
import { PageGeometry } from '../../src/coords/PageGeometry';
import type { OcrProvider, OcrImage, OcrLine } from '../../src/ocr/OcrProvider';

/**
 * E-089: el OCR ignoraba `/Rotate`. Se reconoce sobre el render YA girado (lo que ve el usuario), así que las cajas del OCR
 * están en px de ESE bitmap (origen arriba-izq, escala `scale`); el texto invisible tiene que caer sobre las mismas palabras
 * en la página girada, seleccionable y buscable en su sitio. Proveedor FALSO: devuelve cajas conocidas en px del bitmap visual.
 */
class OcrFalso implements OcrProvider {
  imagen: { width: number; height: number } | null = null;
  constructor(private readonly lineas: OcrLine[]) {}
  async recognize(img: OcrImage): Promise<OcrLine[]> { this.imagen = { width: img.width, height: img.height }; return this.lineas; }
}

const SCALE = 2;
// Cajas en px del bitmap visual (origen arriba-izq): dos líneas distintas, lejos de los bordes.
const LINEAS: OcrLine[] = [
  { text: 'ALFA', bbox: { x0: 100, y0: 120, x1: 260, y1: 160 } },
  { text: 'OMEGA', bbox: { x0: 300, y0: 400, x1: 460, y1: 440 } }
];

for (const rotacion of [0, 90, 180, 270] as const) {
  for (const conCrop of [false, true]) {
    test(`/Rotate ${rotacion}${conCrop ? ' + CropBox desplazada' : ''}: el texto invisible cae sobre las cajas del OCR`, async () => {
      const d = await PDFDocument.create();
      const p = d.addPage([400, 600]);
      p.setRotation(degrees(rotacion));
      if (conCrop) p.setCropBox(30, 50, 340, 500);
      const engine = await PdfiumEngine.create();
      const s = await EditSession.open(engine, await d.save());
      const fake = new OcrFalso(LINEAS);
      const cmd = new OcrPageCmd(0, fake, 'eng', SCALE);
      await cmd.execute(s);
      expect(cmd.recognized).toBe(2);

      const pg = s.model.pages[0]!;
      const geo = PageGeometry.desdePagina(pg, 1); // px CSS = pt visuales
      // El bitmap que vio el OCR es la página visual a la escala pedida.
      expect(fake.imagen!.width).toBe(Math.round(pg.sizePt.widthPt * SCALE));
      expect(fake.imagen!.height).toBe(Math.round(pg.sizePt.heightPt * SCALE));

      for (const l of LINEAS) {
        const hit = engine.findText(s.doc, 0, l.text);
        expect(hit, l.text).toHaveLength(1);
        const r = geo.rectPtToCss(hit[0]!); // px CSS de la página visual, origen arriba-izq
        const esperado = { x0: l.bbox.x0 / SCALE, y0: l.bbox.y0 / SCALE, y1: l.bbox.y1 / SCALE };
        expect(Math.abs(r.left - esperado.x0), `${l.text} izquierda`).toBeLessThan(2);
        expect(r.top, `${l.text} arriba`).toBeGreaterThanOrEqual(esperado.y0 - 3);
        expect(r.top + r.height, `${l.text} abajo`).toBeLessThanOrEqual(esperado.y1 + 3);
        expect(r.width, `${l.text} es horizontal en la página visual`).toBeGreaterThan(r.height);
      }
    });
  }
}
