# AGENTS.md — PDF Editor

**Contrato obligatorio para cualquier asistente de IA que trabaje en este repositorio.**
Da igual el modelo o la herramienta: Claude, Gemini, GPT, Copilot, Cursor, Cline,
Windsurf, Kiro o cualquier otro. Si abres este repo, estas reglas te aplican.

Este fichero es la **fuente única**. Los espejos (`CLAUDE.md`, `GEMINI.md`,
`.github/copilot-instructions.md`, `.cursor/rules/`, `.clinerules/`,
`.windsurf/rules/`, `.kiro/steering/`) se generan con `npm run reglas:sync` y CI
falla si alguno se queda atrás. **Edita solo AGENTS.md.**

**Idioma:** responde en español. Código, identificadores y nombres de fichero
existentes se mantienen como están (el proyecto está en español; no lo traduzcas).

---

## 0. Lo que tienes que leer antes de tocar código

1. Este fichero, entero.
2. `docs/ERRORES-CONOCIDOS.md` — el registro de defectos que ya se cometieron
   aquí, con su causa raíz. **No los repitas.** Es corto y es la parte más
   valiosa del repo.
3. `docs/TESTING.md` solo si vas a escribir o tocar tests.

No leas toda la carpeta `docs/` "por si acaso".

---

## 1. Qué es este proyecto y por qué importa la disciplina

Editor de PDF 100 % en el navegador (sin backend, sin subir ficheros). La
función central —y la más difícil— es la **edición in-place del texto que ya
venía dentro del PDF**, al estilo Adobe Acrobat o PDF Agile: el usuario hace
clic sobre una línea existente y la reescribe.

Esa función se apoya en tres capas superpuestas por página:

| Capa | Qué es | Riesgo |
|---|---|---|
| `.acrobat-page-canvas` | el PDF rasterizado por pdf.js | se repinta al cambiar de documento |
| `.acrobat-overlay-canvas` | trazos, formas y **máscaras blancas** | coordenadas en px de canvas (× `renderScale`) |
| `.acrobat-text-layer` | bloques DOM editables | coordenadas en px CSS de página |

**Tres sistemas de coordenadas distintos conviven**: px CSS de página, px de
canvas (`× renderScale`, hoy 1.4) y puntos PDF (origen abajo-izquierda, eje Y
invertido). Casi todos los defectos graves de este repo han salido de mezclarlos.
Si tocas geometría, escribe en el comentario en qué unidad está cada número.

---

## 2. Reglas duras (violarlas rompe el build)

### 2.1 Tests: no negociable

- **Todo cambio de comportamiento entra con test.** Si arreglas un fallo, el PR
  incluye el test que fallaba antes del arreglo. Sin excepciones por "es
  trivial" o "es solo CSS": el defecto más caro de este repo era una regla CSS.
- **Los tests de comportamiento van en Chromium real** (`tests/e2e/`, Playwright).
  jsdom y similares **no** calculan maquetación, así que dejan pasar justo la
  clase de error que más daño ha hecho aquí. Ver `docs/TESTING.md`.
- Antes de decir que algo funciona: **ejecútalo y pega la salida**. Nunca
  afirmes "los tests pasan" sin haberlos corrido en esa misma sesión.
- Prohibido `test.skip`, `test.only`, `test.fixme` y bajar umbrales para poner
  el CI en verde. Si un test estorba, o arreglas el código o borras el test
  **explicando por qué** en el PR.

### 2.2 Nunca metas datos del documento en HTML

```js
// PROHIBIDO — inyecta marcado y además mete nodos de texto que rompen el layout
bloque.innerHTML = `<div class="x">${textoDelPdf}</div>`;

// CORRECTO
const div = document.createElement('div');
div.className = 'x';
div.textContent = textoDelPdf;
bloque.appendChild(div);
```

Esto no es solo seguridad. Una plantilla indentada deja los saltos de línea como
nodos de texto reales dentro del elemento; con `white-space: pre-wrap` se pintan
como renglones vacíos. Así un bloque de 14 px pasó a 105 px y el PDF exportado
salió con tres líneas borradas (**E-001**, **E-003**).

### 2.3 Un cambio del usuario solo puede alterar lo que el usuario tocó

La máscara blanca que tapa el texto original se calcula **siempre** desde la
geometría de la línea original (`meta.height`), **nunca** desde
`elemento.offsetHeight` mientras está en edición. Un elemento en edición crece;
la línea del documento, no (**E-002**).

### 2.4 Exportar no muta el documento vivo

`exportAndDownloadPDF()` trabaja sobre una copia (`buildFlattenedDoc()`).
Exportar dos veces debe dar exactamente el mismo resultado (**E-005**).

### 2.5 Una capa por página al quemar anotaciones

Nunca un `embedPng` de página completa por cada elemento: se componen todos en
un solo canvas y se incrusta una vez (**E-004**).

