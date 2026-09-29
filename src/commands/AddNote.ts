import type { Command, Ctx } from './Command';

/** Añade una nota adhesiva (anotación Text real) en (xPt, yPt); deshacer por snapshot. */
export class AddNoteCmd implements Command {
  readonly id = 'add-note';
  readonly label = 'Nota';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number, readonly xPt: number, readonly yPt: number, readonly text: string) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.addNote(c.doc, this.pageIndex, { xPt: this.xPt, yPt: this.yPt, text: this.text });
    c.refreshPage(this.pageIndex);
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
