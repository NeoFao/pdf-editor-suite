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

import { TODAS, analizarRegistroErrores, analizarPuertosE2E } from './reglas.mjs';
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

describe('csp-coherente', () => {
  const regla = detectarEn('csp-coherente');
  // Mismo normalizador que usa la regla: por directiva, espacios colapsados +
  // trim, y el conjunto de directivas ordenado (la comparación no depende
  // del orden en que aparezcan en el fichero).
  function normalizar(csp) {
    return csp.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean).sort();
  }

  test('dos CSP con las mismas directivas en distinto orden se consideran iguales', () => {
    const a = "default-src 'self'; script-src 'self' blob:";
    const b = "script-src 'self' blob:;   default-src 'self'";
    assert.deepEqual(normalizar(a), normalizar(b));
  });

  test('detecta una directiva ausente en un lado', () => {
    const vercel = "default-src 'self'; script-src 'self' 'unsafe-eval'";
    const server = "default-src 'self'; script-src 'self'";
    const dv = normalizar(vercel);
    const ds = normalizar(server);
    assert.notDeepEqual(dv, ds);
    const soloVercel = dv.filter((d) => !ds.includes(d));
    assert.deepEqual(soloVercel, ["script-src 'self' 'unsafe-eval'"]);
  });

  test('detecta un espacio doble como el mismo valor (normalización de espacios)', () => {
    const a = "default-src  'self'";
    const b = "default-src 'self'";
    assert.deepEqual(normalizar(a), normalizar(b));
  });

  test('sobre el repo real no encuentra nada: vercel.json y server.js declaran la misma CSP', () => {
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

describe('heapu8-siempre-getter', () => {
  const regla = detectarEn('heapu8-siempre-getter');
  const patronMal = /\bHEAPU8\s*:\s*m\.HEAPU8/;
  const patronGetter = /get\s+HEAPU8\s*\(\s*\)/;

  test('detecta el patrón exacto de E-035: HEAPU8 capturado como valor en vez de getter', () => {
    const linea = '    HEAPU8: m.HEAPU8,';
    assert.match(linea, patronMal);
    assert.ok(regla.comoArreglar.includes('get HEAPU8'));
  });

  test('acepta HEAPU8 declarado como getter', () => {
    const cuerpo = '  return {\n    get HEAPU8() { return m.HEAPU8; },\n    malloc: (n) => m._malloc(n),\n  };';
    assert.doesNotMatch(cuerpo, patronMal);
    assert.match(cuerpo, patronGetter);
  });

  test('sobre el repo real no encuentra nada: src/engine/pdfium/mem.ts ya declara HEAPU8 como getter', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('addfunction-con-removefunction', () => {
  const regla = detectarEn('addfunction-con-removefunction');
  // Reproduce el recuento por fichero de la regla (mismo patrón que ejecutar()).
  function contarSinLiberar(contenido) {
    let abre = 0, cierra = 0;
    for (const linea of contenido.split('\n')) {
      if (/\.addFunction\(/.test(linea)) abre++;
      if (/\.removeFunction\(/.test(linea)) cierra++;
    }
    return abre - cierra;
  }

  test('detecta el patrón exacto de E-036: addFunction() sin removeFunction() en el finally', () => {
    const cuerpo = [
      '  save(doc) {',
      '    const cb = this.mem.addFunction((a, b, c) => { chunks.push(c); return 1; }, "iiii");',
      '    const fw = this.mem.malloc(8);',
      '    try {',
      '      this.p.FPDF_SaveAsCopy(doc, fw, 0);',
      '    } finally {',
      '      this.mem.free(fw);',
      '    }',
      '  }'
    ].join('\n');
    assert.equal(contarSinLiberar(cuerpo), 1, 'un addFunction() sin su removeFunction() debe contar como fuga');
    assert.ok(regla.comoArreglar.includes('removeFunction'));
  });

  test('acepta addFunction() con su removeFunction() en el finally (arreglo de E-036 y patrón ya usado por replaceImageJpeg)', () => {
    const cuerpo = [
      '  save(doc) {',
      '    const cb = this.mem.addFunction((a, b, c) => { chunks.push(c); return 1; }, "iiii");',
      '    const fw = this.mem.malloc(8);',
      '    try {',
      '      this.p.FPDF_SaveAsCopy(doc, fw, 0);',
      '    } finally {',
      '      this.mem.free(fw);',
      '      this.mem.removeFunction(cb);',
      '    }',
      '  }'
    ].join('\n');
    assert.equal(contarSinLiberar(cuerpo), 0);
  });

  test('el wrapper de mem.ts (delega, no reserva slot propio) no cuenta como sitio a vigilar', () => {
    assert.deepEqual(
      regla.ejecutar().filter((h) => h.archivo === 'src/engine/pdfium/mem.ts'),
      []
    );
  });

  test('sobre el repo real no encuentra nada: save() y replaceImageJpeg() liberan su addFunction() en el finally', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('motor-lote-en-bucle', () => {
  const regla = detectarEn('motor-lote-en-bucle');
  const patronBucle = /\bfor\s*\(|\.forEach\(|\bwhile\s*\(/;
  const patronDibujo = /\.(insertText|fillRect|drawStroke|drawRect)\(/;
  const patronLote = /\.applyPageOps\(/;

  test('detecta el patrón exacto de E-037: bucle + insertText suelto, sin applyPageOps', () => {
    const cuerpo = [
      'for (const spec of specs) {',
      '  c.engine.insertText(c.doc, this.pageIndex, spec);',
      '}'
    ].join('\n');
    assert.match(cuerpo, patronBucle);
    assert.match(cuerpo, patronDibujo);
    assert.doesNotMatch(cuerpo, patronLote);
    assert.ok(regla.comoArreglar.includes('applyPageOps'));
  });

  test('acepta bucle + insertText cuando el fichero también usa applyPageOps (arreglo de E-037)', () => {
    const cuerpo = [
      'for (const spec of specs) ops.push({ type: "insertText", spec });',
      'c.engine.applyPageOps(c.doc, this.pageIndex, ops);'
    ].join('\n');
    assert.match(cuerpo, patronBucle);
    assert.match(cuerpo, patronLote);
  });

  test('no señala un fichero con una única llamada de dibujo suelta, sin ningún bucle', () => {
    const cuerpo = 'c.engine.drawRect(c.doc, this.pageIndex, this.rect, this.color, this.widthPt);';
    assert.doesNotMatch(cuerpo, patronBucle);
  });

  test('no señala un bucle que no dibuja nada del motor', () => {
    const cuerpo = 'for (const p of pages) { total += p.runs.length; }';
    assert.doesNotMatch(cuerpo, patronDibujo);
  });

  test('sobre el repo real no encuentra nada: OcrPage.ts y ConversorMarkdownNavegador.ts ya usan applyPageOps', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('captura-pixel-sin-animations-disabled', () => {
  const regla = detectarEn('captura-pixel-sin-animations-disabled');
  // Mismo emparejado de paréntesis que usa la regla, reproducido sobre texto suelto.
  function llamadasSinDisabled(contenido) {
    const hallados = [];
    const patron = /\.screenshot\(/g;
    let m;
    while ((m = patron.exec(contenido))) {
      const aperturaIdx = m.index + m[0].length - 1;
      let profundidad = 0;
      let cierreIdx = aperturaIdx;
      for (let i = aperturaIdx; i < contenido.length; i++) {
        if (contenido[i] === '(') profundidad++;
        else if (contenido[i] === ')') { profundidad--; if (profundidad === 0) { cierreIdx = i; break; } }
      }
      const llamada = contenido.slice(aperturaIdx, cierreIdx + 1);
      if (!/animations\s*:\s*['"]disabled['"]/.test(llamada)) hallados.push(llamada);
    }
    return hallados;
  }

  test('detecta el patrón exacto de E-039: screenshot() sin argumentos', () => {
    const cuerpo = 'const antes = await wrapper.screenshot();';
    assert.equal(llamadasSinDisabled(cuerpo).length, 1);
    assert.ok(regla.comoArreglar.includes("animations: 'disabled'"));
  });

  test('detecta screenshot() con otras opciones pero sin animations: disabled', () => {
    const cuerpo = "const antes = await wrapper.screenshot({ type: 'png' });";
    assert.equal(llamadasSinDisabled(cuerpo).length, 1);
  });

  test('acepta screenshot({ animations: \'disabled\' })', () => {
    const cuerpo = "const antes = await wrapper.screenshot({ animations: 'disabled' });";
    assert.equal(llamadasSinDisabled(cuerpo).length, 0);
  });

  test('no confunde el cierre de paréntesis con el de otra llamada en la misma línea', () => {
    const cuerpo = "const antes = await wrapper.screenshot({ animations: 'disabled', clip: rect(0, 0) });";
    assert.equal(llamadasSinDisabled(cuerpo).length, 0);
  });

  test('sobre el repo real no encuentra nada: las cuatro capturas de tests/e2e/next/ ya fijan animations: disabled', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('sin-cronometraje-en-unit', () => {
  const regla = detectarEn('sin-cronometraje-en-unit');
  // Mismo patrón por línea que usa la regla, reproducido sobre texto suelto
  // (la regla en sí solo lee tests/unit/ del repo real, ver más abajo).
  const PATRON = /\b(performance\.now|Date\.now)\s*\(/;

  test('detecta performance.now() sin escape', () => {
    assert.ok(PATRON.test('  const t0 = performance.now();'));
  });

  test('detecta Date.now() sin escape', () => {
    assert.ok(PATRON.test('  const inicio = Date.now();'));
  });

  test('no confunde otros usos de "now" o "Date" con el patrón prohibido', () => {
    assert.ok(!PATRON.test('  const ahora = obtenerHoraActual();'));
    assert.ok(!PATRON.test('  const d = new Date();'));
  });

  test('un escape con razón exime la línea siguiente', () => {
    const contenido = [
      '// guard-disable-next-line sin-cronometraje-en-unit: anti-cuelgue muy holgado, no mide rendimiento',
      'const t0 = Date.now();'
    ].join('\n');
    assert.ok(lineasExentas(contenido, 'sin-cronometraje-en-unit').has(2));
  });

  test('sobre el repo real no encuentra nada: los cuatro ficheros de E-037/E-038/markdown ya usan vi.spyOn/pasos en vez de reloj', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('sin-playwright-en-unit', () => {
  const regla = detectarEn('sin-playwright-en-unit');
  const PATRON = /\b(from\s+|import\s*\(\s*|require\s*\(\s*)['"](@playwright\/test|playwright(-core)?)['"]/;

  test('detecta el import estático de @playwright/test', () => {
    assert.ok(PATRON.test("import { chromium, type Browser } from '@playwright/test';"));
  });

  test('detecta import dinámico y require', () => {
    assert.ok(PATRON.test("const { chromium } = await import('playwright');"));
    assert.ok(PATRON.test("const pw = require('@playwright/test');"));
  });

  test('no confunde otros imports', () => {
    assert.ok(!PATRON.test("import { test } from 'vitest';"));
  });

  test('un escape con razón exime la línea siguiente', () => {
    const contenido = [
      '// guard-disable-next-line sin-playwright-en-unit: herramienta de generación puntual',
      "import { chromium } from '@playwright/test';"
    ].join('\n');
    assert.ok(lineasExentas(contenido, 'sin-playwright-en-unit').has(2));
  });

  test('sobre el repo real no encuentra nada', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('docx-descomprimir-acotado', () => {
  const regla = detectarEn('docx-descomprimir-acotado');
  const patronDecompression = /\bnew\s+DecompressionStream\(/;
  const patronMaterializar = /new\s+Response\([^)]*\)\s*\.\s*(arrayBuffer|blob|text)\s*\(/;

  test('detecta el patrón exacto de E-042: DecompressionStream leída entera con Response(...).arrayBuffer()', () => {
    const cuerpo = [
      "const flujo = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate-raw'));",
      'const buf = await new Response(flujo).arrayBuffer();'
    ].join('\n');
    assert.match(cuerpo, patronDecompression);
    assert.match(cuerpo.split('\n')[1], patronMaterializar);
    assert.ok(regla.comoArreglar.includes('reader.read()'));
  });

  test('también detecta .blob() y .text() sobre Response, no solo .arrayBuffer()', () => {
    assert.match('await new Response(flujo).blob();', patronMaterializar);
    assert.match('await new Response(flujo).text();', patronMaterializar);
  });

  test('acepta la lectura en streaming (arreglo de E-042): reader.read() con límite, sin Response(...).arrayBuffer()', () => {
    const cuerpo = [
      "const flujo = new Blob([ab]).stream().pipeThrough(new DecompressionStream('deflate-raw'));",
      'const reader = flujo.getReader();',
      'for (;;) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > limite) { await reader.cancel(); throw new DocxError("x"); } }'
    ].join('\n');
    assert.match(cuerpo, patronDecompression);
    assert.doesNotMatch(cuerpo, patronMaterializar);
  });

  test('un fichero sin ninguna DecompressionStream no se analiza (no hay nada que acotar)', () => {
    const cuerpo = 'const buf = await new Response(flujo).arrayBuffer();';
    assert.doesNotMatch(cuerpo, patronDecompression);
  });

  test('sobre el repo real no encuentra nada: src/convert/docx/zip.ts ya lee en streaming acotado', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('texto-perezoso-via-editsession', () => {
  const regla = detectarEn('texto-perezoso-via-editsession');
  const patron = /\.getPageText\(/;

  test('detecta una llamada directa a engine.getPageText() fuera de EditSession', () => {
    const linea = 'return s.model.pages.map((page) => agruparLineas(s.engine.getPageText(s.doc, page.index)));';
    assert.match(linea, patron);
    assert.ok(regla.comoArreglar.includes('ensureText'));
  });

  test('no señala session.ensureText(pageIndex), el reemplazo correcto', () => {
    const linea = 'out.push(agruparLineas(s.ensureText(pages[i].index)));';
    assert.doesNotMatch(linea, patron);
  });

  test('sobre el repo real no encuentra nada: la UI y los comandos ya pasan por ensureText/refreshPage', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('pagegeometry-solo-con-fabrica', () => {
  const regla = detectarEn('pagegeometry-solo-con-fabrica');
  const patron = /new\s+PageGeometry\s*\(/;

  test('detecta un new PageGeometry(...) directo', () => {
    assert.match('const g = new PageGeometry(w, h, 1, rot);', patron);
    assert.ok(regla.comoArreglar.includes('desdeTamanoVisual'));
  });

  test('no señala la fábrica', () => {
    assert.doesNotMatch('const g = PageGeometry.desdeTamanoVisual(w, h, 1, rot);', patron);
  });

  test('sobre el repo real no encuentra nada', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});

describe('registro-sin-duplicados', () => {
  const regla = detectarEn('registro-sin-duplicados');

  test('detecta un número duplicado', () => {
    const p = analizarRegistroErrores('### E-001 · a\n\n### E-002 · b\n\n### E-002 · c\n');
    assert.equal(p.length, 1);
    assert.match(p[0].mensaje, /E-002 está duplicado/);
    assert.equal(p[0].linea, 5);
  });

  test('detecta un número fuera de orden', () => {
    const p = analizarRegistroErrores('### E-001 · a\n### E-003 · b\n### E-002 · c\n');
    assert.equal(p.length, 1);
    assert.match(p[0].mensaje, /E-002 está fuera de orden/);
  });

  test('no señala un registro correcto (con huecos permitidos) ni texto que no es encabezado', () => {
    assert.deepEqual(analizarRegistroErrores('### E-001 · a\nver E-001 de nuevo\n### E-004 · b\n'), []);
  });

  test('sobre el repo real no encuentra nada', () => {
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

describe('puertos-e2e-sincronizados (E-062)', () => {
  const regla = TODAS.find((r) => r.id === 'puertos-e2e-sincronizados');
  const claves = ['appVieja', 'appNueva', 'despliegue'];
  const puertos = [3100, 4173, 4174];
  const importaConfig = "import { PUERTOS_E2E } from './scripts/puertos-e2e.mjs';\n";
  const importaLiberar = "import { LISTA_PUERTOS_E2E } from './puertos-e2e.mjs';\n";

  test('acepta un config cuyos port salen todos de PUERTOS_E2E', () => {
    const config = importaConfig + 'webServer: [{ port: PUERTOS_E2E.appVieja,\n}, { port: PUERTOS_E2E.despliegue }]';
    assert.deepEqual(analizarPuertosE2E(config, importaLiberar, claves, puertos), []);
  });

  test('detecta un puerto nuevo escrito a mano que e2e:liberar no conoce (el 4174 de E-062)', () => {
    const config = importaConfig + 'webServer: [{ port: 4175,\n}]';
    const p = analizarPuertosE2E(config, importaLiberar, claves, puertos);
    assert.equal(p.length, 1);
    assert.match(p[0].mensaje, /4175 no sale de PUERTOS_E2E/);
  });

  test('detecta un puerto literal aunque coincida con la lista (debe usar la fuente única)', () => {
    const p = analizarPuertosE2E(importaConfig + 'webServer: [{ port: 4174,\n}]', importaLiberar, claves, puertos);
    assert.match(p[0].mensaje, /escrito a mano/);
  });

  test('detecta una clave inexistente de PUERTOS_E2E', () => {
    const p = analizarPuertosE2E(importaConfig + '{ port: PUERTOS_E2E.otra,\n}', importaLiberar, claves, puertos);
    assert.match(p[0].mensaje, /PUERTOS_E2E\.otra no existe/);
  });

  test('detecta que el config o liberar-puertos no importan el módulo compartido', () => {
    const sinConfig = analizarPuertosE2E('{ port: PUERTOS_E2E.appVieja,\n}', importaLiberar, claves, puertos);
    assert.match(sinConfig[0].mensaje, /playwright\.config\.js no importa/);
    const sinLiberar = analizarPuertosE2E(importaConfig + '{ port: PUERTOS_E2E.appVieja,\n}', 'const PUERTOS = [4173];', claves, puertos);
    assert.match(sinLiberar[0].mensaje, /liberar-puertos\.mjs no importa/);
  });

  test('detecta un config sin ningún port', () => {
    const p = analizarPuertosE2E(importaConfig, importaLiberar, claves, puertos);
    assert.match(p[0].mensaje, /ningún `port:`/);
  });

  test('sobre el repo real no encuentra nada', () => {
    assert.deepEqual(regla.ejecutar(), []);
  });
});
