import type { Block, Inline, ListBlock, ListItem, TablaAlineacion } from './ast';
import { textoPlano } from './texto';

/**
 * Parser Markdown propio, PURO (sin dependencias de runtime: nada de
 * `marked` ni similares — decisión explícita del dueño, ver AGENTS.md §5).
 * Cubre CommonMark habitual y las extensiones GFM de uso real:
 * - Bloques: encabezados ATX y setext, párrafos (con salto duro `  `/`\`),
 *   listas ordenadas/no ordenadas (anidadas hasta 3 niveles, sueltas o
 *   compactas, de tareas `[ ]`/`[x]`, con líneas de continuación), citas
 *   (`>`, anidadas y con continuación perezosa), código con valla y
 *   sangrado, reglas horizontales, tablas GFM con alineación y notas al pie
 *   `[^id]` (E-119).
 * - Inline: `**negrita**`, `*cursiva*`/`_cursiva_` (el `_` dentro de una
 *   palabra no cuenta), `***ambas***`, `~~tachado~~`, `` `código` ``, escapes
 *   `\*`, entidades `&amp;`/`&#233;`, enlaces en línea, de referencia y
 *   automáticos (`<url>`, URL desnuda), imágenes e imágenes dentro de enlaces.
 *
 * Lo que NO cubre (documentado a propósito):
 * - HTML embebido: nunca se interpreta, se trata siempre como texto literal
 *   (el conversor lo avisa; ver `ConversorMarkdownNavegador`).
 * - Matemáticas KaTeX, listas de definición, notas al pie con varios párrafos.
 * - Ítems de lista con múltiples párrafos: el contenido de un ítem es un
 *   solo texto (más su posible sublista); un párrafo sangrado tras una línea
 *   en blanco pasa a ser un bloque aparte.
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

/** Definiciones recogidas antes del análisis de bloques: enlaces de referencia y notas al pie. */
export interface Ctx {
  refs: Map<string, string>;
  notes: Map<string, string>;
  /** Ids de notas en orden de primera referencia. */
  noteOrder: string[];
}

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const ctx: Ctx = { refs: new Map(), notes: new Map(), noteOrder: [] };
  const limpias = extraerDefiniciones(lines, ctx);
  const blocks = parseBlocks(limpias, 0, ctx);
  if (ctx.noteOrder.length > 0) {
    const items: { id: string; children: Inline[] }[] = [];
    // El texto de una nota puede referenciar otra: `noteOrder` crece mientras se recorre (acotado por nº de definiciones).
    for (let k = 0; k < ctx.noteOrder.length; k++) {
      const id = ctx.noteOrder[k]!;
      items.push({ id, children: parseInline(ctx.notes.get(id) ?? '', undefined, ctx) });
    }
    blocks.push({ type: 'footnotes', items });
  }
  return blocks;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

const RE_FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const RE_HR = /^ {0,3}([-*_])( *\1){2,} *$/;
const RE_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const RE_QUOTE = /^ {0,3}>( ?)/;
const RE_SETEXT1 = /^ {0,3}=+ *$/;
const RE_SETEXT2 = /^ {0,3}-+ *$/;
const RE_DEF_NOTA = /^ {0,3}\[\^([^\]\s]{1,64})\]:[ \t]*(.*)$/;
const RE_DEF_REF = /^ {0,3}\[([^\]\n]{1,200})\]:[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*$/;

function etiqueta(s: string): string { return s.trim().replace(/\s+/g, ' ').toLowerCase(); }

/** Pre-pase: saca de las líneas las definiciones de enlace de referencia y de nota al pie (fuera de bloques de código con valla). */
function extraerDefiniciones(lines: string[], ctx: Ctx): string[] {
  const out: string[] = [];
  let valla: { ch: string; len: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = RE_FENCE.exec(line);
    if (valla) {
      out.push(line);
      if (f && f[1]![0] === valla.ch && f[1]!.length >= valla.len && f[2]!.trim() === '') valla = null;
      continue;
    }
    if (f) { valla = { ch: f[1]![0]!, len: f[1]!.length }; out.push(line); continue; }
    const nota = RE_DEF_NOTA.exec(line);
    if (nota) {
      let texto = nota[2]!;
      // Continuación: líneas sangradas (2+ espacios o tab) pertenecen a la misma nota.
      while (i + 1 < lines.length && /^( {2,}|\t)\S/.test(lines[i + 1]!)) { texto += ' ' + lines[i + 1]!.trim(); i++; }
      if (!ctx.notes.has(nota[1]!)) ctx.notes.set(nota[1]!, texto.trim());
      continue;
    }
    const ref = RE_DEF_REF.exec(line);
    if (ref && !ref[1]!.startsWith('^')) {
      const dest = ref[2]!.startsWith('<') ? ref[2]!.slice(1, -1) : ref[2]!;
      const k = etiqueta(ref[1]!);
      if (!ctx.refs.has(k)) ctx.refs.set(k, dest);
      continue;
    }
    out.push(line);
  }
  return out;
}

function matchListItem(line: string): { indent: number; ordered: boolean; start?: number; content: string } | null {
  const m = /^( {0,20})([-*+]|(\d{1,9})[.)]) +(.*)$/.exec(line);
  if (!m) return null;
  // Una línea de puro "- " o "* " (regla horizontal de 3+) ya se filtra antes de llegar aquí.
  const indent = m[1]!.length;
  const marker = m[2]!;
  const ordered = /^\d/.test(marker);
  return { indent, ordered, start: ordered ? parseInt(m[3]!, 10) : undefined, content: m[4]! };
}

