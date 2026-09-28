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
