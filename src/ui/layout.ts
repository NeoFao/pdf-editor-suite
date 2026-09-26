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
