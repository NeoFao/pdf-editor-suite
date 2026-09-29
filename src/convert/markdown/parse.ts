import type { Block, Inline, ListBlock, ListItem } from './ast';

/**
 * Parser Markdown propio, PURO (sin dependencias de runtime: nada de
 * `marked` ni similares — decisión explícita del dueño, ver AGENTS.md §5).
 * Cubre el subconjunto CommonMark habitual usado por documentos de texto
 * normales: encabezados ATX (`#`..`######`), párrafos (con líneas
 * multilínea unidas), listas ordenadas/no ordenadas con anidamiento por
 * sangría (hasta 3 niveles), citas (`>`, con anidamiento), bloques de
 * código (```` ``` ````) y reglas horizontales (`---`/`***`/`___`).
 * Inline: texto, `**negrita**`, `*cursiva*`/`_cursiva_`, `` `código` `` y
 * `[texto](url)`.
 *
 * Lo que NO cubre esta fase (documentado a propósito, §9 fila #32):
 * - Tablas GFM.
 * - Imágenes (`![alt](url)`) — se leen como texto literal (el `!` antes del
 *   `[` no activa nada especial; el enlace interno SÍ se reconoce).
 * - HTML embebido: nunca se interpreta, se trata siempre como texto literal
 *   (ni siquiera se reconoce como "bloque HTML" de CommonMark: una línea con
 *   `<div>` entra como párrafo normal, con las etiquetas como texto plano).
 * - Notas al pie, definiciones de enlace por referencia, matemáticas KaTeX.
 * - Continuación perezosa de citas (una línea sin `>` que sigue a una cita
 *   NO se considera parte de ella; hay que repetir `>` en cada línea).
 * - Ítems de lista con múltiples párrafos: el contenido de un ítem es una
 *   sola línea lógica (más su posible sublista).
 *
 * Robustez ante entrada hostil: ninguna función usa regex con backtracking
 * exponencial sobre el contenido del documento, y hay tres cotas explícitas
 * que garantizan trabajo acotado sin importar la forma del ataque:
 * `MAX_BLOCKQUOTE_DEPTH` (anidamiento de citas), `MAX_INLINE_DEPTH`
 * (anidamiento de énfasis) y `MAX_INLINE_STEPS` (presupuesto total de pasos
 * del analizador de línea, compartido por todo un bloque de texto — al
 * agotarse, el resto se emite como texto literal en vez de seguir
 * analizando). Ver los tests de "entrada hostil" en
 * `tests/unit/markdown-parse.test.ts`.
 */

/**
 * Cota de profundidad de citas anidadas (`>`). Más allá, los `>` sobrantes
 * quedan como texto literal. Exportada (junto con las otras dos cotas de
 * abajo) para que los tests puedan asertar sobre el TRABAJO acotado que
 * garantizan estas constantes, en vez de sobre tiempo de reloj — ver
 * `tests/unit/markdown-parse.test.ts` y `docs/TESTING.md`.
 */
export const MAX_BLOCKQUOTE_DEPTH = 30;
/** Cota de profundidad de énfasis anidado (`**a *b* c**`...). */
export const MAX_INLINE_DEPTH = 20;
/** Presupuesto total de pasos del analizador inline por invocación de `parseInline` (un bloque de texto). */
export const MAX_INLINE_STEPS = 500_000;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return parseBlocks(lines, 0);
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const RE_HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const RE_QUOTE = /^ {0,3}>( ?)/;

function matchListItem(line: string): { indent: number; ordered: boolean; start?: number; content: string } | null {
  const m = /^( {0,20})([-*+]|(\d{1,9})[.)]) +(.*)$/.exec(line);
  if (!m) return null;
  // Una línea de puro "- " o "* " (regla horizontal de 3+) ya se filtra antes de llegar aquí.
  const indent = m[1]!.length;
  const marker = m[2]!;
  const ordered = /^\d/.test(marker);
  return { indent, ordered, start: ordered ? parseInt(m[3]!, 10) : undefined, content: m[4]! };
}

