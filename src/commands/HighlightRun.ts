import type { Command, Ctx } from './Command';
import type { RectPt } from '../engine/PdfEngine';

/** Resalta una región (rectángulo de color); deshacer por snapshot. */
export class HighlightRunCmd implements Command {
  readonly id = 'highlight-run';
  readonly label = 'Resaltar';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number, readonly rect: RectPt, readonly color: [number, number, number] = [255, 235, 0]) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.highlightRect(c.doc, this.pageIndex, this.rect, this.color);
    c.refreshPage(this.pageIndex);
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
