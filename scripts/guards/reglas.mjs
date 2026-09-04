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
  conDeudaAcotada
];
