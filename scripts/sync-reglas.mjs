#!/usr/bin/env node
/**
 * Propaga AGENTS.md a todos los formatos de reglas que entienden los distintos
 * asistentes de IA.
 *
 * Sin esto, cada herramienta lee un fichero distinto y basta con que uno se
 * quede atrás para que esa IA trabaje con reglas viejas. La huella SHA-256 del
 * contenido canónico se incrusta en cada espejo y la regla
 * `espejos-ia-sincronizados` falla en CI si alguno no coincide.
 *
 *   npm run reglas:sync           escribe los espejos
 *   npm run reglas:sync -- --check  solo verifica (lo que hace CI)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANONICO = 'AGENTS.md';
const MARCA = /<!-- huella:[a-zA-Z0-9]+ -->/;

/**
 * Cada espejo declara el envoltorio que su herramienta necesita.
 * `cabecera` puede ser front-matter (Cursor) o un aviso en markdown.
 */
const ESPEJOS = [
  {
    ruta: 'CLAUDE.md',
    cabecera: '> Espejo generado de `AGENTS.md`. No lo edites: cambia AGENTS.md y ejecuta `npm run reglas:sync`.\n'
  },
  {
    ruta: 'GEMINI.md',
    cabecera: '> Espejo generado de `AGENTS.md`. No lo edites: cambia AGENTS.md y ejecuta `npm run reglas:sync`.\n'
  },
  {
    ruta: '.github/copilot-instructions.md',
    cabecera: '> Espejo generado de `AGENTS.md`. No lo edites: cambia AGENTS.md y ejecuta `npm run reglas:sync`.\n'
  },
  {
    ruta: '.cursor/rules/pdf-editor.mdc',
    cabecera: [
      '---',
      'description: Contrato obligatorio del repositorio PDF Editor',
      'globs: ["**/*"]',
      'alwaysApply: true',
      '---',
      '',
      '> Espejo generado de `AGENTS.md`. No lo edites: cambia AGENTS.md y ejecuta `npm run reglas:sync`.',
      ''
    ].join('\n')
  },
  {
    ruta: '.clinerules/pdf-editor.md',
    cabecera: '> Espejo generado de `AGENTS.md`. No lo edites: cambia AGENTS.md y ejecuta `npm run reglas:sync`.\n'
  },
  {
    ruta: '.windsurf/rules/pdf-editor.md',
    cabecera: [
      '---',
      'trigger: always_on',
      '---',
      '',
      '> Espejo generado de `AGENTS.md`. No lo edites: cambia AGENTS.md y ejecuta `npm run reglas:sync`.',
      ''
    ].join('\n')
  },
  {
    ruta: '.kiro/steering/pdf-editor.md',
    cabecera: [
      '---',
      'inclusion: always',
      '---',
      '',
      '> Espejo generado de `AGENTS.md`. No lo edites: cambia AGENTS.md y ejecuta `npm run reglas:sync`.',
      ''
    ].join('\n')
  }
];

const soloVerificar = process.argv.includes('--check');

/**
 * Normaliza a LF antes de comparar y de calcular la huella.
 *
 * En Windows, `core.autocrlf` reescribe los finales de línea al hacer checkout:
 * sin esto, cualquier clon en Windows daba todos los espejos por
 * desincronizados y el pre-commit bloqueaba sin motivo real.
 */
const aLF = (texto) => texto.split(String.fromCharCode(13, 10)).join('\n');

const rutaCanonico = path.join(RAIZ, CANONICO);
const canonico = aLF(fs.readFileSync(rutaCanonico, 'utf8'));

// El cuerpo es todo menos la propia marca: así la huella no depende de sí misma.
const cuerpo = canonico.replace(MARCA, '').trimEnd();
const huella = crypto.createHash('sha256').update(cuerpo).digest('hex').slice(0, 12);

const canonicoEsperado = `${cuerpo}\n\n<!-- huella:${huella} -->\n`;

const desincronizados = [];

if (canonico !== canonicoEsperado) {
  if (soloVerificar) desincronizados.push(CANONICO);
  else {
    fs.writeFileSync(rutaCanonico, canonicoEsperado);
    console.log(`  actualizado  ${CANONICO} (huella ${huella})`);
  }
}

for (const espejo of ESPEJOS) {
  const destino = path.join(RAIZ, espejo.ruta);
  const contenido = `${espejo.cabecera}\n${cuerpo}\n\n<!-- huella:${huella} -->\n`;

  const actual = fs.existsSync(destino) ? aLF(fs.readFileSync(destino, 'utf8')) : null;
  if (actual === contenido) continue;

  if (soloVerificar) {
    desincronizados.push(espejo.ruta);
  } else {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, contenido);
    console.log(`  actualizado  ${espejo.ruta}`);
  }
}

if (soloVerificar) {
  if (desincronizados.length > 0) {
    console.error('\nEstos ficheros de reglas están desincronizados con AGENTS.md:');
    desincronizados.forEach((f) => console.error(`  - ${f}`));
    console.error('\nEjecuta: npm run reglas:sync\n');
    process.exit(1);
  }
  console.log(`Reglas sincronizadas (huella ${huella}).`);
} else {
  console.log(`\nListo. ${ESPEJOS.length} espejos con la huella ${huella}.`);
}
