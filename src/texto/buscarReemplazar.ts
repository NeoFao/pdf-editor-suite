/**
 * Lógica PURA de "Buscar y reemplazar" (sin DOM ni motor): dado el texto de
 * los runs de UNA página, localiza las coincidencias de una consulta.
 *
 * Unidad de los desplazamientos: índices UTF-16 dentro de `run.text` (los de
 * `String`), no puntos PDF ni px.
 *
 * Fase actual: solo se reemplaza lo que cae DENTRO de un único run (así
 * `editTextRun` conserva fuente, tamaño, color y posición). Una coincidencia
 * que abarca dos runs (línea partida, palabra cortada) se devuelve como
 * conteo en `cruzan`, para avisar al usuario en vez de callar.
 */

export interface OpcionesBusqueda {
  /** true: distingue mayúsculas de minúsculas. */
  mayusculas: boolean;
  /** true: solo palabras completas (sin letra/dígito/_ pegado a los lados). */
  palabraCompleta: boolean;
}

export interface RunTexto { runId: number; text: string }

/** Coincidencia dentro de un solo run: `[inicio, fin)` en UTF-16 sobre `run.text`. */
export interface Coincidencia { runId: number; inicio: number; fin: number }

export interface ResultadoBusqueda {
  dentro: Coincidencia[];
  /** Coincidencias que abarcan más de un run: se cuentan, no se reemplazan. */
  cruzan: number;
}

const ESCAPAR = /[.*+?^${}()|[\]\\]/g;
/**
 * "Palabra" = ASCII alfanumérico y _, EXACTAMENTE como PDFium
 * (la opción de palabra completa de su búsqueda, que usa el resaltado): una letra con
 * tilde o ñ NO cuenta como parte de la palabra ("año" casa con "a" y con
 * "o" completas). Se alinea con el motor para que buscar, resaltar, contar y
 * reemplazar compartan el mismo criterio (verificado en findText.opciones.test.ts).
 */
const NO_PALABRA = '[A-Za-z0-9_]';

function crearRegex(q: string, o: OpcionesBusqueda): RegExp {
  let src = q.replace(ESCAPAR, '\\$&');
  if (o.palabraCompleta) src = `(?<!${NO_PALABRA})${src}(?!${NO_PALABRA})`;
  return new RegExp(src, o.mayusculas ? 'gu' : 'giu');
}

export function buscarEnRuns(runs: readonly RunTexto[], q: string, o: OpcionesBusqueda): ResultadoBusqueda {
  const res: ResultadoBusqueda = { dentro: [], cruzan: 0 };
  if (!q) return res;
  const re = crearRegex(q, o);

  for (const r of runs) {
    for (const m of r.text.matchAll(re)) {
      res.dentro.push({ runId: r.runId, inicio: m.index!, fin: m.index! + m[0].length });
    }
  }

  // Cruces: se busca sobre la concatenación de los runs (con y sin espacio
  // de unión) y se descarta lo que cae entero en un run (ya contado arriba).
  if (runs.length > 1) {
    const vistos = new Set<string>();
    for (const sep of [' ', '']) {
      const inicios: number[] = [];
      let acc = '';
      runs.forEach((r, i) => { inicios.push(acc.length); acc += r.text + (i < runs.length - 1 ? sep : ''); });
      const indiceDe = (pos: number): number => {
        let k = 0;
        while (k + 1 < inicios.length && inicios[k + 1]! <= pos) k++;
        return k;
      };
      for (const m of acc.matchAll(re)) {
        const ini = m.index!;
        const fin = ini + m[0].length;
        const a = indiceDe(ini);
        const b = indiceDe(fin - 1);
        if (a === b) continue;
        const clave = `${a}:${ini - inicios[a]!}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
        res.cruzan++;
      }
    }
  }
  return res;
}

/** Sustituye cada coincidencia (todas del MISMO run) por `reemplazo`, literal (sin `$&` ni similares). */
export function aplicarReemplazos(texto: string, coincidencias: readonly Coincidencia[], reemplazo: string): string {
  let out = texto;
  const orden = [...coincidencias].sort((x, y) => y.inicio - x.inicio);
  for (const c of orden) out = out.slice(0, c.inicio) + reemplazo + out.slice(c.fin);
  return out;
}