/** Celdas de una fila de tabla GFM (`| a | b |`), con `\|` como pipe literal; `null` si la línea no tiene ninguna barra. */
function celdasDeFila(line: string): string[] | null {
  if (!line.includes('|')) return null;
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const celdas: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '|') { celdas.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  celdas.push(cur.trim());
  return celdas;
}

function alineacionesDeDelimitador(line: string): TablaAlineacion[] | null {
  const celdas = celdasDeFila(line);
  if (!celdas) return null;
  const out: TablaAlineacion[] = [];
  for (const c of celdas) {
    if (!/^:?-+:?$/.test(c)) return null;
    out.push(c.startsWith(':') ? (c.endsWith(':') ? 'center' : 'left') : c.endsWith(':') ? 'right' : null);
  }
  return out;
}

function esInicioDeBloque(l: string, quoteDepth: number): boolean {
  return RE_FENCE.test(l) || (RE_HR.test(l) && !matchListItem(l)) || RE_HEADING.test(l) || (RE_QUOTE.test(l) && quoteDepth < MAX_BLOCKQUOTE_DEPTH);
}

function parseBlocks(lines: string[], quoteDepth: number, ctx: Ctx): Block[] {
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

    // Código sangrado (4+ espacios o tab). Una línea sangrada que además parece ítem de lista se deja a la lista.
    if (/^( {4}|\t)/.test(line) && !matchListItem(line)) {
      const codeLines: string[] = [];
      let j = i;
      while (j < lines.length) {
        const l = lines[j]!;
        if (/^( {4}|\t)/.test(l)) { codeLines.push(l.replace(/^( {4}|\t)/, '')); j++; continue; }
        if (isBlank(l)) {
          // una línea en blanco solo pertenece al bloque si tras ella sigue más código sangrado
          let k = j;
          while (k < lines.length && isBlank(lines[k]!)) k++;
          if (k < lines.length && /^( {4}|\t)/.test(lines[k]!)) { for (let q = j; q < k; q++) codeLines.push(''); j = k; continue; }
        }
        break;
      }
      blocks.push({ type: 'code', text: codeLines.join('\n') });
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
      blocks.push({ type: 'heading', level, children: parseInline(content, undefined, ctx) });
      i++;
      continue;
    }

    if (RE_QUOTE.test(line) && quoteDepth < MAX_BLOCKQUOTE_DEPTH) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length) {
        const l = lines[j]!;
        const m = RE_QUOTE.exec(l);
        if (m) { inner.push(l.slice(m[0].length)); j++; continue; }
        // Continuación perezosa: una línea de texto sin `>` que sigue a una línea de texto de la cita.
        const ultima = inner[inner.length - 1];
        if (!isBlank(l) && ultima !== undefined && !isBlank(ultima) && !RE_FENCE.test(ultima) && !esInicioDeBloque(l, quoteDepth) && !matchListItem(l)) { inner.push(l.trim()); j++; continue; }
        break;
      }
      blocks.push({ type: 'blockquote', children: parseBlocks(inner, quoteDepth + 1, ctx) });
      i = j;
      continue;
    }

    // Tabla GFM: línea con barras + fila delimitadora con el mismo número de columnas.
    if (i + 1 < lines.length) {
      const cab = celdasDeFila(line);
      const alin = cab ? alineacionesDeDelimitador(lines[i + 1]!) : null;
      if (cab && alin && cab.length === alin.length) {
        const n = alin.length;
        const fila = (cs: string[]): Inline[][] => Array.from({ length: n }, (_v, k) => parseInline(cs[k] ?? '', undefined, ctx));
        const rows: Inline[][][] = [];
        let j = i + 2;
        while (j < lines.length && !isBlank(lines[j]!) && !RE_FENCE.test(lines[j]!) && !RE_HEADING.test(lines[j]!) && !RE_QUOTE.test(lines[j]!)) {
          rows.push(fila(celdasDeFila(lines[j]!) ?? [lines[j]!.trim()]));
          j++;
        }
        blocks.push({ type: 'table', align: alin, header: fila(cab), rows });
        i = j;
        continue;
      }
    }

    const list = parseListAt(lines, i, 0, 0, ctx);
    if (list) {
      blocks.push(list.node);
      i = list.next;
      continue;
    }

    // Párrafo: consume hasta línea en blanco o el inicio de otro tipo de bloque. Una línea `===`/`---` justo debajo lo convierte en encabezado setext.
    const paraLines: string[] = [];
    let j = i;
    let setext: 1 | 2 | null = null;
    while (j < lines.length) {
      const l = lines[j]!;
      if (isBlank(l)) break;
      if (paraLines.length > 0) {
        if (RE_SETEXT1.test(l)) { setext = 1; j++; break; }
        if (RE_SETEXT2.test(l)) { setext = 2; j++; break; }
      }
      if (RE_FENCE.test(l)) break;
      if (RE_HR.test(l) && !matchListItem(l)) break;
      if (RE_HEADING.test(l)) break;
      if (RE_QUOTE.test(l) && quoteDepth < MAX_BLOCKQUOTE_DEPTH) break;
      if (matchListItem(l)) break;
      paraLines.push(l);
      j++;
    }
    if (paraLines.length === 0) { i++; continue; } // salvaguarda: no debería darse
    if (setext) {
      blocks.push({ type: 'heading', level: setext, children: parseInline(paraLines.map((l) => l.trim()).join(' '), undefined, ctx) });
    } else {
      // Las líneas se unen con \n: el analizador en línea decide si es salto duro (2 espacios o \) o un espacio.
      const texto = paraLines.map((l, k) => (k === paraLines.length - 1 ? l.trim() : l.trimStart())).join('\n');
      blocks.push({ type: 'paragraph', children: parseInline(texto, undefined, ctx) });
    }
    i = j;
  }
  return blocks;
}

