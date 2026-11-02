/**
 * Algoritmo bidireccional de Unicode (UAX #9) en la medida que necesita el editor, SIN dependencias.
 *
 * Qué cubre: una línea de un solo párrafo, sin marcas de control explícitas (LRE/RLE/LRI…), con las reglas W1-W7, N1-N2,
 * I1-I2 y L2. Qué NO cubre: paréntesis emparejados (N0), espejado de glifos (L4) ni formas contextuales del árabe (eso es
 * del motor de fuentes: un PDF ya trae los glifos elegidos, reescribirlos exige reformar la palabra → no se hace).
 *
 * Dos direcciones:
 *  - `aVisual`: texto LÓGICO (el que teclea y lee el usuario) → orden de PINTADO de izquierda a derecha. Es lo que hay que
 *    escribir en un `Tj` para que se vea bien.
 *  - `ordenLogicoDeVisual`: elementos que solo conocemos en orden VISUAL (las cajas del PDF) → orden lógico. La inversa
 *    de L2 no es única (un número entre latín y hebreo se ve igual pegado a una u otra palabra); se elige la lectura más
 *    habitual (el número sigue a la palabra hebrea que tiene a su derecha) y se VERIFICA con el algoritmo directo: si
 *    no reproduce el orden visual, devuelve `null` y el llamante no inventa nada.
 *
 * Unidades: todo son índices de elementos (puntos de código o objetos de texto), no coordenadas.
 */

export type ClaseBidi = 'L' | 'R' | 'AL' | 'EN' | 'AN' | 'ES' | 'ET' | 'CS' | 'NSM' | 'WS' | 'ON';

/** Nivel base del párrafo: 0 = izquierda a derecha, 1 = derecha a izquierda. */
export type NivelBase = 0 | 1;

function entre(c: number, a: number, b: number): boolean { return c >= a && c <= b; }

/** Clase bidi de un punto de código (subconjunto de `DerivedBidiClass`: lo que aparece en texto cotidiano). */
export function claseBidi(c: number): ClaseBidi {
  if (entre(c, 0x30, 0x39) || entre(c, 0x06f0, 0x06f9)) return 'EN';
  if (entre(c, 0x0660, 0x0669) || c === 0x066b || c === 0x066c) return 'AN';
  if (c === 0x20 || c === 0xa0 || c === 0x09 || entre(c, 0x2000, 0x200a) || c === 0x3000) return 'WS';
  if (c === 0x2b || c === 0x2d || c === 0x2212) return 'ES';
  if (c === 0x23 || c === 0x24 || c === 0x25 || entre(c, 0xa2, 0xa5) || c === 0xb0 || c === 0xb1 || c === 0x2030) return 'ET';
  if (c === 0x2c || c === 0x2e || c === 0x2f || c === 0x3a || c === 0xa0) return 'CS';
  // Marcas combinantes (puntos vocálicos hebreos y árabes).
  if (entre(c, 0x0591, 0x05bd) || c === 0x05bf || entre(c, 0x05c1, 0x05c2) || entre(c, 0x05c4, 0x05c5) || c === 0x05c7
    || entre(c, 0x064b, 0x065f) || c === 0x0670 || entre(c, 0x06d6, 0x06dc) || entre(c, 0x06df, 0x06e4)
    || entre(c, 0x0300, 0x036f)) return 'NSM';
  // Hebreo y otras escrituras de derecha a izquierda (N'Ko, samaritano…) + formas de presentación hebreas.
  if (entre(c, 0x05be, 0x05ff) || entre(c, 0x07c0, 0x085f) || entre(c, 0xfb1d, 0xfb4f) || entre(c, 0x10800, 0x10fff)) return 'R';
  // Árabe y siríaco + formas de presentación A y B.
  if (entre(c, 0x0600, 0x07bf) || entre(c, 0x0860, 0x08ff) || entre(c, 0xfb50, 0xfdff) || entre(c, 0xfe70, 0xfeff)) return 'AL';
  if (c === 0x200f) return 'R';
  if (c === 0x200e) return 'L';
  // Signos y símbolos neutros del ASCII y Latin-1.
  if (c < 0x41 || entre(c, 0x5b, 0x60) || entre(c, 0x7b, 0xbf) || c === 0xd7 || c === 0xf7 || entre(c, 0x2010, 0x2027) || entre(c, 0x2030, 0x205e)) return 'ON';
  return 'L';
}

