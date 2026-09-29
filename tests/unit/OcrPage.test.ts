import { test, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { OcrPageCmd } from '../../src/commands/OcrPage';
import type { OcrProvider, OcrImage, OcrLine } from '../../src/ocr/OcrProvider';

class FakeOcrProvider implements OcrProvider {
  async recognize(_img: OcrImage, _lang: string): Promise<OcrLine[]> {
    return [
      { text: 'LINEA UNO', bbox: { x0: 20, y0: 20, x1: 200, y1: 40 } },
      { text: 'LINEA DOS', bbox: { x0: 20, y0: 60, x1: 200, y1: 80 } }
    ];
  }
}

function sinPixelesOscuros(data: Uint8ClampedArray): boolean {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! <= 200 || data[i + 1]! <= 200 || data[i + 2]! <= 200) return false;
  }
  return true;
}

/** Página densa: una imagen escaneada real fácilmente da 50-100 líneas OCR. */
class FakeOcrProviderDenso implements OcrProvider {
  constructor(private readonly n: number) {}
  async recognize(_img: OcrImage, _lang: string): Promise<OcrLine[]> {
    return Array.from({ length: this.n }, (_v, i) => ({
      text: `linea ${i} reconocida por el OCR`,
      bbox: { x0: 20, y0: 20 + i * 10, x1: 400, y1: 30 + i * 10 }
    }));
  }
}

/**
 * E-037 (docs/ERRORES-CONOCIDOS.md): `OcrPageCmd` insertaba cada línea
 * reconocida con un `insertText` suelto — O(N²) por el `GenerateContent` de
 * cada llamada. Ahora usa `applyPageOps` (una sola carga de página, un solo
 * `GenerateContent`). 80 líneas es el caso real de una página densa.
 */
test('E-037: OcrPageCmd con 80 líneas reconocidas (página densa) termina muy rápido', async () => {
  const d = await PDFDocument.create();
  d.addPage([600, 900]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const fake = new FakeOcrProviderDenso(80);

  const t0 = performance.now();
  const cmd = new OcrPageCmd(0, fake);
  await bus.execute(cmd);
  const t1 = performance.now();

  expect(cmd.recognized).toBe(80);
  expect(s.model.pages[0]!.runs).toHaveLength(80);
  // Uno a uno (antes del arreglo), 100 insertText sueltos tardaban ~225 ms y
  // 200 tardaban ~1,3 s (crecimiento claramente superlineal). En lote, 80
  // líneas terminan en unos pocos ms — umbral con holgura amplia para CI.
  expect(t1 - t0).toBeLessThan(500);
});

test('OcrPageCmd inserta texto invisible reconocido y se puede deshacer', async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 200]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const fake = new FakeOcrProvider();

  const cmd = new OcrPageCmd(0, fake);
  await bus.execute(cmd);

  expect(cmd.recognized).toBe(2);
  const textos = s.model.pages[0]!.runs.map((r) => r.text);
  expect(textos.some((t) => t.includes('LINEA UNO'))).toBe(true);
  expect(textos.some((t) => t.includes('LINEA DOS'))).toBe(true);

  // Sigue sin verse: el texto insertado es invisible.
  expect(sinPixelesOscuros(s.engine.renderPage(s.doc, 0, 1).data)).toBe(true);

  await bus.undo();

  const textosTrasDeshacer = s.model.pages[0]!.runs.map((r) => r.text);
  expect(textosTrasDeshacer.some((t) => t.includes('LINEA UNO'))).toBe(false);
  expect(textosTrasDeshacer.some((t) => t.includes('LINEA DOS'))).toBe(false);
});
