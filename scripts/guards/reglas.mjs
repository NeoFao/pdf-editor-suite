/**
 * Reglas deterministas del repositorio.
 *
 * Cada regla nace de un defecto real (docs/ERRORES-CONOCIDOS.md) y bloquea el
 * PATRÓN que lo produjo, no solo la instancia concreta. Una regla sin su
 * entrada en ERRORES-CONOCIDOS.md no debería existir, y un error corregido sin
 * regla ni test volverá.
 *
 * Cada regla exporta: { id, titulo, comoArreglar, ejecutar() -> hallazgos[] }
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { RAIZ, leer, existe, fuentesApp, lineasExentas, hallazgo, deuda, tieneDeuda } from './lib.mjs';

/* ── E-003 / E-001 · innerHTML con datos interpolados ───────────────────── */
export const sinInnerHtmlInterpolado = {
  id: 'no-innerhtml-interpolado',
  titulo: 'innerHTML nunca recibe datos del documento',
  comoArreglar:
    'Construye el nodo con document.createElement y asigna el texto con textContent. ' +
    'Interpolar en innerHTML inyecta marcado Y mete nodos de texto con saltos de línea ' +
    'que rompen la maquetación (E-001, E-003).',
  ejecutar() {
    const hallazgos = [];
    for (const archivo of fuentesApp()) {
      if (tieneDeuda(archivo, this.id)) continue;
      const contenido = leer(archivo);
      const exentas = lineasExentas(contenido, this.id);
      contenido.split('\n').forEach((linea, i) => {
        const n = i + 1;
        if (exentas.has(n)) return;
        // innerHTML/insertAdjacentHTML asignando una plantilla con ${...}
        if (/\.(innerHTML|outerHTML)\s*=\s*`[^`]*\$\{/.test(linea)) {
          hallazgos.push(hallazgo(archivo, n, 'innerHTML con interpolación `${...}`'));
        }
        if (/insertAdjacentHTML\([^)]*`[^`]*\$\{/.test(linea)) {
          hallazgos.push(hallazgo(archivo, n, 'insertAdjacentHTML con interpolación'));
        }
      });

      // Plantillas multilínea: se detectan por el bloque completo.
      const bloques = contenido.matchAll(/\.(innerHTML|outerHTML)\s*=\s*`([\s\S]*?)`/g);
      for (const m of bloques) {
        if (!m[2].includes('${')) continue;
        const linea = contenido.slice(0, m.index).split('\n').length;
        if (exentas.has(linea) || hallazgos.some((h) => h.archivo === archivo && h.linea === linea)) continue;
        hallazgos.push(hallazgo(archivo, linea, 'plantilla innerHTML multilínea con interpolación'));
      }
    }
    return hallazgos;
  }
};

