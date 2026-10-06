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
  /** `onCambio` se avisa tras ejecutar, registrar, deshacer o rehacer (N8: marca el documento como modificado). */
  constructor(private readonly ctx: Ctx, private readonly onCambio?: () => void) {}

  /** Nombre de la operación larga en curso (E-087), o `null`. Mientras está puesto, `execute`/`undo`/`redo` ajenos no actúan. */
  private operacion: string | null = null;
  /** Se avisa (con el nombre de la operación) cuando se descarta un cambio ajeno por el candado. */
  onBloqueado?: (operacion: string) => void;

  /** E-087: toma el candado de operación en curso; devuelve `liberar` (`null` si ya hay otra: una sola operación larga a la vez). */
  bloquear(nombre: string): (() => void) | null {
    if (this.operacion !== null) return null;
    this.operacion = nombre;
    return () => { if (this.operacion === nombre) this.operacion = null; };
  }

  operacionEnCurso(): string | null { return this.operacion; }

  /** Aplica el comando y lo registra. `propia`: lo lanza la propia operación que tiene el candado (E-087). */
  async execute(cmd: Command, propia = false): Promise<void> {
    if (this.operacion !== null && !propia) { this.onBloqueado?.(this.operacion); return; }
    await cmd.execute(this.ctx);
    this.record(cmd);
    this.onCambio?.();
  }

  /** Registra un comando ya aplicado por fuera (p. ej. la UI validó y aplicó la edición). */
  pushExecuted(cmd: Command): void {
    this.record(cmd);
    this.onCambio?.();
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

  /** Deshace el último comando y devuelve su `label` (`null` si no había nada que deshacer). */
  async undo(): Promise<string | null> {
    if (this.operacion !== null) { this.onBloqueado?.(this.operacion); return null; }
    const cmd = this.undoStack.pop();
    if (!cmd) return null;
    await cmd.undo(this.ctx);
    this.redoStack.push(cmd);
    this.onCambio?.();
    return cmd.label;
  }

  /** Rehace el último comando deshecho y devuelve su `label` (`null` si no había nada que rehacer). */
  async redo(): Promise<string | null> {
    if (this.operacion !== null) { this.onBloqueado?.(this.operacion); return null; }
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    await cmd.execute(this.ctx);
    this.undoStack.push(cmd);
    this.onCambio?.();
    return cmd.label;
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
}
