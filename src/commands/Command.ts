import type { PdfEngine, DocHandle } from '../engine/PdfEngine';
import type { DocumentModel } from '../model/DocumentModel';

/**
 * Contexto que reciben los comandos. Lo cumple EditSession: expone el motor, el
 * documento actual (cambia tras un reload), el modelo, y las operaciones de
 * recarga por snapshot (reload) y de reconstrucción del modelo (refresh).
 */
export interface Ctx {
  readonly engine: PdfEngine;
  readonly doc: DocHandle;
  readonly model: DocumentModel;
  reload(bytes: Uint8Array): Promise<void>;
  /** Reconstruye TODAS las páginas del modelo (perezoso en texto) — solo para comandos que cambian el CONJUNTO de páginas (borrar/mover/duplicar/insertar). */
  refresh(): void;
  /** Reconstruye SOLO `pageIndex` (tamaño, rotación, texto) — para comandos que tocan una única página existente (E-043/E-044, docs/ERRORES-CONOCIDOS.md). */
  refreshPage(pageIndex: number): void;
  /** Avisa a la UI de que el árbol de marcadores cambió (no toca páginas ni miniaturas). */
  refreshOutline(): void;
}

export interface Command {
  readonly id: string;
  readonly label: string;
  readonly coalesceKey?: string;
  execute(c: Ctx): void | Promise<void>;
  undo(c: Ctx): void | Promise<void>;
  /** Si comparte coalesceKey con el comando previo, devuelve el comando fusionado (o null). */
  coalesce?(prev: Command): Command | null;
}

/** Ejecuta comandos y mantiene las pilas de deshacer/rehacer. */
export class CommandBus {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  constructor(private readonly ctx: Ctx) {}

  /** Aplica el comando y lo registra. */
  async execute(cmd: Command): Promise<void> {
    await cmd.execute(this.ctx);
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

  async undo(): Promise<void> {
    const cmd = this.undoStack.pop();
    if (!cmd) return;
    await cmd.undo(this.ctx);
    this.redoStack.push(cmd);
  }

  async redo(): Promise<void> {
    const cmd = this.redoStack.pop();
    if (!cmd) return;
    await cmd.execute(this.ctx);
    this.undoStack.push(cmd);
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
}
