/**
 * Decide qué páginas renderizar: solo las que intersecan el viewport, más un
 * margen (overscan) de una página a cada lado para scroll suave. Es lógica pura
 * y testeable: el visor real la usa para no instanciar un canvas por página.
 */
export function visiblePageIndices(
  pageHeightsCss: number[],
  gap: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 1
): number[] {
  const tops: number[] = [];
  let y = 0;
  for (const h of pageHeightsCss) { tops.push(y); y += h + gap; }
  const viewTop = scrollTop;
  const viewBottom = scrollTop + viewportHeight;
  const visibles: number[] = [];
  for (let i = 0; i < pageHeightsCss.length; i++) {
    const top = tops[i]!;
    const bottom = top + pageHeightsCss[i]!;
    if (bottom >= viewTop && top <= viewBottom) visibles.push(i);
  }
  if (visibles.length === 0) return [];
  const first = Math.max(0, visibles[0]! - overscan);
  const last = Math.min(pageHeightsCss.length - 1, visibles[visibles.length - 1]! + overscan);
  const out: number[] = [];
  for (let i = first; i <= last; i++) out.push(i);
  return out;
}

/**
 * Escala de "ajustar al ancho" (`App.fitWidth`): la mayor escala (a la
 * milésima) tal que `widthPt * escala <= disponiblePx`, acotada a
 * [`min`, `max`]. Lógica pura y testeable — es la fuente de un defecto real
 * (revisión de PR #63): redondear con `Math.round` a la centésima más
 * cercana puede redondear la escala HACIA ARRIBA cuando la parte decimal del
 * cociente `(disponiblePx/widthPt)*100` es ≥ 0,5, dejando la página hasta
 * ~0,3 pt más ancha que el hueco disponible — en pantalla, unos px de más
 * que abren una barra de scroll horizontal en el visor y rompen el centrado
 * (`margin: 0 auto`), que colapsa a un reparto asimétrico. `Math.floor`
 * garantiza `widthPt * escala <= disponiblePx` siempre (nunca redondea hacia
 * arriba); se trunca a la milésima, no a la centésima, para perder la menor
 * precisión posible (holgura máxima ~0,1 % del ancho de página, bien por
 * debajo de 1 px) — el `%` que se muestra en pantalla sigue redondeando al
 * entero más cercano para mostrarlo, eso no cambia.
 */
export function calcularEscalaAjusteAncho(disponiblePx: number, widthPt: number, min = 0.25, max = 4): number {
  if (disponiblePx <= 0 || widthPt <= 0) return min;
  const escala = Math.floor((disponiblePx / widthPt) * 1000) / 1000;
  return Math.min(max, Math.max(min, escala));
}