function parseBlocks(lines: string[], quoteDepth: number): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) { i++; continue; }

    const fence = RE_FENCE.exec(line);
    if (fence) {
      const fenceChar = fence[1]![0]!;
      const fenceLen = fence[1]!.length;
      const lang = fence[2]!.trim() || undefined;
      let j = i + 1;
      const codeLines: string[] = [];
      const closeRe = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}\\s*$`);
      while (j < lines.length && !closeRe.test(lines[j]!)) { codeLines.push(lines[j]!); j++; }
      if (j < lines.length) j++; // consume la línea de cierre si existe
      blocks.push({ type: 'code', text: codeLines.join('\n'), lang });
      i = j;
      continue;
    }

    if (RE_HR.test(line) && !matchListItem(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    const heading = RE_HEADING.exec(line);
    if (heading) {
      const level = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      const content = (heading[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '');
      blocks.push({ type: 'heading', level, children: parseInline(content) });
      i++;
      continue;
    }

    if (RE_QUOTE.test(line) && quoteDepth < MAX_BLOCKQUOTE_DEPTH) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length) {
        const m = RE_QUOTE.exec(lines[j]!);
        if (!m) break;
        inner.push(lines[j]!.slice(m[0].length));
        j++;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(inner, quoteDepth + 1) });
      i = j;
      continue;
    }

    const list = parseListAt(lines, i, 0, 0);
    if (list) {
      blocks.push(list.node);
      i = list.next;
      continue;
    }

    // Párrafo: consume hasta línea en blanco o el inicio de otro tipo de bloque.
    const paraLines: string[] = [];
    let j = i;
    while (j < lines.length) {
      const l = lines[j]!;
      if (isBlank(l)) break;
      if (RE_FENCE.test(l)) break;
      if (RE_HR.test(l) && !matchListItem(l)) break;
      if (RE_HEADING.test(l)) break;
      if (RE_QUOTE.test(l) && quoteDepth < MAX_BLOCKQUOTE_DEPTH) break;
      if (matchListItem(l)) break;
      paraLines.push(l);
      j++;
    }
    if (paraLines.length === 0) { i++; continue; } // salvaguarda: no debería darse
    blocks.push({ type: 'paragraph', children: parseInline(paraLines.join(' ')) });
    i = j;
  }
  return blocks;
}

/** Máximo de niveles de sublista que se conservan como anidamiento real (0, 1, 2 = 3 niveles). Más allá, se sigue leyendo como ítems planos del último nivel. */
const MAX_LIST_DEPTH = 2;

function parseListAt(lines: string[], start: number, minIndent: number, depth: number): { node: ListBlock; next: number } | null {
  const first = matchListItem(lines[start] ?? '');
  if (!first || first.indent < minIndent) return null;
  const indent = first.indent;
  const ordered = first.ordered;
  const items: ListItem[] = [];
  let i = start;
  while (i < lines.length) {
    const m = matchListItem(lines[i]!);
    if (!m || m.indent !== indent || m.ordered !== ordered) break;
    const inline = parseInline(m.content);
    i++;
    let sublist: ListBlock | undefined;
    if (depth < MAX_LIST_DEPTH) {
      const r = parseListAt(lines, i, indent + 1, depth + 1);
      if (r) { sublist = r.node; i = r.next; }
    }
    items.push(sublist ? { children: inline, sublist } : { children: inline });
  }
  return { node: { type: 'list', ordered, ...(ordered ? { start: first.start } : {}), items }, next: i };
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

interface Budget { steps: number }

/**
 * `stats`, si se pasa, recibe el número de pasos que consumió el analizador
 * (`budget.steps` al terminar) — puramente diagnóstico, para que los tests
 * puedan asertar sobre el TRABAJO realizado (cuántos pasos, acotados por
 * `MAX_INLINE_STEPS`) en vez de sobre tiempo de reloj. No cambia el
 * comportamiento del análisis ni el contrato para el resto del código.
 */
export function parseInline(text: string, stats?: { steps: number }): Inline[] {
  const budget: Budget = { steps: 0 };
  const nodes = parseInlineInner(text, 0, budget);
  if (stats) stats.steps = budget.steps;
  return nodes;
}

function parseInlineInner(text: string, depth: number, budget: Budget): Inline[] {
  if (depth > MAX_INLINE_DEPTH) return text ? [{ type: 'text', text }] : [];
  const nodes: Inline[] = [];
  let buf = '';
  let i = 0;
  const flush = (): void => { if (buf) { nodes.push({ type: 'text', text: buf }); buf = ''; } };

  while (i < text.length) {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) { buf += text.slice(i); i = text.length; break; }
    const c = text[i]!;

    if (c === '`') {
      let j = i;
      let runLen = 0;
      while (j < text.length && text[j] === '`') { runLen++; j++; }
      const closeIdx = findExactRun(text, j, '`', runLen, budget);
      if (closeIdx !== -1) {
        flush();
        nodes.push({ type: 'code', text: text.slice(j, closeIdx).trim() });
        i = closeIdx + runLen;
        continue;
      }
      buf += '`'.repeat(runLen);
      i = j;
      continue;
    }

    if (c === '[') {
      const link = matchLink(text, i, budget);
      if (link) {
        flush();
        nodes.push({ type: 'link', text: link.text, url: link.url });
        i = link.end;
        continue;
      }
      buf += c; i++; continue;
    }

    if (c === '*' || c === '_') {
      let j = i;
      let runLen = 0;
      while (j < text.length && text[j] === c) { runLen++; j++; }
      const wantLen = runLen >= 2 ? 2 : 1;
      const closeIdx = findMinRun(text, j, c, wantLen, budget);
      if (closeIdx !== -1 && closeIdx > j) {
        flush();
        const inner = parseInlineInner(text.slice(j, closeIdx), depth + 1, budget);
        nodes.push({ type: wantLen === 2 ? 'strong' : 'em', children: inner });
        i = closeIdx + wantLen;
        if (runLen > wantLen) buf += c.repeat(runLen - wantLen);
        continue;
      }
      buf += c.repeat(runLen);
      i = j;
      continue;
    }

    buf += c;
    i++;
  }
  flush();
  return nodes;
}

