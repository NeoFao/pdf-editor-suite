/**
 * Interpreta un rango de páginas tipo "1-3, 5, 8-10" (1-based) a índices 0-based,
 * sin duplicados y en el orden dado. Ignora tramos fuera de [1, total].
 */
export function parseRange(spec: string, total: number): number[] {
  const out: number[] = [];
  const visto = new Set<number>();
  const add = (n1: number) => {
    const i = n1 - 1;
    if (i >= 0 && i < total && !visto.has(i)) { visto.add(i); out.push(i); }
  };
  for (const parte of spec.split(',')) {
    const p = parte.trim();
    if (!p) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(p);
    if (m) {
      const a = parseInt(m[1]!, 10), b = parseInt(m[2]!, 10);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      for (let n = lo; n <= hi; n++) add(n);
    } else if (/^\d+$/.test(p)) {
      add(parseInt(p, 10));
    }
  }
  return out;
}
