import { test, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { EditSession } from '../../src/model/EditSession';
import { CommandBus } from '../../src/commands/Command';
import { OcrPageCmd } from '../../src/commands/OcrPage';
import { mapOcrLines } from '../../src/ocr/mapOcrLines';
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
 *
 * La propiedad que protege el defecto NO es "tarda poco" (frágil bajo
 * carga: un umbral en milisegundos dio un falso positivo con la máquina
 * cargada, docs/TESTING.md) sino "UNA sola llamada a applyPageOps con las
 * 80 líneas en lote, no 80 llamadas sueltas". Se comprueba espiando
 * `engine.applyPageOps` — tanto una llamada en lote como 80 llamadas de
 * `insertText` (que delega en `applyPageOps` con un solo op) pasan por ahí,
 * así que el conteo distingue exactamente los dos caminos.
 */
test('E-037: OcrPageCmd con 80 líneas reconocidas (página densa) hace UNA sola llamada a applyPageOps, no 80', async () => {
  const d = await PDFDocument.create();
  d.addPage([600, 900]);
  const engine = await PdfiumEngine.create();
  const s = await EditSession.open(engine, await d.save());
  const bus = new CommandBus(s);
  const fake = new FakeOcrProviderDenso(80);

  const spyApplyPageOps = vi.spyOn(engine, 'applyPageOps');

  const cmd = new OcrPageCmd(0, fake);
  await bus.execute(cmd);

  expect(cmd.recognized).toBe(80);
  expect(s.model.pages[0]!.runs).toHaveLength(80);
  expect(spyApplyPageOps).toHaveBeenCalledTimes(1);
  expect(spyApplyPageOps.mock.calls[0]![2]).toHaveLength(80); // las 80 ops, en UN solo lote
  spyApplyPageOps.mockRestore();

  // Mismo resultado que insertarlas una a una con insertText (E-037,
  // "applyPageOps en lote produce el MISMO contenido que aplicar cada op
  // una a una" ya lo cubre a nivel de motor; aquí se repite a nivel del
  // comando completo, con las líneas que de verdad produce el proveedor de
  // OCR y el mapeo de coordenadas de mapOcrLines).
  const heightPt = engine.pageSize(s.doc, 0).heightPt;
  const lines = await fake.recognize({ rgba: new Uint8Array(0), width: 1, height: 1 }, 'spa+eng');
  const specs = mapOcrLines(lines, 2, heightPt);

  const dRef = await PDFDocument.create();
  dRef.addPage([600, 900]);
  const engineRef = await PdfiumEngine.create();
  const docRef = await engineRef.open(await dRef.save());
  for (const spec of specs) engineRef.insertText(docRef, 0, spec);

  const runsLote = engine.getPageText(s.doc, 0).map((r) => ({ text: r.text, sizePt: Math.round(r.sizePt) }));
  const runsUnoAUno = engineRef.getPageText(docRef, 0).map((r) => ({ text: r.text, sizePt: Math.round(r.sizePt) }));
  expect(runsLote).toEqual(runsUnoAUno);
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
