import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A-02 (WCAG 1.4.3 / 1.4.11): las ratios de contraste de los tokens de
// `src/ui/estilos.css` no pueden volver a bajar. Lee el CSS real, no una copia.
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const CSS = fs.readFileSync(path.resolve(AQUI, '../../src/ui/estilos.css'), 'utf8');

function tokens(selectorBloque: RegExp): Record<string, string> {
  const m = CSS.match(selectorBloque);
  if (!m) throw new Error(`bloque no encontrado: ${selectorBloque}`);
  const out: Record<string, string> = {};
  for (const [, k, v] of m[1]!.matchAll(/(--ed-[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[k!] = v!;
  return out;
}

const CLARO = tokens(/^:root\s*\{([\s\S]*?)^\}/m);
const OSCURO = { ...CLARO, ...tokens(/^:root\[data-theme="dark"\]\s*\{([\s\S]*?)^\}/m) };
// El bloque `prefers-color-scheme: dark` debe tener los mismos valores que el manual.
const OSCURO_AUTO = { ...CLARO, ...tokens(/prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)\s*\{([\s\S]*?)^  \}/m) };

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

const FONDOS = ['--ed-bg', '--ed-surface', '--ed-surface-2'];
const TEXTOS = ['--ed-text', '--ed-text-muted', '--ed-text-faint'];

for (const [nombre, t] of [['claro', CLARO], ['oscuro', OSCURO], ['oscuro (auto)', OSCURO_AUTO]] as const) {
  test(`contraste ${nombre}: texto >= 4.5:1 sobre cada fondo`, () => {
    for (const f of FONDOS) for (const x of TEXTOS) {
      expect(ratio(t[x]!, t[f]!), `${x} sobre ${f}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(t['--ed-accent-strong']!, t['--ed-accent-soft']!), 'accent-strong sobre accent-soft').toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['--ed-accent-strong']!, t['--ed-surface']!), 'accent-strong sobre surface').toBeGreaterThanOrEqual(4.5);
  });
  test(`contraste ${nombre}: iconos y bordes de controles >= 3:1`, () => {
    for (const f of ['--ed-surface', '--ed-surface-2']) {
      expect(ratio(t['--ed-control-border']!, t[f]!), `control-border sobre ${f}`).toBeGreaterThanOrEqual(3);
      expect(ratio(t['--ed-accent']!, t[f]!), `accent sobre ${f}`).toBeGreaterThanOrEqual(3);
      expect(ratio(t['--ed-focus-ring']!, t[f]!), `focus-ring sobre ${f}`).toBeGreaterThanOrEqual(3);
    }
  });
}
