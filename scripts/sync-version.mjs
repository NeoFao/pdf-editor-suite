#!/usr/bin/env node
/**
 * Alinea los `?v=` de index.html con la versión de package.json.
 *
 * Editarlos a mano se olvida, y un `?v=` viejo sirve JS cacheado: el arreglo
 * está en el servidor y el usuario sigue viendo el fallo (E-023).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(fs.readFileSync(path.join(RAIZ, 'package.json'), 'utf8')).version;
const rutaHtml = path.join(RAIZ, 'index.html');

const antes = fs.readFileSync(rutaHtml, 'utf8');
const despues = antes
  // Actualiza los que ya lo llevan.
  .replace(/((?:href|src)="(?:css|js)\/[^"?]+)\?v=[^"]*"/g, `$1?v=${version}"`)
  // Y añade el parámetro a los que se quedaron sin él.
  .replace(/((?:href|src)="(?:css|js)\/[^"?]+\.(?:css|js))"/g, `$1?v=${version}"`);

if (antes === despues) {
  console.log(`index.html ya está en ?v=${version}.`);
} else {
  fs.writeFileSync(rutaHtml, despues);
  console.log(`index.html actualizado a ?v=${version}.`);
}