/** `true` si algún carácter es de derecha a izquierda (hebreo, árabe…). */
export function tieneRtl(texto: string): boolean {
  for (const ch of texto) {
    const k = claseBidi(ch.codePointAt(0)!);
    if (k === 'R' || k === 'AL') return true;
  }
  return false;
}

/** `true` si algún carácter es de la escritura árabe/siríaca: sus glifos cambian de forma según el vecino (no se reescriben). */
export function tieneArabe(texto: string): boolean {
  for (const ch of texto) if (claseBidi(ch.codePointAt(0)!) === 'AL') return true;
  return false;
}

const esFuerte = (k: ClaseBidi): boolean => k === 'L' || k === 'R' || k === 'AL';
const esNeutro = (k: ClaseBidi): boolean => k === 'WS' || k === 'ON';

/**
 * Clase de un objeto de texto entero (para ordenar objetos): la de su primer carácter fuerte (AL cuenta como R); sin
 * fuertes, `EN` si lleva cifras y `WS` si no.
 */
export function claseDeTexto(texto: string): ClaseBidi {
  let cifras = false;
  for (const ch of texto) {
    const k = claseBidi(ch.codePointAt(0)!);
    if (k === 'L') return 'L';
    if (k === 'R' || k === 'AL') return 'R';
    if (k === 'EN' || k === 'AN') cifras = true;
  }
  return cifras ? 'EN' : 'WS';
}

/** Niveles de incrustación (W1-W7, N1-N2, I1-I2) de una secuencia en orden LÓGICO. */
export function nivelesBidi(clases: readonly ClaseBidi[], base: NivelBase): number[] {
  const t: ClaseBidi[] = clases.slice();
  const sos: ClaseBidi = base === 0 ? 'L' : 'R';
  const n = t.length;
  // W1: una marca combinante toma la clase del carácter anterior.
  for (let i = 0; i < n; i++) if (t[i] === 'NSM') t[i] = i > 0 ? t[i - 1]! : sos;
  // W2: EN tras AL pasa a AN. W3: AL pasa a R.
  let fuerte: ClaseBidi = sos;
  for (let i = 0; i < n; i++) {
    if (esFuerte(t[i]!)) fuerte = t[i]!;
    else if (t[i] === 'EN' && fuerte === 'AL') t[i] = 'AN';
  }
  for (let i = 0; i < n; i++) if (t[i] === 'AL') t[i] = 'R';
  // W4: un separador entre dos números del mismo tipo toma ese tipo.
  for (let i = 1; i < n - 1; i++) {
    const prev = t[i - 1], sig = t[i + 1];
    if (t[i] === 'ES' && prev === 'EN' && sig === 'EN') t[i] = 'EN';
    else if (t[i] === 'CS' && (prev === 'EN' || prev === 'AN') && prev === sig) t[i] = prev;
  }
  // W5: una secuencia de ET junto a un EN pasa a EN.
  for (let i = 0; i < n; i++) {
    if (t[i] !== 'ET') continue;
    let j = i;
    while (j < n && t[j] === 'ET') j++;
    if ((i > 0 && t[i - 1] === 'EN') || (j < n && t[j] === 'EN')) for (let k = i; k < j; k++) t[k] = 'EN';
    i = j - 1;
  }
  // W6: separadores y terminadores restantes pasan a neutros.
  for (let i = 0; i < n; i++) if (t[i] === 'ES' || t[i] === 'ET' || t[i] === 'CS') t[i] = 'ON';
  // W7: EN tras L pasa a L.
  fuerte = sos;
  for (let i = 0; i < n; i++) {
    if (t[i] === 'L' || t[i] === 'R') fuerte = t[i]!;
    else if (t[i] === 'EN' && fuerte === 'L') t[i] = 'L';
  }
  // N1-N2: una secuencia de neutros entre dos fuertes de la misma dirección (EN/AN cuentan como R) toma esa dirección;
  // si no, la del párrafo.
  const dir = (k: ClaseBidi): 'L' | 'R' => (k === 'L' ? 'L' : 'R');
  const dirBase: 'L' | 'R' = base === 0 ? 'L' : 'R';
  for (let i = 0; i < n; i++) {
    if (!esNeutro(t[i]!)) continue;
    let j = i;
    while (j < n && esNeutro(t[j]!)) j++;
    const antes = i > 0 ? dir(t[i - 1]!) : dirBase;
    const despues = j < n ? dir(t[j]!) : dirBase;
    const d = antes === despues ? antes : dirBase;
    for (let k = i; k < j; k++) t[k] = d;
    i = j - 1;
  }
  // I1-I2.
  return t.map((k) => {
    if (base === 0) return k === 'R' ? 1 : k === 'EN' || k === 'AN' ? 2 : 0;
    return k === 'R' ? 1 : k === 'L' || k === 'EN' || k === 'AN' ? 2 : 1;
  });
}

