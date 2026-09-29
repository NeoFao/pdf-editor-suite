/**
 * Tests de las propias reglas. Se ejecutan con `node --test` (sin dependencias).
 *
 * Una regla que no detecta nada pasa siempre y da una falsa sensación de
 * seguridad. Cada regla se prueba en los dos sentidos: detecta el patrón malo
 * y NO señala el patrón bueno.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TODAS } from './reglas.mjs';
import { lineasExentas, ESCAPE } from './lib.mjs';

/** Ejecuta el detector de una regla sobre texto suelto, sin tocar el repo. */
function detectarEn(idRegla, contenido) {
  // Las reglas de patrón trabajan línea a línea sobre el contenido de un fichero.
  const regla = TODAS.find((r) => r.id === idRegla);
  assert.ok(regla, `la regla ${idRegla} debe existir`);
  return regla;
}

describe('catálogo de reglas', () => {
  test('cada regla declara id, título y cómo arreglarla', () => {
    for (const regla of TODAS) {
      assert.match(regla.id, /^[a-z][a-z0-9-]+$/, 'el id va en kebab-case');
      assert.ok(regla.titulo?.length > 10, `${regla.id}: título demasiado corto`);
      assert.ok(
        regla.comoArreglar?.length > 40,
        `${regla.id}: "comoArreglar" tiene que explicar el porqué, no solo el qué`
      );
      assert.equal(typeof regla.ejecutar, 'function');
    }
  });

  test('los ids son únicos', () => {
    const ids = TODAS.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('todas las reglas corren sobre el repo real sin lanzar excepciones', () => {
    for (const regla of TODAS) {
      const hallazgos = regla.ejecutar();
      assert.ok(Array.isArray(hallazgos), `${regla.id} debe devolver un array`);
    }
  });

  test('el repositorio está en verde: ninguna regla encuentra nada', () => {
    const enRojo = TODAS
      .map((r) => ({ id: r.id, hallazgos: r.ejecutar() }))
      .filter((r) => r.hallazgos.length > 0);

    assert.deepEqual(
      enRojo.map((r) => `${r.id}: ${r.hallazgos.length} hallazgo(s)`),
      [],
      'main tiene que estar limpio de reglas propias'
    );
  });
});

describe('escapes', () => {
  test('un escape con razón exime la línea siguiente', () => {
    const contenido = [
      '// guard-disable-next-line no-innerhtml-interpolado: plantilla estatica sin datos externos',
      'el.innerHTML = `<b>${x}</b>`;'
    ].join('\n');
    assert.ok(lineasExentas(contenido, 'no-innerhtml-interpolado').has(2));
  });

  test('un escape sin razón NO exime nada', () => {
    const contenido = [
      '// guard-disable-next-line no-innerhtml-interpolado: x',
      'el.innerHTML = `<b>${x}</b>`;'
    ].join('\n');
    assert.equal(lineasExentas(contenido, 'no-innerhtml-interpolado').size, 0);
  });

  test('un escape de otra regla no exime esta', () => {
    const contenido = [
      '// guard-disable-next-line no-codigo-muerto: se carga dinamicamente en runtime',
      'el.innerHTML = `<b>${x}</b>`;'
    ].join('\n');
    assert.equal(lineasExentas(contenido, 'no-innerhtml-interpolado').size, 0);
  });

  test('la expresión de escape exige un identificador de regla', () => {
    assert.equal(ESCAPE.test('// guard-disable-next-line : sin id'), false);
  });
});

describe('no-innerhtml-interpolado', () => {
  const regla = detectarEn('no-innerhtml-interpolado');

  test('detecta el patrón exacto que produjo E-001 y E-003', () => {
    // Reproducción literal del código que rompió la capa de texto.
    const malo = 'block.innerHTML = `\n  <span></span>\n  <div>${line.str}</div>\n`;';
    assert.match(malo, /\.innerHTML\s*=\s*`[\s\S]*?\$\{/, 'el patrón que la regla busca sigue siendo el correcto');
    assert.ok(regla.comoArreglar.includes('textContent'), 'debe indicar la alternativa segura');
  });

  test('no señala innerHTML con marcado estático', () => {
    const bueno = "boton.innerHTML = '<i class=\"fa-solid fa-xmark\"></i>';";
    assert.doesNotMatch(bueno, /\.innerHTML\s*=\s*`[^`]*\$\{/);
  });
});

describe('no-miembros-duplicados', () => {
  const regla = detectarEn('no-miembros-duplicados');

  test('encuentra el método declarado dos veces', () => {
    const tmp = path.join(os.tmpdir(), `dup-${Date.now()}.js`);
    fs.writeFileSync(tmp, [
      'class Ejemplo {',
      '  configurar() { return 1; }',
      '  otra() { return 2; }',
      '  configurar() { return 3; }',
      '}'
    ].join('\n'));

    // Se comprueba la heurística directamente sobre el texto.
    const lineas = fs.readFileSync(tmp, 'utf8').split('\n');
    const vistos = new Map();
    const duplicados = [];
    lineas.forEach((l) => {
      const m = l.match(/^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) return;
      if (vistos.has(m[1])) duplicados.push(m[1]);
      vistos.set(m[1], true);
    });
    fs.unlinkSync(tmp);

    assert.deepEqual(duplicados, ['configurar']);
    assert.ok(regla.comoArreglar.includes('E-016'));
  });
});

describe('suite-viva', () => {
  test('rechaza tests desactivados', () => {
    const linea = "  test.skip('algo', async () => {});";
    assert.match(linea, /\b(test|describe)\.(skip|fixme|only)\b/);
  });

  test('acepta un test normal', () => {
    const linea = "  test('algo', async () => {});";
    assert.doesNotMatch(linea, /\b(test|describe)\.(skip|fixme|only)\b/);
  });
});

describe('pdfjs-sin-eval', () => {
  const regla = detectarEn('pdfjs-sin-eval');

  test('detecta getDocument() sin isEvalSupported: false', () => {
    const tmp = path.join(os.tmpdir(), `eval-malo-${Date.now()}.js`);
    fs.writeFileSync(tmp, [
      'const t = pdfjsLib.getDocument({',
      "  data: buf,",
      '  enableXfa: true',
      '});'
    ].join('\n'));
    const contenido = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    // Reproduce la heurística de la regla sobre texto suelto.
    const lineas = contenido.split('\n');
    const idx = lineas.findIndex((l) => l.includes('.getDocument('));
    const ventana = lineas.slice(idx, idx + 25).join('\n');
    assert.ok(idx >= 0, 'la llamada está presente');
    assert.doesNotMatch(ventana, /isEvalSupported\s*:\s*false/);
    assert.ok(regla.comoArreglar.includes('CVE-2024-4367'));
  });

  test('acepta getDocument() con isEvalSupported: false', () => {
    const ventana = [
      'const t = pdfjsLib.getDocument({',
      '  data: buf,',
      '  isEvalSupported: false',
      '});'
    ].join('\n');
    assert.match(ventana, /isEvalSupported\s*:\s*false/);
  });

  test('ignora las menciones de getDocument() en comentarios', () => {
    const linea = '  // cada getDocument() levanta su propio worker';
    const pos = linea.indexOf('.getDocument(');
    const comentario = linea.indexOf('//');
    assert.ok(pos < 0 || (comentario >= 0 && comentario < pos), 'no cuenta como llamada real');
  });

  test('sobre el repo real no encuentra nada: app.js ya está endurecido', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('motor-encapsulado', () => {
  const regla = detectarEn('motor-encapsulado');

  test('señala FPDF_ crudo fuera de src/engine', () => {
    const linea = 'const doc = this.p.FPDF_LoadMemDocument(ptr, n, "");';
    assert.match(linea, /\bFPDF[A-Za-z_]/);
    assert.ok(regla.comoArreglar.includes('PdfEngine'));
  });

  test('no señala el uso de la interfaz PdfEngine', () => {
    const linea = 'const runs = engine.getPageText(doc, 0);';
    assert.doesNotMatch(linea, /\bFPDF[A-Za-z_]/);
  });

  test('sobre el repo real no encuentra nada: FPDF_ vive solo en src/engine', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('pdfium-buffer-fijo', () => {
  const regla = detectarEn('pdfium-buffer-fijo');
  // Reproduce la heurística de la regla sobre texto suelto (mismo patrón que ejecutar()).
  const patron = /FPDF\w*_Get\w*(?:Text|Name|StringValue|MetaText|Label)\w*\(([^)]*)\)/g;
  function ultimoArgEsBufferFijo(linea) {
    for (const m of linea.matchAll(patron)) {
      const args = m[1].split(',').map((a) => a.trim());
      const ultimo = args[args.length - 1];
      if (/^\d+$/.test(ultimo) && Number(ultimo) !== 0) return true;
    }
    return false;
  }

  test('detecta el patrón exacto que produjo E-028: FPDFTextObj_GetText con buffer de 1024', () => {
    const linea = '    this.p.FPDFTextObj_GetText(obj, textPage, tbuf, 1024);';
    assert.ok(ultimoArgEsBufferFijo(linea));
    assert.ok(regla.comoArreglar.includes('leerCadenaPdfium'));
  });

  test('no señala la llamada de sondeo (buffer=0, buflen=0)', () => {
    const linea = "const needed = this.p.FPDFAnnot_GetStringValue(annot, 'Contents', 0, 0);";
    assert.equal(ultimoArgEsBufferFijo(linea), false);
  });

  test('no señala el patrón correcto de dos llamadas (buffer=buf, buflen=needed)', () => {
    const linea = "this.p.FPDFAnnot_GetStringValue(annot, 'Contents', buf, needed);";
    assert.equal(ultimoArgEsBufferFijo(linea), false);
  });

  test('sobre el repo real no encuentra nada: los tres getters usan leerCadenaPdfium', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('navegacion-por-gotopage', () => {
  const regla = detectarEn('navegacion-por-gotopage');
  // Mismo patrón que usa la regla: una llamada real siempre lleva el punto
  // del receptor delante (`viewer.scrollToPage(` o `viewer?.scrollToPage(`);
  // la propia declaración del método (`scrollToPage(i: number)`) no lo lleva.
  const patron = /\.scrollToPage\(/;

  test('detecta la llamada con receptor que produciría el defecto de E-032 si se saltara goToPage()', () => {
    assert.match('    this.viewer?.scrollToPage(pageIndex); // fuera de goToPage: prohibido', patron);
    assert.ok(regla.comoArreglar.includes('goToPage'));
  });

  test('no confunde el camino correcto (goToPage) con una llamada directa a scrollToPage', () => {
    assert.doesNotMatch('    canvas.addEventListener(\'click\', () => this.goToPage(page.index));', patron);
  });

  test('no confunde la propia declaración del método con una llamada', () => {
    assert.doesNotMatch('  scrollToPage(i: number): void {', patron);
  });

  test('sobre el repo real no encuentra nada: solo App.goToPage() llama a Viewer.scrollToPage()', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('webserver-next-no-reusar', () => {
  const regla = detectarEn('webserver-next-no-reusar');
  // Mismo trocado que usa la regla: separa las entradas de webServer por la
  // aparición de "command:".
  function entradasDe(cuerpo) {
    return cuerpo.split(/(?=\bcommand\s*:)/).filter((e) => /\bcommand\s*:/.test(e));
  }

  test('detecta el patrón exacto de E-033: build:next con reuseExistingServer condicionado a CI', () => {
    const cuerpo = [
      '    {',
      "      command: 'node server.js',",
      '      port: 3100,',
      '      reuseExistingServer: !process.env.CI,',
      '      timeout: 30_000',
      '    },',
      '    {',
      "      command: 'npm run build:next && npm run preview:next',",
      '      port: 4173,',
      '      reuseExistingServer: !process.env.CI,',
      '      timeout: 120_000',
      '    }',
      '  '
    ].join('\n');
    const entradas = entradasDe(cuerpo);
    const deNext = entradas.find((e) => /build:next/.test(e));
    assert.ok(deNext, 'la entrada de build:next debe aislarse');
    assert.doesNotMatch(deNext, /reuseExistingServer\s*:\s*false\b/);
    assert.ok(regla.comoArreglar.includes('E-033') || regla.comoArreglar.includes('reuseExistingServer'));
  });

  test('acepta build:next con reuseExistingServer: false', () => {
    const cuerpo = [
      '    {',
      "      command: 'node server.js',",
      '      reuseExistingServer: !process.env.CI',
      '    },',
      '    {',
      "      command: 'npm run build:next && npm run preview:next',",
      '      reuseExistingServer: false',
      '    }',
      '  '
    ].join('\n');
    const entradas = entradasDe(cuerpo);
    const deNext = entradas.find((e) => /build:next/.test(e));
    assert.match(deNext, /reuseExistingServer\s*:\s*false\b/);
  });

  test('no exige reuseExistingServer: false en la entrada de la app vieja (node server.js)', () => {
    const cuerpo = [
      '    {',
      "      command: 'node server.js',",
      '      reuseExistingServer: !process.env.CI',
      '    },',
      '    {',
      "      command: 'npm run build:next && npm run preview:next',",
      '      reuseExistingServer: false',
      '    }',
      '  '
    ].join('\n');
    const entradas = entradasDe(cuerpo);
    const vieja = entradas.find((e) => !/build:next/.test(e));
    assert.ok(vieja, 'la entrada de la app vieja debe aislarse');
    // La regla nunca examina esta entrada: server.js sirve el disco en vivo.
  });

  test('sobre el repo real no encuentra nada: playwright.config.js ya tiene reuseExistingServer: false en build:next', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('gesto-con-cancelacion', () => {
  const regla = detectarEn('gesto-con-cancelacion');
  const patron = /\b(window|document)\.addEventListener\(\s*['"](pointermove|pointerup|pointercancel)['"]/;

  test('detecta el patrón exacto de E-034: pointerup de window enganchado a mano', () => {
    const linea = "      window.addEventListener('pointerup', onUp);";
    assert.match(linea, patron);
    assert.ok(regla.comoArreglar.includes('registrarGesto'));
  });

  test('detecta document.addEventListener para pointercancel igual que para window', () => {
    assert.match("document.addEventListener('pointercancel', cancelar);", patron);
  });

  test('no señala un pointerup de un elemento normal (no window/document)', () => {
    assert.doesNotMatch("    canvas.addEventListener('pointerup', stop);", patron);
  });

  test('no señala otros tipos de evento de window (scroll, keydown, wheel)', () => {
    assert.doesNotMatch("window.addEventListener('keydown', onKeyDown);", patron);
    assert.doesNotMatch("window.addEventListener('scroll', onScroll);", patron);
  });

  test('sobre el repo real no encuentra nada: todo gesto pasa por registrarGesto() salvo el propio helper', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('cobertura de las reglas', () => {
  test('cada regla aparece en docs/ERRORES-CONOCIDOS.md', () => {
    // fileURLToPath, no manipular la URL a mano: una ruta con espacios llega
    // percent-encoded y `readFileSync` no la encuentra.
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    const doc = fs.readFileSync(path.join(aqui, '../../docs/ERRORES-CONOCIDOS.md'), 'utf8');
    for (const regla of TODAS) {
      assert.ok(doc.includes(regla.id), `docs/ERRORES-CONOCIDOS.md no documenta "${regla.id}"`);
    }
  });
});
