import type { Command, Ctx } from './Command';

/**
 * Reescribe el texto (`/Contents`) de una anotación de la página. `annotIndex`
 * es el índice entre TODAS las anotaciones de la página. Deshacer restaura el
 * texto anterior (leído al ejecutar), sin recargar el documento.
 */
export class SetNoteTextCmd implements Command {
  readonly id = 'set-note-text';
  readonly label: string;
  private previo: string | null = null;
  constructor(readonly pageIndex: number, readonly annotIndex: number, readonly text: string, label = 'Editar nota') {
    this.label = label;
  }

  execute(c: Ctx): void {
    const actual = c.engine.getComments(c.doc, this.pageIndex).find((n) => n.index === this.annotIndex);
    this.previo = actual ? actual.text : null;
    c.engine.setNoteText(c.doc, this.pageIndex, this.annotIndex, this.text);
    c.refreshPage(this.pageIndex);
  }

  undo(c: Ctx): void {
    if (this.previo === null) return;
    c.engine.setNoteText(c.doc, this.pageIndex, this.annotIndex, this.previo);
    c.refreshPage(this.pageIndex);
  }
}