/** L2: orden visual (izquierda a derecha) de una línea con estos niveles; `r[v]` = índice lógico del elemento en la posición visual `v`. */
export function ordenVisualDeNiveles(niveles: readonly number[]): number[] {
  const orden = niveles.map((_, i) => i);
  if (orden.length === 0) return orden;
  const max = Math.max(...niveles);
  let minImpar = Infinity;
  for (const l of niveles) if (l % 2 === 1 && l < minImpar) minImpar = l;
  for (let l = max; l >= minImpar; l--) invertirTramos(orden, niveles, l);
  return orden;
}

/** Invierte, sobre `orden`, cada tramo contiguo de elementos cuyo nivel (`niveles[elemento]`) es ≥ `l`. */
function invertirTramos(orden: number[], niveles: readonly number[], l: number): void {
  for (let i = 0; i < orden.length; i++) {
    if (niveles[orden[i]!]! < l) continue;
    let j = i;
    while (j < orden.length && niveles[orden[j]!]! >= l) j++;
    const trozo = orden.slice(i, j).reverse();
    for (let k = 0; k < trozo.length; k++) orden[i + k] = trozo[k]!;
    i = j - 1;
  }
}

/** Texto LÓGICO → cadena en el orden en que se PINTA de izquierda a derecha (sin espejar paréntesis). */
export function aVisual(texto: string, base: 'ltr' | 'rtl'): string {
  const chars = Array.from(texto);
  if (chars.length === 0) return texto;
  const b: NivelBase = base === 'rtl' ? 1 : 0;
  const niveles = nivelesBidi(chars.map((c) => claseBidi(c.codePointAt(0)!)), b);
  return ordenVisualDeNiveles(niveles).map((i) => chars[i]!).join('');
}

/**
 * Nivel base del párrafo a partir de elementos en orden visual. Extremos de la misma dirección mandan (LTR o RTL); con
 * extremos distintos manda la mayoría de elementos fuertes, y en empate LTR.
 */
export function baseDeVisual(clases: readonly ClaseBidi[]): NivelBase {
  const fuertes = clases.filter(esFuerte).map((k) => (k === 'L' ? 'L' : 'R'));
  if (fuertes.length === 0) return 0;
  const primero = fuertes[0]!, ultimo = fuertes[fuertes.length - 1]!;
  if (primero === ultimo) return primero === 'R' ? 1 : 0;
  const r = fuertes.filter((k) => k === 'R').length;
  return r > fuertes.length - r ? 1 : 0;
}

/**
 * Orden LÓGICO de elementos conocidos solo en orden visual. `r[k]` = índice visual del elemento que va en la posición lógica
 * `k`. Asigna niveles desde lo visible, invierte L2 y comprueba que el algoritmo directo devuelve el orden visual de
 * partida; si no, `null` (el llamante conserva el orden visual y avisa).
 */