/** Máximo de niveles de sublista que se conservan como anidamiento real (0, 1, 2 = 3 niveles). Más allá, se sigue leyendo como ítems planos del último nivel. */
const MAX_LIST_DEPTH = 2;

function siguienteNoBlanca(lines: string[], desde: number): number {
  let k = desde;
  while (k < lines.length && isBlank(lines[k]!)) k++;
  return k;
}

function parseListAt(lines: string[], start: number, minIndent: number, depth: number, ctx: Ctx): { node: ListBlock; next: number } | null {
  const first = matchListItem(lines[start] ?? '');
  if (!first || first.indent < minIndent) return null;
  const indent = first.indent;
  const ordered = first.ordered;
  const items: ListItem[] = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const m = matchListItem(lines[i]!);
    if (!m || m.indent !== indent || m.ordered !== ordered) break;
    let contenido = m.content;
    i++;
    // Líneas de continuación del ítem (sangradas o perezosas): se unen al texto del ítem.
    while (i < lines.length && !isBlank(lines[i]!) && !matchListItem(lines[i]!) && !esInicioDeBloque(lines[i]!, 0)) {
      contenido += '\n' + lines[i]!.trim();
      i++;
    }
    let task: boolean | undefined;
    const t = /^\[( |x|X)\](?: +|$)(.*)$/s.exec(contenido);
    if (t) { task = t[1] !== ' '; contenido = t[2]!; }
    const inline = parseInline(contenido, undefined, ctx);
    let sublist: ListBlock | undefined;
    if (depth < MAX_LIST_DEPTH) {
      // Una sublista puede ir precedida de una línea en blanco.
      const k = isBlank(lines[i] ?? 'x') ? siguienteNoBlanca(lines, i) : i;
      const mk = k < lines.length ? matchListItem(lines[k]!) : null;
      if (mk && mk.indent > indent) {
        const r = parseListAt(lines, k, indent + 1, depth + 1, ctx);
        if (r) { sublist = r.node; i = r.next; }
      }
    }
    items.push({ children: inline, ...(sublist ? { sublist } : {}), ...(task !== undefined ? { task } : {}) });
    // Líneas en blanco entre ítems del mismo nivel: lista suelta (sigue siendo la MISMA lista).
    if (i < lines.length && isBlank(lines[i]!)) {
      const k = siguienteNoBlanca(lines, i);
      const mk = k < lines.length ? matchListItem(lines[k]!) : null;
      if (mk && mk.indent === indent && mk.ordered === ordered) { loose = true; i = k; }
    }
  }
  return { node: { type: 'list', ordered, ...(ordered ? { start: first.start } : {}), ...(loose ? { loose: true } : {}), items }, next: i };
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------