/** Busca un run de EXACTAMENTE `len` copias de `ch` a partir de `from` (código en línea: el cierre debe tener el mismo número de backticks que la apertura). -1 si no lo encuentra. */
function findExactRun(text: string, from: number, ch: string, len: number, budget: Budget): number {
  let i = from;
  while (i < text.length) {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) return -1;
    if (text[i] === ch) {
      let runLen = 0, j = i;
      while (j < text.length && text[j] === ch) { runLen++; j++; }
      if (runLen === len) return i;
      i = j;
    } else {
      i++;
    }
  }
  return -1;
}

/** Busca un run de AL MENOS `len` copias de `ch` a partir de `from` (énfasis: `***x**` cierra con el run de 2). -1 si no lo encuentra. */
function findMinRun(text: string, from: number, ch: string, len: number, budget: Budget): number {
  let i = from;
  while (i < text.length) {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) return -1;
    if (text[i] === ch) {
      let runLen = 0, j = i;
      while (j < text.length && text[j] === ch) { runLen++; j++; }
      if (runLen >= len) return i;
      i = j;
    } else {
      i++;
    }
  }
  return -1;
}

/** `[texto](url)` desde la posición del `[`. `null` si no cierra correctamente (se trata como texto literal). */
function matchLink(text: string, start: number, budget: Budget): { text: string; url: string; end: number } | null {
  let depthBrackets = 1;
  let j = start + 1;
  while (j < text.length && depthBrackets > 0) {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) return null;
    if (text[j] === '[') depthBrackets++;
    else if (text[j] === ']') { depthBrackets--; if (depthBrackets === 0) break; }
    j++;
  }
  if (depthBrackets !== 0 || j >= text.length) return null;
  const linkText = text.slice(start + 1, j);
  if (text[j + 1] !== '(') return null;
  let k = j + 2;
  while (k < text.length && text[k] !== ')') {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) return null;
    k++;
  }
  if (text[k] !== ')') return null;
  const url = text.slice(j + 2, k);
  return { text: linkText, url, end: k + 1 };
}