/* ── E-016 · miembros de clase duplicados ───────────────────────────────── */
export const sinMiembrosDuplicados = {
  id: 'no-miembros-duplicados',
  titulo: 'ninguna clase declara dos veces el mismo método',
  comoArreglar:
    'Fusiona las dos definiciones en una. JavaScript se queda callado con la última ' +
    'y la primera desaparece: así murió todo el cableado móvil (E-016).',
  ejecutar() {
    const hallazgos = [];
    for (const archivo of fuentesApp()) {
      const lineas = leer(archivo).split('\n');
      const vistos = new Map();
      let claseActual = null;

      lineas.forEach((linea, i) => {
        const clase = linea.match(/^\s*class\s+(\w+)/);
        if (clase) { claseActual = clase[1]; vistos.set(claseActual, new Map()); }
        if (!claseActual) return;

        // Método a nivel de clase: exactamente dos espacios de sangría.
        const metodo = linea.match(/^ {2}(?:async\s+|static\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\(/);
        if (!metodo) return;
        const nombre = metodo[1];
        if (['if', 'for', 'while', 'switch', 'catch', 'return'].includes(nombre)) return;

        const tabla = vistos.get(claseActual);
        if (tabla.has(nombre)) {
          hallazgos.push(hallazgo(archivo, i + 1, `"${nombre}" ya estaba definido en la línea ${tabla.get(nombre)} de class ${claseActual}`));
        } else {
          tabla.set(nombre, i + 1);
        }
      });
    }
    return hallazgos;
  }
};

/* ── E-021 · ficheros JS que nadie carga ────────────────────────────────── */
export const sinCodigoMuerto = {
  id: 'no-codigo-muerto',
  titulo: 'todo js/**.js está referenciado desde index.html',
  comoArreglar:
    'Bórralo o cárgalo. Código que nadie ejecuta se pudre: apunta a IDs que ya no ' +
    'existen y confunde a la siguiente persona (o IA) que lea el repo (E-021).',
  ejecutar() {
    const html = leer('index.html');
    const permitidos = new Set(['js/pdf.min.js', 'js/pdf.worker.min.js']);
    return fuentesApp()
      .filter((f) => !permitidos.has(f))
      .filter((f) => !tieneDeuda(f, this.id))
      .filter((f) => !html.includes(f))
      .map((f) => hallazgo(f, null, 'no lo carga ningún <script> de index.html'));
  }
};

/* ── E-019 · controles del HTML sin manejador ───────────────────────────── */
export const sinControlesHuerfanos = {
  id: 'no-controles-huerfanos',
  titulo: 'todo control interactivo con id tiene código detrás',
  comoArreglar:
    'Conéctalo en app.js o quítalo del HTML. Un botón que no hace nada es peor que ' +
    'no tenerlo: el usuario cree que la función existe (E-019).',
  ejecutar() {
    const html = leer('index.html');
    const js = fuentesApp().map(leer).join('\n');

    const hallazgos = [];
    // Solo elementos que el usuario puede accionar.
    const etiquetas = html.matchAll(/<(button|input|select|textarea)\b[^>]*\bid="([^"]+)"[^>]*>/g);
    for (const m of etiquetas) {
      const id = m[2];
      if (js.includes(`'${id}'`) || js.includes(`"${id}"`) || js.includes(`\`${id}\``)) continue;
      // Un id construido dinámicamente (p. ej. `ribbon-sec-${tab}`) cuenta como usado.
      const porPlantilla = js.match(/`[^`]*\$\{[^}]+\}[^`]*`/g) || [];
      const prefijos = porPlantilla.map((p) => p.slice(1, p.indexOf('${')));
      if (prefijos.some((p) => p.length > 3 && id.startsWith(p))) continue;

      const linea = html.slice(0, m.index).split('\n').length;
      hallazgos.push(hallazgo('index.html', linea, `<${m[1]} id="${id}"> no aparece en ningún .js`));
    }
    return hallazgos;
  }
};

/* ── E-022 · clases de Tailwind inexistentes ────────────────────────────── */
export const sinClasesInventadas = {
  id: 'no-clases-inventadas',
  titulo: 'las clases usadas existen en el CSS compilado',
  comoArreglar:
    'Usa una utilidad real de Tailwind v3 o define la clase en css/styles.css y ' +
    'recompila (npm run build). `border-3` y `backdrop-blur-xs` no existen: se ' +
    'veían escritas y no pintaban nada (E-022).',
  ejecutar() {
    const compilado = leer('css/tailwind.min.css') + leer('css/styles.css');
    const fuentes = ['index.html', ...fuentesApp()];
    const hallazgos = [];
    const yaVistas = new Set();

    // Utilidades con sufijo numérico o de escala: son las que se inventan.
    const sospechosas = /^(border|backdrop-blur|blur|rounded|gap|leading|tracking|z|opacity|ring|shadow)-[a-z0-9]+$/;

    for (const archivo of fuentes) {
      const contenido = leer(archivo);
      for (const m of contenido.matchAll(/class(?:Name)?="([^"]+)"/g)) {
        for (const bruta of m[1].split(/\s+/)) {
          const clase = bruta.replace(/^[a-z-]+:/, '').replace(/^!/, '');
          if (!clase || yaVistas.has(clase) || !sospechosas.test(clase)) continue;
          yaVistas.add(clase);
          // Tailwind emite la variante escapada (`.disabled\:opacity-30:disabled`),
          // por eso el carácter previo puede ser `.`, `\` o `:`. Y el límite de
          // la derecha es imprescindible: sin él `blur-2` casaría con `blur-2xl`.
          const literal = clase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          if (new RegExp(`[.\\\\:]${literal}(?![\\w-])`).test(compilado)) continue;
          const linea = contenido.slice(0, m.index).split('\n').length;
          hallazgos.push(hallazgo(archivo, linea, `la clase "${clase}" no existe en el CSS compilado`));
        }
      }
    }
    return hallazgos;
  }
};