interface Budget { steps: number; ctx?: Ctx }

/**
 * `stats`, si se pasa, recibe el número de pasos que consumió el analizador
 * (`budget.steps` al terminar) — puramente diagnóstico, para que los tests
 * puedan asertar sobre el TRABAJO realizado (cuántos pasos, acotados por
 * `MAX_INLINE_STEPS`) en vez de sobre tiempo de reloj. No cambia el
 * comportamiento del análisis ni el contrato para el resto del código.
 * `ctx` (interno) aporta las definiciones de enlaces de referencia y notas.
 */
export function parseInline(text: string, stats?: { steps: number }, ctx?: Ctx): Inline[] {
  const budget: Budget = { steps: 0, ...(ctx ? { ctx } : {}) };
  const nodes = parseInlineInner(text, 0, budget);
  if (stats) stats.steps = budget.steps;
  return nodes;
}

const PUNTUACION_ASCII = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

const ENTIDADES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', reg: '®', trade: '™', hellip: '…',
  mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', euro: '€', deg: '°',
  plusmn: '±', times: '×', divide: '÷', middot: '·', bull: '•', para: '¶', sect: '§', cent: '¢', pound: '£', yen: '¥',
  iexcl: '¡', iquest: '¿', frac12: '½', frac14: '¼', frac34: '¾', larr: '←', rarr: '→'
};