export function ordenLogicoDeVisual(clasesVisuales: readonly ClaseBidi[], base: NivelBase): number[] | null {
  const n = clasesVisuales.length;
  if (n === 0) return [];
  const dirBase: 'L' | 'R' = base === 0 ? 'L' : 'R';
  const dirDe = (k: ClaseBidi): 'L' | 'R' | null => (k === 'L' ? 'L' : k === 'R' || k === 'AL' || k === 'EN' || k === 'AN' ? 'R' : null);
  const nivelDeDir = (d: 'L' | 'R'): number => (d === 'R' ? 1 : base === 0 ? 0 : 2);
  const niveles: number[] = new Array(n).fill(0);
  // Dirección efectiva de cada elemento para los neutros (W7 incluido): una cifra tras una palabra latina ES latina.
  const dirEf: ('L' | 'R' | null)[] = clasesVisuales.map((k) => dirDe(k));
  for (let i = 0; i < n; i++) {
    const k = clasesVisuales[i]!;
    if (k === 'L') niveles[i] = nivelDeDir('L');
    else if (k === 'R' || k === 'AL') niveles[i] = 1;
    else if (k === 'EN' || k === 'AN') {
      if (base === 1) {
        // RTL: toda cifra va en nivel 2; es «latina» para los neutros si lo fuerte anterior a su izquierda es latino (W7).
        niveles[i] = 2;
        let j = i - 1;
        while (j >= 0 && (esNeutro(clasesVisuales[j]!) || clasesVisuales[j] === 'EN' || clasesVisuales[j] === 'AN')) j--;
        if (k === 'EN' && j >= 0 && clasesVisuales[j] === 'L') dirEf[i] = 'L';
      } else if (k === 'AN') {
        niveles[i] = 2;
      } else {
        // LTR: la cifra sigue a la palabra hebrea que tiene a su derecha (lectura habitual); si no, a la latina de su izquierda.
        let j = i + 1;
        while (j < n && (clasesVisuales[j] === 'EN' || clasesVisuales[j] === 'AN' || esNeutro(clasesVisuales[j]!))) j++;
        const conHebreo = j < n && (clasesVisuales[j] === 'R' || clasesVisuales[j] === 'AL');
        niveles[i] = conHebreo ? 2 : 0;
        dirEf[i] = conHebreo ? 'R' : 'L';
      }
    }
  }
  // Neutros: entre dos elementos de la misma dirección toman esa; si no, la del párrafo.
  for (let i = 0; i < n; i++) {
    if (dirEf[i] !== null) continue;
    let j = i;
    while (j < n && dirEf[j] === null) j++;
    const antes = i > 0 ? dirEf[i - 1]! : dirBase;
    const despues = j < n ? dirEf[j]! : dirBase;
    const d = antes === despues ? antes : dirBase;
    for (let q = i; q < j; q++) niveles[q] = nivelDeDir(d);
    i = j - 1;
  }
  // Inversa de L2: se aplican las mismas inversiones en el orden contrario (del nivel impar más bajo al más alto).
  const orden = Array.from({ length: n }, (_, i) => i);
  const max = Math.max(...niveles);
  let minImpar = Infinity;
  for (const l of niveles) if (l % 2 === 1 && l < minImpar) minImpar = l;
  for (let l = Number.isFinite(minImpar) ? minImpar : max + 1; l <= max; l++) invertirTramos(orden, niveles, l);
  // Verificación con el algoritmo directo: el texto lógico propuesto debe pintarse en el orden visual dado.
  const logicas = orden.map((v) => clasesVisuales[v]!);
  const directo = ordenVisualDeNiveles(nivelesBidi(logicas, base));
  for (let v = 0; v < n; v++) if (orden[directo[v]!] !== v) return null;
  return orden;
}

/**
 * Texto LÓGICO de unos caracteres con su posición horizontal `x` (pt, el borde izquierdo de cada caja), dados en cualquier
 * orden. Se ordenan por `x` (= orden visual) y se invierte L2. Si la inversión no se puede verificar se devuelve el
 * texto en el orden recibido (el del motor), que para texto sin RTL es ya el correcto.
 */
export function logicoDeCajas(items: readonly { ch: string; x: number }[]): string {
  if (items.length < 2) return items.map((i) => i.ch).join('');
  const visual = items.slice().sort((a, b) => a.x - b.x); // estable
  const clases = visual.map((i) => claseBidi(i.ch.codePointAt(0) ?? 0x20));
  const orden = ordenLogicoDeVisual(clases, baseDeVisual(clases));
  if (!orden) return items.map((i) => i.ch).join('');
  return orden.map((v) => visual[v]!.ch).join('');
}
