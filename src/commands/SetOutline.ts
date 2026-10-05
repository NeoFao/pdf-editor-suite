import type { Command, Ctx } from './Command';
import type { OutlineItem } from '../engine/PdfEngine';

/**
 * Cambia el árbol de marcadores. Guarda el árbol ANTERIOR y el NUEVO enteros
 * (el outline es pequeño y `setOutline` lo reescribe completo): deshacer =
 * reescribir el anterior, sin snapshot de todo el PDF. Cubre crear, renombrar,
 * borrar, mover, sangrar y cambiar destino — la UI calcula el árbol nuevo con
 * las funciones puras de `src/outline/arbol.ts`.
 */
export class SetOutlineCmd implements Command {
  readonly id = 'set-outline';
  constructor(
    private readonly antes: OutlineItem[],
    private readonly despues: OutlineItem[],
    readonly label: string
  ) {}

  execute(c: Ctx): void { c.engine.setOutline(c.doc, this.despues); c.refreshOutline(); }
  undo(c: Ctx): void { c.engine.setOutline(c.doc, this.antes); c.refreshOutline(); }
}