function decodificarEntidad(text: string, i: number): { s: string; end: number } | null {
  const fin = text.indexOf(';', i + 1);
  if (fin === -1 || fin - i > 12) return null;
  const nombre = text.slice(i + 1, fin);
  let s: string | undefined;
  if (/^#\d{1,7}$/.test(nombre)) s = codigoAString(parseInt(nombre.slice(1), 10));
  else if (/^#[xX][0-9a-fA-F]{1,6}$/.test(nombre)) s = codigoAString(parseInt(nombre.slice(2), 16));
  else if (/^[a-zA-Z][a-zA-Z0-9]{1,10}$/.test(nombre)) s = ENTIDADES[nombre];
  return s === undefined ? null : { s, end: fin + 1 };
}

function codigoAString(cp: number): string | undefined {
  if (cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return undefined;
  return String.fromCodePoint(cp);
}

const esAlnum = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);
const esBlanco = (c: string | undefined): boolean => c === undefined || /\s/.test(c);

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

    if (c === '\\') {
      const next = text[i + 1];
      if (next === '\n') { buf = buf.replace(/ +$/, ''); flush(); nodes.push({ type: 'br' }); i += 2; continue; }
      if (next !== undefined && PUNTUACION_ASCII.includes(next)) { buf += next; i += 2; continue; }
      buf += c; i++; continue;
    }

    if (c === '\n') {
      if (/ {2,}$/.test(buf)) { buf = buf.replace(/ +$/, ''); flush(); nodes.push({ type: 'br' }); }
      else { buf = buf.replace(/ +$/, '') + ' '; }
      i++;
      continue;
    }

    if (c === '&') {
      const e = decodificarEntidad(text, i);
      if (e) { buf += e.s; i = e.end; continue; }
      buf += c; i++; continue;
    }

    if (c === '`') {
      let j = i;
      let runLen = 0;
      while (j < text.length && text[j] === '`') { runLen++; j++; }
      const closeIdx = findExactRun(text, j, '`', runLen, budget);
      if (closeIdx !== -1) {
        flush();
        nodes.push({ type: 'code', text: text.slice(j, closeIdx).replace(/\n/g, ' ').trim() });
        i = closeIdx + runLen;
        continue;
      }
      buf += '`'.repeat(runLen);
      i = j;
      continue;
    }

    if (c === '!' && text[i + 1] === '[') {
      const img = matchLink(text, i + 1, budget);
      if (img) {
        flush();
        nodes.push({ type: 'image', alt: textoPlano(parseInlineInner(img.text, depth + 1, budget)), src: img.url });
        i = img.end;
        continue;
      }
      buf += c; i++; continue;
    }

    if (c === '[') {
      const id = /^\[\^([^\]\s]{1,64})\]/.exec(text.slice(i, i + 70))?.[1];
      if (id !== undefined && budget.ctx?.notes.has(id)) {
        flush();
        if (!budget.ctx.noteOrder.includes(id)) budget.ctx.noteOrder.push(id);
        nodes.push({ type: 'footnote', id });
        i += id.length + 3;
        continue;
      }
      const link = matchLink(text, i, budget);
      if (link) {
        flush();
        const hijos = parseInlineInner(link.text, depth + 1, budget);
        const plano = textoPlano(hijos);
        const simple = hijos.every((h) => h.type === 'text');
        nodes.push(simple ? { type: 'link', text: plano, url: link.url } : { type: 'link', text: plano, url: link.url, children: hijos });
        i = link.end;
        continue;
      }
      buf += c; i++; continue;
    }

    if (c === '<') {
      const fin = text.indexOf('>', i + 1);
      if (fin !== -1 && fin - i <= 300) {
        const dentro = text.slice(i + 1, fin);
        if (/^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/.test(dentro)) {
          flush(); nodes.push({ type: 'link', text: dentro, url: dentro }); i = fin + 1; continue;
        }
        if (/^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){1,5}$/.test(dentro)) {
          flush(); nodes.push({ type: 'link', text: dentro, url: `mailto:${dentro}` }); i = fin + 1; continue;
        }
      }
      buf += c; i++; continue;
    }

    if (c === 'h' && (text.startsWith('http://', i) || text.startsWith('https://', i)) && !esAlnum(text[i - 1])) {
      let j = i;
      while (j < text.length && !/[\s<]/.test(text[j]!)) { j++; budget.steps++; }
      let url = text.slice(i, j);
      // Puntuación final que no forma parte de la URL (GFM): . , : ; ! ? ' " y un ")" sin "(" que lo abra.
      for (;;) {
        const ult = url[url.length - 1];
        if (ult !== undefined && '.,:;!?\'"*_~'.includes(ult)) url = url.slice(0, -1);
        else if (ult === ')' && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
        else break;
      }
      if (url.length > 'https://'.length) {
        flush(); nodes.push({ type: 'link', text: url, url }); i += url.length; continue;
      }
      buf += c; i++; continue;
    }

    if (c === '~' && text[i + 1] === '~' && !esBlanco(text[i + 2])) {
      const closeIdx = findTildes(text, i + 2, budget);
      if (closeIdx !== -1) {
        flush();
        nodes.push({ type: 'del', children: parseInlineInner(text.slice(i + 2, closeIdx), depth + 1, budget) });
        i = closeIdx + 2;
        continue;
      }
      buf += '~~'; i += 2; continue;
    }

    if (c === '*' || c === '_') {
      let j = i;
      let runLen = 0;
      while (j < text.length && text[j] === c) { runLen++; j++; }
      // Un `_` pegado a una letra/número por la izquierda (snake_case) o con espacio a la derecha no abre énfasis.
      const puedeAbrir = !esBlanco(text[j]) && !(c === '_' && esAlnum(text[i - 1]));
      if (puedeAbrir) {
        const wantLen = runLen >= 3 ? 3 : runLen >= 2 ? 2 : 1;
        const closeIdx = findMinRun(text, j, c, wantLen, budget);
        if (closeIdx !== -1 && closeIdx > j) {
          buf += c.repeat(runLen - wantLen);
          flush();
          const inner = parseInlineInner(text.slice(j, closeIdx), depth + 1, budget);
          nodes.push(wantLen === 3 ? { type: 'strong', children: [{ type: 'em', children: inner }] } : { type: wantLen === 2 ? 'strong' : 'em', children: inner });
          i = closeIdx + wantLen;
          continue;
        }
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

/**
 * Busca el cierre de un énfasis de `len` marcas de `ch`: un run de AL MENOS `len` (`***x**` cierra con el run de 2)
 * precedido de un carácter que no sea blanco y, para `_`, no pegado a una letra por la derecha. Con `len` = 1 los runs
 * de 2 o más son un énfasis fuerte anidado (`*a **b** c*`) y se saltan. Los caracteres escapados no cuentan. -1 si no hay.
 */
function findMinRun(text: string, from: number, ch: string, len: number, budget: Budget): number {
  let i = from;
  while (i < text.length) {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) return -1;
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === ch) {
      let runLen = 0, j = i;
      while (j < text.length && text[j] === ch) { runLen++; j++; }
      const cierraBien = runLen >= len && !esBlanco(text[i - 1]) && !(ch === '_' && esAlnum(text[i + len]));
      if (cierraBien && !(len === 1 && runLen >= 2)) return i;
      i = j;
    } else {
      i++;
    }
  }
  return -1;
}

/** Cierre `~~` de un tachado (precedido de carácter no blanco). -1 si no hay. */
function findTildes(text: string, from: number, budget: Budget): number {
  let i = from;
  while (i < text.length - 1) {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) return -1;
    if (text[i] === '\\') { i += 2; continue; }
    if (text[i] === '~' && text[i + 1] === '~' && !esBlanco(text[i - 1])) return i;
    i++;
  }
  return -1;
}

