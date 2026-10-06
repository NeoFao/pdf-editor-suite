import type { LineaParaEditar } from '../engine/PdfEngine';
import { agruparLineasEditables } from '../texto/lineasEditables';
import type { Command, Ctx } from './Command';

/**
 * Un tramo de texto a reescribir. `runId` es el índice del objeto de texto en la página `pageIndex`.
 * Con `linea` (N1 F4) el cambio es sobre una LÍNEA EDITABLE: `runId` es su primer objeto, `oldText` su texto
 * (`linea.text`) y se escribe con `engine.editLine` (diff mínimo, conserva los estilos de los tramos no tocados).
 */
export interface CambioTexto {
  pageIndex: number;
  runId: number;
  oldText: string;
  newText: string;
  linea?: LineaParaEditar;
}

export interface ResumenReemplazo {
  /** Runs reescritos en su propia fuente (`editTextRun`). */
  editados: number;
  /** Runs que necesitaron fuente estándar porque a la original le faltaban glifos. */
  sustituidos: number;
  /** Runs que no se pudieron cambiar ni así (quedan intactos). */
  fallidos: number;
  /** Fuentes estándar usadas en las sustituciones. */
  fuentes: string[];
}

export interface OpcionesReemplazo {
  /** Se llama tras cada tanda con (páginas procesadas, páginas totales con cambios). */
  onProgress?: (hechas: number, total: number) => void;
  /** Cede el hilo al bucle de eventos entre tandas (E-043). Sin él, no cede. */
  ceder?: () => Promise<void>;
  /** Páginas por tanda antes de ceder el hilo. */
  paginasPorTanda?: number;
}

/**
 * Reemplazo de texto en varios runs (uno o muchos, de una o varias páginas)
 * como UN SOLO paso de deshacer. Sirve para "Reemplazar" (1 cambio) y
 * "Reemplazar todo" (N cambios en todo el documento).
 *
 * Cada run se reescribe con `editTextRun` (conserva fuente, tamaño, color y
 * posición). Si a su fuente le faltan glifos, el mismo camino que la edición
 * normal (`handleEdit`/`ReplaceRunFontCmd`): `replaceRunWithStandardFont`.
 *
 * Orden: por página ascendente y, dentro de cada página, por `runId`
 * DESCENDENTE — la sustitución de fuente elimina el objeto y añade uno nuevo
 * al final, desplazando los índices posteriores; yendo de mayor a menor, los
 * runs aún pendientes nunca se mueven. Tras cada página se hace UN
 * `refreshPage` (E-044), no un `refresh()` del documento entero.
 *
 * Deshacer: si todo fue en sitio, se re-edita cada run al texto original
 * (barato, página a página). Si hubo alguna sustitución de fuente (cambia la
 * estructura de la página) se recarga el snapshot previo.
 */
export class ReemplazarTextoCmd implements Command {
  readonly id = 'reemplazar-texto';
  private before: Uint8Array<ArrayBuffer> | null = null;
  private usoSustitucion = false;
  private aplicados: CambioTexto[] = [];
  /** Cambios que no se pudieron aplicar (el run quedó intacto), tras `execute()`. */
  fallidosCambios: CambioTexto[] = [];
  resumen: ResumenReemplazo = { editados: 0, sustituidos: 0, fallidos: 0, fuentes: [] };

  constructor(
    readonly cambios: readonly CambioTexto[],
    readonly label: string,
    private readonly opts: OpcionesReemplazo = {}
  ) {}

  private porPagina(cambios: readonly CambioTexto[]): [number, CambioTexto[]][] {
    const m = new Map<number, CambioTexto[]>();
    for (const c of cambios) {
      let l = m.get(c.pageIndex);
      if (!l) { l = []; m.set(c.pageIndex, l); }
      l.push(c);
    }
    return [...m.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([p, l]): [number, CambioTexto[]] => [p, l.sort((a, b) => b.runId - a.runId)]);
  }

