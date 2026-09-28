import type { Command, Ctx } from './Command';
import type { OcrProvider } from '../ocr/OcrProvider';
import { mapOcrLines } from '../ocr/mapOcrLines';

/**
 * Hace buscable una página escaneada: reconoce su texto con `provider` y lo
 * inserta como texto invisible (no cambia el aspecto). Deshacer por snapshot,
 * igual que InsertImageCmd/HighlightRunCmd.
 */
export class OcrPageCmd implements Command {
  readonly id = 'ocr-page';
  readonly label = 'Reconocer texto (OCR)';
  private before: Uint8Array<ArrayBuffer> | null = null;
  /** Número de líneas insertadas en la última ejecución. */
  recognized = 0;

  constructor(
    readonly pageIndex: number,
    readonly provider: OcrProvider,
    readonly lang = 'spa+eng',
    readonly scale = 2
  ) {}

  async execute(c: Ctx): Promise<void> {
    this.before = c.engine.save(c.doc);
    const { width, height, data } = c.engine.renderPage(c.doc, this.pageIndex, this.scale);
    const lines = await this.provider.recognize({ rgba: new Uint8Array(data), width, height }, this.lang);
    const heightPt = c.engine.pageSize(c.doc, this.pageIndex).heightPt;
    const specs = mapOcrLines(lines, this.scale, heightPt);
    for (const spec of specs) {
      c.engine.insertText(c.doc, this.pageIndex, spec);
    }
    this.recognized = specs.length;
    c.refresh();
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