/**
 * `[texto](url "título")`, `[texto][ref]`, `[texto][]` y `[ref]` desde la posición del `[`. `null` si no cierra
 * correctamente (se trata como texto literal). La URL puede ir entre `<>` y contener paréntesis balanceados.
 */
function matchLink(text: string, start: number, budget: Budget): { text: string; url: string; end: number } | null {
  let depthBrackets = 1;
  let j = start + 1;
  while (j < text.length && depthBrackets > 0) {
    budget.steps++;
    if (budget.steps > MAX_INLINE_STEPS) return null;
    if (text[j] === '\\') { j += 2; continue; }
    if (text[j] === '[') depthBrackets++;
    else if (text[j] === ']') { depthBrackets--; if (depthBrackets === 0) break; }
    j++;
  }
  if (depthBrackets !== 0 || j >= text.length) return null;
  const linkText = text.slice(start + 1, j);

  if (text[j + 1] === '(') {
    let k = j + 2;
    while (text[k] === ' ' || text[k] === '\n') k++;
    let url: string;
    if (text[k] === '<') {
      const fin = text.indexOf('>', k + 1);
      if (fin === -1 || text.slice(k, fin).includes('\n')) return null;
      url = text.slice(k + 1, fin);
      k = fin + 1;
    } else {
      const ini = k;
      let parens = 0;
      while (k < text.length && !/\s/.test(text[k]!)) {
        budget.steps++;
        if (budget.steps > MAX_INLINE_STEPS) return null;
        if (text[k] === '\\') { k += 2; continue; }
        if (text[k] === '(') parens++;
        else if (text[k] === ')') { if (parens === 0) break; parens--; }
        k++;
      }
      url = text.slice(ini, k);
    }
    while (text[k] === ' ' || text[k] === '\n') k++;
    const q = text[k];
    if (q === '"' || q === "'" || q === '(') {
      const cierre = q === '(' ? ')' : q;
      const fin = text.indexOf(cierre, k + 1);
      if (fin === -1) return null;
      k = fin + 1;
      while (text[k] === ' ' || text[k] === '\n') k++;
    }
    if (text[k] !== ')') return null;
    return { text: linkText, url, end: k + 1 };
  }

  const refs = budget.ctx?.refs;
  if (!refs || refs.size === 0) return null;
  if (text[j + 1] === '[') {
    const fin = text.indexOf(']', j + 2);
    if (fin === -1 || fin - j > 200) return null;
    const label = text.slice(j + 2, fin);
    const url = refs.get(etiqueta(label === '' ? linkText : label));
    return url === undefined ? null : { text: linkText, url, end: fin + 1 };
  }
  const url = refs.get(etiqueta(linkText));
  return url === undefined ? null : { text: linkText, url, end: j + 1 };
}