  async execute(c: Ctx): Promise<void> {
    this.before = c.engine.save(c.doc);
    this.usoSustitucion = false;
    this.aplicados = [];
    this.fallidosCambios = [];
    const resumen: ResumenReemplazo = { editados: 0, sustituidos: 0, fallidos: 0, fuentes: [] };
    const paginas = this.porPagina(this.cambios);
    const tanda = Math.max(1, this.opts.paginasPorTanda ?? 20);

    for (let i = 0; i < paginas.length; i++) {
      const [pageIndex, lista] = paginas[i]!;
      for (const ch of lista) {
        if (ch.linea) {
          const r = this.editarLinea(c, ch);
          if (r === 'ok') { resumen.editados++; this.aplicados.push(ch); continue; }
          if (typeof r === 'object') {
            resumen.sustituidos++;
            if (!resumen.fuentes.includes(r.fuente)) resumen.fuentes.push(r.fuente);
            this.aplicados.push(ch);
            continue;
          }
          resumen.fallidos++;
          this.fallidosCambios.push(ch);
          continue;
        }
        const res = c.engine.editTextRun(c.doc, pageIndex, ch.runId, ch.newText);
        if (res.ok) { resumen.editados++; this.aplicados.push(ch); continue; }
        if (res.reason === 'glyph-missing') {
          const sust = c.engine.replaceRunWithStandardFont(c.doc, pageIndex, ch.runId, ch.newText);
          if (sust.ok) {
            resumen.sustituidos++;
            this.usoSustitucion = true;
            if (!resumen.fuentes.includes(sust.fontName)) resumen.fuentes.push(sust.fontName);
            this.aplicados.push(ch);
            continue;
          }
        }
        resumen.fallidos++;
        this.fallidosCambios.push(ch);
      }
      c.refreshPage(pageIndex);
      const hechas = i + 1;
      if (hechas % tanda === 0 || hechas === paginas.length) {
        this.opts.onProgress?.(hechas, paginas.length);
        if (hechas < paginas.length) await this.opts.ceder?.();
      }
    }
    this.resumen = resumen;
  }

  /**
   * Reescribe una línea editable. Si el modelo quedó desfasado (los índices de objeto se movieron por una edición
   * anterior de otra línea: `stale`), se relocaliza la línea releyendo la página: la que tenga el mismo texto y esté más
   * cerca del primer objeto original. Devuelve `'ok'`, `{ fuente }` si el tramo usó la fuente estándar (E-047), o `'fallo'`.
   */
  private editarLinea(c: Ctx, ch: CambioTexto): 'ok' | { fuente: string } | 'fallo' {
    let linea: LineaParaEditar = ch.linea!;
    for (let intento = 0; intento < 2; intento++) {
      let res = c.engine.editLine(c.doc, ch.pageIndex, linea, ch.newText);
      if (!res.ok && res.reason === 'glyph-missing') res = c.engine.editLine(c.doc, ch.pageIndex, linea, ch.newText, { fuenteEstandar: true });
      if (res.ok) {
        // Una línea de varios objetos cambia la estructura (objetos eliminados, sufijo trasladado): deshacer por snapshot.
        const fuente = 'fuenteEstandar' in res ? res.fuenteEstandar : undefined;
        if (linea.runIds.length > 1 || fuente) this.usoSustitucion = true;
        return fuente ? { fuente } : 'ok';
      }
      if (res.reason !== 'stale' && res.reason !== 'not-a-text-run') return 'fallo';
      c.refreshPage(ch.pageIndex); // relee el texto de ESA página (caché por página del modelo)
      const candidatas = agruparLineasEditables(c.model.pages[ch.pageIndex]?.runs ?? [], ch.pageIndex)
        .filter((l) => l.text === ch.oldText)
        .sort((a, b) => Math.abs(a.runIds[0]! - ch.runId) - Math.abs(b.runIds[0]! - ch.runId));
      if (candidatas.length === 0) return 'fallo';
      linea = candidatas[0]!;
    }
    return 'fallo';
  }

  async undo(c: Ctx): Promise<void> {
    if (this.usoSustitucion) {
      if (this.before) await c.reload(this.before);
      return;
    }
    for (const [pageIndex, lista] of this.porPagina(this.aplicados)) {
      for (const ch of lista) c.engine.editTextRun(c.doc, pageIndex, ch.runId, ch.oldText);
      c.refreshPage(pageIndex);
    }
  }
}
