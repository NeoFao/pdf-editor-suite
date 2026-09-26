import type { PdfEngine, DocHandle } from '../engine/PdfEngine';
import type { DocumentModel } from '../model/DocumentModel';

export interface Ctx { engine: PdfEngine; model: DocumentModel; doc: DocHandle }

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly coalesceKey?: string;
  execute(c: Ctx): void;
  undo(c: Ctx): void;
  /** Si comparte coalesceKey con el comando previo, devuelve el comando fusionado (o null). */
  coalesce?(prev: Command): Command | null;
}

/** Ejecuta comandos y mantiene las pilas de deshacer/rehacer. */
export class CommandBus {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  constructor(private readonly ctx: Ctx) {}

  /** Aplica el comando y lo registra. */
  execute(cmd: Command): void {
    cmd.execute(this.ctx);
    this.record(cmd);
  }

  /** Registra un comando ya aplicado por fuera (p. ej. la UI validó y aplicó la edición). */
  pushExecuted(cmd: Command): void {
    this.record(cmd);
  }

  private record(cmd: Command): void {
    const prev = this.undoStack[this.undoStack.length - 1];
    if (cmd.coalesceKey && prev && prev.coalesceKey === cmd.coalesceKey && cmd.coalesce) {
      const merged = cmd.coalesce(prev);
      if (merged) {
        this.undoStack[this.undoStack.length - 1] = merged;
        this.redoStack = [];
        return;
      }
    }
    this.undoStack.push(cmd);
    this.redoStack = [];
  }

  undo(): void {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    cmd.undo(this.ctx);
    this.redoStack.push(cmd);
  }

  redo(): void {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    cmd.execute(this.ctx);
    this.undoStack.push(cmd);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
}
