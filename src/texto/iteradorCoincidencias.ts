/**
 * Lista ordenada de coincidencias de búsqueda con un cursor "actual", para
 * navegar con Siguiente/Anterior como en Acrobat. Pura: sin DOM ni motor.
 *
 * Los resultados llegan por páginas MIENTRAS la búsqueda recorre el documento
 * (E-043: no se espera a la última página), siempre al final de la lista, así
 * que añadir nunca mueve el cursor. Mientras la búsqueda no ha terminado,
 * "siguiente" en la última coincidencia no da la vuelta (podrían llegar más);
 * cuando ha terminado, vuelve a la primera y lo avisa (`vuelta`).
 *
 * Unidades: `rect` está en puntos PDF (origen abajo-izquierda), tal cual lo
 * entrega `PdfEngine.findText`.
 */
import type { RectPt } from '../engine/PdfEngine';

export interface Coincidencia {
  pageIndex: number;
  rect: RectPt;
}

export interface SaltoCoincidencia extends Coincidencia {
  /** true si para llegar aquí se dio la vuelta (de la última a la primera o al revés). */
  vuelta: boolean;
}

export class IteradorCoincidencias {
  private readonly items: Coincidencia[] = [];
  /** Índice 0-based de la coincidencia actual; -1 = ninguna todavía. */
  private cursor = -1;
  private fin = false;

  get total(): number { return this.items.length; }
  /** Posición 1-based de la actual (0 si todavía no hay ninguna). */
  get posicion(): number { return this.cursor + 1; }
  get terminada(): boolean { return this.fin; }

  añadir(pageIndex: number, rects: readonly RectPt[]): void {
    for (const rect of rects) this.items.push({ pageIndex, rect });
  }

  terminar(): void { this.fin = true; }

  actual(): Coincidencia | null {
    return this.cursor >= 0 ? this.items[this.cursor]! : null;
  }

  siguiente(): SaltoCoincidencia | null {
    if (this.items.length === 0) return null;
    if (this.cursor + 1 < this.items.length) {
      this.cursor++;
      return { ...this.items[this.cursor]!, vuelta: false };
    }
    if (!this.fin) return null; // aún pueden llegar resultados más adelante
    this.cursor = 0;
    return { ...this.items[0]!, vuelta: true };
  }

  anterior(): SaltoCoincidencia | null {
    if (this.items.length === 0) return null;
    if (this.cursor > 0) {
      this.cursor--;
      return { ...this.items[this.cursor]!, vuelta: false };
    }
    // Desde la primera (o sin actual): a la última de lo conocido hasta ahora.
    this.cursor = this.items.length - 1;
    return { ...this.items[this.cursor]!, vuelta: true };
  }
}