### 2.6 Cierra lo que abres

Cada `pdfjsLib.getDocument()` necesita su `destroy()`. Cada
`window.addEventListener('pointermove'…)` dentro de una fábrica por elemento
necesita su `removeEventListener` al terminar el gesto (**E-014**, **E-020**).

### 2.7 No dejes controles huérfanos ni ficheros muertos

Todo `<button>`/`<input>`/`<select>` con `id` en `index.html` tiene que estar
cableado en JS. Todo `js/**/*.js` tiene que cargarlo `index.html`. Si algo deja
de usarse, se borra en el mismo PR (**E-019**, **E-021**).

### 2.8 Verifica en el navegador antes de decir que está hecho

Para cualquier cambio de UI, geometría o exportación: **ábrelo, pruébalo y
mira el resultado**. `npm run dev` y `npm run test:e2e`. Un cambio que "parece
correcto" leyendo el diff no está verificado.

---

## 3. Reglas deterministas automáticas

`npm run guard` ejecuta el catálogo de `scripts/guards/reglas.mjs`. Corre en el
pre-commit y en CI. Cada regla nace de un defecto real y está documentada en
`docs/ERRORES-CONOCIDOS.md`.

Para saltarte una regla en una línea concreta necesitas una razón escrita:

```js
// guard-disable-next-line no-innerhtml-interpolado: icono estático, sin datos del documento
```

Un escape sin razón (o con una razón de menos de 10 caracteres) no vale y la
regla sigue disparando. **Añadir un escape para poner el CI en verde es una
violación de este contrato.** Si crees que la regla se equivoca, discútelo en el
PR y ajusta la regla junto con su test.

---

## 4. Flujo de trabajo obligatorio

1. **Nunca hagas push directo a `main`.** Rama `feature/…`, `fix/…`, `chore/…`
   o `docs/…` en kebab-case, y PR.
2. Antes de empezar: `npm ci` y `npm run verify` para partir de verde.
3. Ciclo: escribe el test que falla → arregla → `npm run verify` en verde.
4. Antes de abrir el PR, **ejecuta `npm run verify` completo y pega la salida**
   en la descripción.
5. Rellena la plantilla de PR. Las casillas se marcan solo si es cierto.
6. CI tiene que estar 100 % en verde. **No propongas el merge con un check en
   rojo ni pendiente.** No desactives workflows ni conviertas un check
   obligatorio en opcional.

### Commits

Conventional commits, en español o inglés pero consistente con el historial:

```
fix: la máscara del texto reemplazado usa el alto de la línea original
```

No incluyas en el cuerpo del commit ni del PR ninguna referencia a la
herramienta de IA usada, salvo el trailer `Co-Authored-By` cuando el humano lo
pida explícitamente.

---

## 5. Lo que NO puedes hacer sin permiso explícito del humano

- Borrar ficheros que no creaste en esta sesión.
- Cambiar `vercel.json`, la CSP, o las cabeceras de seguridad de `server.js`.
- Añadir dependencias de runtime. (Las de desarrollo, con justificación en el PR.)
- Sacar procesamiento del navegador: **ningún PDF sale del equipo del usuario**.
  Nada de subir ficheros, telemetría con contenido, ni llamadas a servicios
  externos con datos del documento.
- Cambiar los umbrales, los checks obligatorios o los workflows de CI.
- Reescribir historia de git (`push --force`, rebase de ramas compartidas).

---

## 6. Cuando encuentres un defecto nuevo

El ciclo completo, siempre en el mismo PR:

1. **Test que falla** que lo reproduce (`tests/e2e/`).
2. **Arreglo** mínimo.
3. **Entrada en `docs/ERRORES-CONOCIDOS.md`**: síntoma, causa raíz, cómo se
   detecta ahora. Asigna el siguiente `E-0NN`.
4. **Regla determinista** en `scripts/guards/reglas.mjs` si el patrón puede
   repetirse en otro sitio del código, más su test en `reglas.test.mjs`.

Un arreglo sin test vuelve. Un arreglo sin entrada en el registro se vuelve a
cometer por la siguiente IA que no tenga tu contexto. Ese registro es la memoria
del repositorio.

---

## 7. Comandos

```bash
npm ci                  # instalar
npm run dev             # servidor local en :3000
npm run build           # compilar Tailwind (obligatorio si tocas clases)
npm run guard           # reglas deterministas
npm run lint            # ESLint
npm run test:unit       # tests de las reglas (node --test)
npm run test:e2e        # suite Playwright en Chromium real
npm run verify          # TODO lo anterior — esto es lo que corre CI
npm run reglas:sync     # regenerar los espejos de este fichero
```

`npm run verify` es la verdad. Si pasa en tu máquina y falla en CI, es un bug
del propio pipeline: repórtalo, no lo esquives.

<!-- huella:a85d71dbd138 -->
