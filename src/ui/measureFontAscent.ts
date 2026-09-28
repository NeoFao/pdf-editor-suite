/**
 * Mide, en px CSS, el ascenso y descenso reales que el navegador usa para
 * maquetar una fuente — a partir del mismo shorthand `font` que ya fija
 * `cssFontFor` en la run. `CanvasRenderingContext2D.measureText(...)
 * .fontBoundingBoxAscent/Descent` están definidos por spec para coincidir con
 * las métricas de línea que usa el motor de layout (Blink) para esa misma
 * fuente — por eso sirven para calcular dónde cae la línea base sin depender
 * del "half-leading" implícito de `line-height: normal` (E-030, ver
 * docs/ERRORES-CONOCIDOS.md).
 *
 * Función pequeña y aislada a propósito: no se puede probar en Vitest (motor
 * en Node, sin `canvas`), así que la cubre la suite E2E en Chromium real.
 */
export interface FontMetricsCss { ascentCss: number; descentCss: number }

let sharedCtx: CanvasRenderingContext2D | null | undefined;

function getCtx(): CanvasRenderingContext2D | null {
  if (sharedCtx === undefined) {
    const canvas = document.createElement('canvas');
    sharedCtx = canvas.getContext('2d');
  }
  return sharedCtx;
}

export function measureFontAscent(font: string): FontMetricsCss {
  const ctx = getCtx();
  if (!ctx) return { ascentCss: 0, descentCss: 0 };
  ctx.font = font;
  // 'Hg' da una caja representativa (ascendente de mayúscula + descendente de
  // 'g'); fontBoundingBox* no depende del texto medido, solo de la fuente.
  const m = ctx.measureText('Hg');
  return { ascentCss: m.fontBoundingBoxAscent, descentCss: m.fontBoundingBoxDescent };
}