/* ── E-014 · recursos que se abren y no se cierran ──────────────────────── */
export const conLiberacionDeRecursos = {
  id: 'liberar-recursos',
  titulo: 'los recursos pesados se liberan',
  comoArreglar:
    'Cada pdfjsLib.getDocument() necesita su destroy(); cada addEventListener sobre ' +
    'window dentro de una fábrica por elemento necesita su removeEventListener. Si no, ' +
    'cada rotación deja un worker vivo con el PDF entero dentro (E-014, E-020).',
  ejecutar() {
    const hallazgos = [];
    for (const archivo of fuentesApp()) {
      if (tieneDeuda(archivo, this.id)) continue;
      const contenido = leer(archivo);
      const abre = (contenido.match(/pdfjsLib\.getDocument\(/g) || []).length;
      const cierra = (contenido.match(/\.destroy\(\)/g) || []).length;
      if (abre > 0 && cierra === 0) {
        hallazgos.push(hallazgo(archivo, null, `${abre} llamada(s) a getDocument() y ningún destroy()`));
      }

      const globales = (contenido.match(/window\.addEventListener\(\s*['"](pointermove|pointerup|mousemove|mouseup)['"]/g) || []).length;
      const quitados = (contenido.match(/window\.removeEventListener\(\s*['"](pointermove|pointerup|mousemove|mouseup)['"]/g) || []).length;
      if (globales > quitados) {
        hallazgos.push(hallazgo(archivo, null, `${globales} listener(s) globales de puntero y solo ${quitados} removeEventListener`));
      }
    }
    return hallazgos;
  }
};

/* ── Cache busting coherente con la versión del paquete ─────────────────── */
export const conVersionesCoherentes = {
  id: 'versiones-coherentes',
  titulo: 'los ?v= de index.html coinciden con package.json',
  comoArreglar:
    'Sube la versión en package.json y actualiza todos los ?v= con npm run version:sync. ' +
    'Un ?v= viejo sirve JS antiguo desde la caché y hace parecer que el arreglo no funcionó.',
  ejecutar() {
    const version = JSON.parse(leer('package.json')).version;
    const html = leer('index.html');
    const hallazgos = [];
    for (const m of html.matchAll(/(?:href|src)="([^"?]+)\?v=([^"]+)"/g)) {
      if (m[2] !== version) {
        const linea = html.slice(0, m.index).split('\n').length;
        hallazgos.push(hallazgo('index.html', linea, `${m[1]} usa ?v=${m[2]} y package.json dice ${version}`));
      }
    }
    // Todo asset propio versionable debe llevar ?v=
    for (const m of html.matchAll(/(?:href|src)="((?:css|js)\/[^"?]+\.(?:css|js))"/g)) {
      const linea = html.slice(0, m.index).split('\n').length;
      hallazgos.push(hallazgo('index.html', linea, `${m[1]} no lleva ?v=${version}`));
    }
    return hallazgos;
  }
};

/* ── Rutas prohibidas en el repositorio ─────────────────────────────────── */
export const sinRutasProhibidas = {
  id: 'rutas-prohibidas',
  titulo: 'el repositorio no contiene secretos ni basura de sesión',
  comoArreglar: 'Borra el fichero del índice y añádelo a .gitignore.',
  ejecutar() {
    const seguidos = execSync('git ls-files', { cwd: RAIZ, encoding: 'utf8' }).split('\n').filter(Boolean);
    const patrones = [
      [/(^|\/)\.env(\.[^/]+)?$/, 'fichero .env', /(^|\/)\.env\.example$/],
      [/\.(pem|key|pfx|p12)$/, 'clave o certificado'],
      [/^[^/]+\.(png|jpe?g|webp|gif)$/, 'captura suelta en la raíz'],
      [/^tests\/fixtures\/generados\//, 'fixture generado (se regenera, no se versiona)'],
      [/^(playwright-report|test-results)\//, 'informe de test'],
      [/^_.*\.(js|mjs|pdf|txt)$/, 'fichero temporal de sesión (prefijo _)']
    ];
    const hallazgos = [];
    for (const f of seguidos) {
      for (const [re, motivo, excepcion] of patrones) {
        if (re.test(f) && !(excepcion && excepcion.test(f))) hallazgos.push(hallazgo(f, null, motivo));
      }
    }
    return hallazgos;
  }
};

/* ── Espejos de reglas para asistentes de IA sincronizados ──────────────── */
export const conEspejosSincronizados = {
  id: 'espejos-ia-sincronizados',
  titulo: 'todos los asistentes de IA leen las mismas reglas',
  comoArreglar:
    'Ejecuta npm run reglas:sync. AGENTS.md es la fuente; los demás ficheros son ' +
    'copias generadas para Claude, Gemini, Copilot, Cursor, Cline, Windsurf y Kiro. ' +
    'Si uno se queda atrás, esa IA trabaja con reglas viejas.',
  ejecutar() {
    const canonico = leer('AGENTS.md');
    const marca = canonico.match(/<!-- huella:([a-f0-9]+) -->/);
    const espejos = [
      'CLAUDE.md',
      'GEMINI.md',
      '.github/copilot-instructions.md',
      '.cursor/rules/pdf-editor.mdc',
      '.clinerules/pdf-editor.md',
      '.windsurf/rules/pdf-editor.md',
      '.kiro/steering/pdf-editor.md'
    ];
    const hallazgos = [];
    if (!marca) {
      hallazgos.push(hallazgo('AGENTS.md', null, 'falta la marca <!-- huella:... -->; regenera con npm run reglas:sync'));
      return hallazgos;
    }
    for (const espejo of espejos) {
      if (!existe(espejo)) { hallazgos.push(hallazgo(espejo, null, 'falta el espejo')); continue; }
      if (!leer(espejo).includes(`<!-- huella:${marca[1]} -->`)) {
        hallazgos.push(hallazgo(espejo, null, 'desincronizado respecto a AGENTS.md'));
      }
    }
    return hallazgos;
  }
};

/* ── Cada regla tiene su entrada documentada ────────────────────────────── */
export const conErroresDocumentados = {
  id: 'errores-documentados',
  titulo: 'cada regla está justificada en docs/ERRORES-CONOCIDOS.md',
  comoArreglar:
    'Añade la entrada del defecto (síntoma, causa raíz, regla, test) antes de crear ' +
    'la regla. Una regla sin historia se borra en cuanto estorbe.',
  ejecutar() {
    const doc = leer('docs/ERRORES-CONOCIDOS.md');
    return TODAS.filter((r) => !doc.includes(r.id))
      .map((r) => hallazgo('docs/ERRORES-CONOCIDOS.md', null, `no menciona la regla "${r.id}"`));
  }
};

/* ── La suite E2E no puede quedarse vacía ni desactivada ────────────────── */
export const conSuiteViva = {
  id: 'suite-viva',
  titulo: 'la suite E2E existe y no tiene tests desactivados',
  comoArreglar:
    'Ningún .skip / .fixme / .only puede llegar a main. Si un test estorba, arregla ' +
    'el código o borra el test explicándolo en el PR: no lo silencies.',
  ejecutar() {
    const dir = path.join(RAIZ, 'tests/e2e');
    if (!fs.existsSync(dir)) return [hallazgo('tests/e2e', null, 'no existe la suite E2E')];
    const specs = fs.readdirSync(dir).filter((f) => f.endsWith('.spec.js'));
    if (specs.length === 0) return [hallazgo('tests/e2e', null, 'no hay ningún .spec.js')];

    const hallazgos = [];
    for (const spec of specs) {
      const contenido = fs.readFileSync(path.join(dir, spec), 'utf8');
      contenido.split('\n').forEach((linea, i) => {
        if (/\b(test|describe)\.(skip|fixme|only)\b/.test(linea)) {
          hallazgos.push(hallazgo(`tests/e2e/${spec}`, i + 1, 'test desactivado o exclusivo'));
        }
      });
    }
    return hallazgos;
  }
};

/* ── La deuda declarada solo puede encoger ──────────────────────────────── */
export const conDeudaAcotada = {
  id: 'deuda-acotada',
  titulo: 'la lista de excepciones no crece',
  comoArreglar:
    'Resuelve la deuda en vez de añadir otra entrada. Si de verdad hace falta una ' +
    'excepción nueva, la aprueba el responsable del repo y sube `maximo_entradas` ' +
    'de forma explícita en el mismo PR. Una IA nunca añade entradas aquí para ' +
    'poner el CI en verde (AGENTS.md §3).',
  ejecutar() {
    const d = deuda();
    const hallazgos = [];

    if (d.entradas.length > d.maximo_entradas) {
      hallazgos.push(hallazgo(
        'scripts/guards/deuda-tecnica.json', null,
        `${d.entradas.length} entradas frente a un máximo de ${d.maximo_entradas}`
      ));
    }

    d.entradas.forEach((e, i) => {
      if (!existe(e.ruta)) {
        hallazgos.push(hallazgo('scripts/guards/deuda-tecnica.json', null,
          `la entrada ${i + 1} apunta a "${e.ruta}", que ya no existe: bórrala`));
      }
      if (!e.motivo || e.motivo.length < 40) {
        hallazgos.push(hallazgo('scripts/guards/deuda-tecnica.json', null,
          `la entrada de "${e.ruta}" necesita un "motivo" que explique el porqué`));
      }
      if (!e.resolucion || e.resolucion.length < 20) {
        hallazgos.push(hallazgo('scripts/guards/deuda-tecnica.json', null,
          `la entrada de "${e.ruta}" necesita una "resolucion": cómo se salda`));
      }
    });

    return hallazgos;
  }
};

/* ── E-027 · CVE-2024-4367 · pdf.js compilando fuentes con eval ─────────── */
export const conPdfJsSinEval = {
  id: 'pdfjs-sin-eval',
  titulo: 'pdf.js se carga con isEvalSupported: false',
  comoArreglar:
    'Añade isEvalSupported: false a las opciones de pdfjsLib.getDocument(). Sin él, ' +
    'pdf.js compila las expresiones de fuente con eval() y un PDF manipulado puede ' +
    'ejecutar código en la página (CVE-2024-4367). La promesa "ningún PDF sale del ' +
    'equipo del usuario" depende de que esto no ocurra.',
  ejecutar() {
    const hallazgos = [];
    for (const archivo of fuentesApp()) {
      if (tieneDeuda(archivo, this.id)) continue;
      const contenido = leer(archivo);
      const exentas = lineasExentas(contenido, this.id);
      const lineas = contenido.split('\n');
      lineas.forEach((linea, i) => {
        const pos = linea.indexOf('.getDocument(');
        if (pos < 0) return;
        // Menciones en comentarios (// … getDocument()) no son llamadas reales.
        const comentario = linea.indexOf('//');
        if (comentario >= 0 && comentario < pos) return;
        const n = i + 1;
        if (exentas.has(n)) return;
        // La llamada abre un objeto de opciones que suele ocupar varias líneas.
        const ventana = lineas.slice(i, i + 25).join('\n');
        if (!/isEvalSupported\s*:\s*false/.test(ventana)) {
          hallazgos.push(hallazgo(archivo, n, 'getDocument() sin isEvalSupported: false (CVE-2024-4367)'));
        }
      });
    }
    return hallazgos;
  }
};

/* ── Cimientos · el motor se usa solo tras su interfaz ──────────────────── */
export const conMotorEncapsulado = {
  id: 'motor-encapsulado',
  titulo: 'la API cruda FPDF_ solo aparece en src/engine',
  comoArreglar:
    'Llama al motor a través de la interfaz PdfEngine (o de un comando), nunca a ' +
    'FPDF_* directamente. Toda la arquitectura nueva se apoya en que el motor sea ' +
    'reemplazable detrás de esa capa: si la UI, el modelo o los comandos usan FPDF_ ' +
    'directo, la capa deja de aislar (spec de cimientos §3).',
  ejecutar() {
    const raizSrc = path.join(RAIZ, 'src');
    if (!fs.existsSync(raizSrc)) return [];
    const hallazgos = [];
    const recorrer = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { recorrer(full); continue; }
        if (!e.name.endsWith('.ts')) continue;
        const rel = path.relative(RAIZ, full).replace(/\\/g, '/');
        if (rel.startsWith('src/engine/')) continue; // único lugar permitido
        leer(rel).split('\n').forEach((linea, i) => {
          if (/\bFPDF[A-Za-z_]/.test(linea)) {
            hallazgos.push(hallazgo(rel, i + 1, 'usa la API cruda FPDF_ fuera de src/engine'));
          }
        });
      }
    };
    recorrer(raizSrc);
    return hallazgos;
  }
};

/* ── E-028 · getters de cadena de PDFium con buffer de tamaño fijo ─────── */
export const conPdfiumBufferFijo = {
  id: 'pdfium-buffer-fijo',
  titulo: 'los getters de cadena de PDFium usan el patrón de dos llamadas',
  comoArreglar:
    'Llama primero con (buffer=0, buflen=0) para saber el tamaño exacto, reserva ' +
    'justo eso y vuelve a llamar. PDFium no trunca un buffer insuficiente: lo deja ' +
    'sin rellenar, así que un tamaño fijo devuelve memoria sin inicializar, no un ' +
    'texto cortado (E-028). Usa leerCadenaPdfium() de src/engine/pdfium/mem.ts.',
  ejecutar() {
    const raizSrc = path.join(RAIZ, 'src');
    if (!fs.existsSync(raizSrc)) return [];
    const hallazgos = [];
    // Getters de cadena de PDFium: su último argumento es el tamaño del buffer.
    const patron = /FPDF\w*_Get\w*(?:Text|Name|StringValue|MetaText|Label)\w*\(([^)]*)\)/g;
    const recorrer = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { recorrer(full); continue; }
        if (!e.name.endsWith('.ts')) continue;
        const rel = path.relative(RAIZ, full).replace(/\\/g, '/');
        const contenido = leer(rel);
        if (tieneDeuda(rel, this.id)) continue;
        const exentas = lineasExentas(contenido, this.id);
        contenido.split('\n').forEach((linea, i) => {
          const n = i + 1;
          if (exentas.has(n)) return;
          for (const m of linea.matchAll(patron)) {
            const args = m[1].split(',').map((a) => a.trim());
            const ultimo = args[args.length - 1];
            // Un literal numérico distinto de 0 es un tamaño de buffer fijo.
            // "0" (llamada de sondeo) o un identificador (p. ej. "needed") no lo son.
            if (/^\d+$/.test(ultimo) && Number(ultimo) !== 0) {
              hallazgos.push(hallazgo(rel, n, `buffer de tamaño fijo (${ultimo}) en "${m[0]}"`));
            }
          }
        });
      }
    };
    recorrer(raizSrc);
    return hallazgos;
  }
};

/* ── E-032 · toda navegación de página pasa por App.goToPage() ─────────── */
export const conNavegacionPorGoToPage = {
  id: 'navegacion-por-gotopage',
  titulo: 'Viewer.scrollToPage() solo se llama desde dentro de App.goToPage()',
  comoArreglar:
    'Llama a this.goToPage(i), nunca a this.viewer?.scrollToPage(i) directamente. ' +
    'goToPage() fija currentPage, el indicador y la miniatura activa ANTES de tocar ' +
    'el scroll; si algo llama a scrollToPage() por fuera, currentPage se queda ' +
    'desincronizado en cuanto el scroll no se mueve o el observer elige otra página ' +
    '— el defecto destructivo de E-032 (clic en una miniatura y "Eliminar página" ' +
    'borraba otra distinta).',
  ejecutar() {
    const ruta = 'src/ui/App.ts';
    if (!existe(ruta)) return [];
    const contenido = leer(ruta);
    if (tieneDeuda(ruta, this.id)) return [];
    const exentas = lineasExentas(contenido, this.id);
    const lineas = contenido.split('\n');

    // Rango (0-indexed) del cuerpo de goToPage, por conteo de llaves: la
    // única línea con "scrollToPage(" permitida en todo el fichero cae ahí.
    const inicio = lineas.findIndex((l) => /\bgoToPage\(/.test(l) && /\bprivate\b/.test(l));
    if (inicio === -1) {
      return [hallazgo(ruta, null, 'no se encuentra el método goToPage() — la regla no puede verificar el invariante')];
    }
    let profundidad = 0;
    let fin = lineas.length - 1;
    for (let i = inicio; i < lineas.length; i++) {
      for (const ch of lineas[i]) {
        if (ch === '{') profundidad++;
        else if (ch === '}') {
          profundidad--;
          if (profundidad === 0) { fin = i; break; }
        }
      }
      if (profundidad === 0 && fin !== lineas.length - 1) break;
    }

    const hallazgos = [];
    lineas.forEach((linea, i) => {
      const n = i + 1;
      if (exentas.has(n)) return;
      if (!/\.scrollToPage\(/.test(linea)) return;
      if (i >= inicio && i <= fin) return; // dentro de goToPage: permitido
      hallazgos.push(hallazgo(ruta, n, 'llama a scrollToPage() fuera de goToPage()'));
    });
    return hallazgos;
  }
};

/* ── E-033 · el webServer de la app nueva nunca reutiliza un preview rancio ─ */
export const conWebServerNextSinReusar = {
  id: 'webserver-next-no-reusar',
  titulo: 'el webServer de build:next en playwright.config.js no reutiliza un proceso vivo',
  comoArreglar:
    'Pon reuseExistingServer: false en la entrada de webServer cuyo command contenga ' +
    '"build:next". A diferencia de `node server.js` (sirve el disco en vivo), ese ' +
    'comando sirve un dist/ congelado en el momento del build: reutilizar un ' +
    '`vite preview` que quedó vivo de una sesión anterior salta el build por ' +
    'completo y los tests de tests/e2e/next/ corren contra código que ya no existe ' +
    '— npm run verify dando un resultado falso (E-033, visto en el PR #52). Si el ' +
    'puerto está ocupado, libéralo con npm run e2e:liberar.',
  ejecutar() {
    const ruta = 'playwright.config.js';
    if (!existe(ruta)) return [];
    if (tieneDeuda(ruta, this.id)) return [];
    const contenido = leer(ruta);

    // Heurística por texto, no un parser de JS: localiza el array webServer y
    // separa sus entradas por la aparición de "command:", que en este fichero
    // es siempre la primera propiedad de cada objeto. Límite conocido nº1: si
    // algún día una entrada NO empieza por "command:" como primera propiedad,
    // el trozo previo queda mezclado con la entrada anterior y la regla podría
    // no aislar bien esa entrada. Límite conocido nº2: cada trozo se extiende
    // hasta el siguiente "command:", así que puede arrastrar el comentario que
    // precede a la entrada siguiente (como el de esta misma regla, que
    // menciona "build:next" en prosa) — por eso el criterio de "es la entrada
    // de la app nueva" exige ver el literal build:next DENTRO del propio valor
    // de command (comillas), no en cualquier parte del trozo. Con dos entradas
    // fijas y bien conocidas hoy es suficiente; si esto crece, conviene un
    // parser real (p. ej. de AST).
    const bloque = contenido.match(/webServer\s*:\s*\[([\s\S]*?)\n\s*\]/);
    if (!bloque) {
      return [hallazgo(ruta, null, 'no se encuentra el array webServer — la regla no puede verificar el invariante')];
    }
    const cuerpo = bloque[1];
    const inicioCuerpo = contenido.indexOf(cuerpo, bloque.index);
    const partes = cuerpo.split(/(?=\bcommand\s*:)/).filter((e) => /\bcommand\s*:/.test(e));

    const hallazgos = [];
    let cursor = 0;
    for (const entrada of partes) {
      const posLocal = cuerpo.indexOf(entrada, cursor);
      cursor = posLocal + entrada.length;
      if (!/command\s*:\s*['"][^'"]*build:next[^'"]*['"]/.test(entrada)) continue;
      if (/reuseExistingServer\s*:\s*false\b/.test(entrada)) continue;
      const linea = contenido.slice(0, inicioCuerpo + posLocal).split('\n').length;
      hallazgos.push(hallazgo(ruta, linea, 'webServer de build:next no tiene reuseExistingServer: false'));
    }
    return hallazgos;
  }
};

/* ── E-034 · todo gesto de puntero pasa por el helper que trata pointercancel ── */
export const conGestoConCancelacion = {
  id: 'gesto-con-cancelacion',
  titulo: 'ningún fichero enganche pointermove/pointerup de window o document a mano',
  comoArreglar:
    'Usa registrarGesto() de src/ui/gesto.ts en vez de window.addEventListener/' +
    'document.addEventListener directos para pointermove/pointerup/pointercancel. ' +
    'Un gesto que solo escucha pointerup se queda colgado para siempre si el ' +
    'navegador manda pointercancel en su lugar (gesto táctil interrumpido, cambio de ' +
    'pestaña, pérdida de la captura del puntero): ni retira sus listeners (fuga, ' +
    '§2.6/E-014/E-020) ni deshace su vista previa (E-034). Centralizar el enganche en ' +
    'un único fichero auditado es más robusto que exigir "si hay pointerup también ' +
    'debe haber pointercancel" línea a línea: esa versión se puede cumplir con un ' +
    'pointercancel que no hace nada útil y el defecto real (vista previa sin deshacer) ' +
    'seguiría pasando el guard.',
  ejecutar() {
    const raizSrc = path.join(RAIZ, 'src');
    if (!fs.existsSync(raizSrc)) return [];
    const hallazgos = [];
    // Único fichero permitido: es el propio helper, y es lo que se audita a mano.
    const permitido = 'src/ui/gesto.ts';
    const patron = /\b(window|document)\.addEventListener\(\s*['"](pointermove|pointerup|pointercancel)['"]/;
    const recorrer = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { recorrer(full); continue; }
        if (!e.name.endsWith('.ts')) continue;
        const rel = path.relative(RAIZ, full).replace(/\\/g, '/');
        if (rel === permitido) continue;
        if (tieneDeuda(rel, this.id)) continue;
        const contenido = leer(rel);
        const exentas = lineasExentas(contenido, this.id);
        contenido.split('\n').forEach((linea, i) => {
          const n = i + 1;
          if (exentas.has(n)) return;
          if (patron.test(linea)) {
            hallazgos.push(hallazgo(rel, n, `engancha pointermove/pointerup/pointercancel de window/document a mano — usa registrarGesto() de ${permitido}`));
          }
        });
      }
    };
    recorrer(raizSrc);
    return hallazgos;
  }
};

/* ── E-035 · Mem.HEAPU8 tiene que ser un getter, nunca un valor capturado ── */
export const conHeapU8Getter = {
  id: 'heapu8-siempre-getter',
  titulo: 'Mem.HEAPU8 (src/engine/pdfium/mem.ts) se define como getter, no como valor capturado',
  comoArreglar:
    'En makeMem(), declara HEAPU8 con `get HEAPU8() { return m.HEAPU8; }`, nunca ' +
    '`HEAPU8: m.HEAPU8`. La memoria WASM puede crecer (p. ej. al procesar una imagen ' +
    'grande) y Emscripten reemplaza el ArrayBuffer subyacente por uno nuevo, dejando ' +
    '"detached" cualquier Uint8Array capturado antes de ese crecimiento. Un valor ' +
    'capturado en makeMem() se congela en el momento de crear el motor y falla con ' +
    '"Cannot perform Construct on a detached ArrayBuffer" en cuanto el heap crece a ' +
    'mitad de una operación (E-035, reproducido con una imagen de 2000×2000 en ' +
    'replaceImageJpeg). Un getter relee la vista ACTUAL en cada acceso.',
  ejecutar() {
    const ruta = 'src/engine/pdfium/mem.ts';
    if (!existe(ruta)) return [];
    if (tieneDeuda(ruta, this.id)) return [];
    const contenido = leer(ruta);
    if (/\bHEAPU8\s*:\s*m\.HEAPU8/.test(contenido) && !/get\s+HEAPU8\s*\(\s*\)/.test(contenido)) {
      const linea = contenido.slice(0, contenido.indexOf('HEAPU8: m.HEAPU8')).split('\n').length;
      return [hallazgo(ruta, linea, 'HEAPU8 se captura como valor en vez de como getter — se desconectará si el heap WASM crece')];
    }
    if (!/get\s+HEAPU8\s*\(\s*\)/.test(contenido)) {
      return [hallazgo(ruta, null, 'no se encuentra "get HEAPU8()" — el getter puede haberse renombrado o eliminado')];
    }
    return [];
  }
};

export const TODAS = [
  sinInnerHtmlInterpolado,
  sinMiembrosDuplicados,
  sinCodigoMuerto,
  sinControlesHuerfanos,
  sinClasesInventadas,
  conLiberacionDeRecursos,
  conVersionesCoherentes,
  sinRutasProhibidas,
  conEspejosSincronizados,
  conErroresDocumentados,
  conSuiteViva,
  conDeudaAcotada,
  conPdfJsSinEval,
  conMotorEncapsulado,
  conPdfiumBufferFijo,
  conNavegacionPorGoToPage,
  conWebServerNextSinReusar,
  conGestoConCancelacion,
  conHeapU8Getter
];
