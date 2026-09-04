# Errores conocidos

Registro de defectos que **ya se cometieron en este repositorio**, con su causa
raíz y lo que impide que vuelvan.

Este documento existe porque un arreglo sin memoria se vuelve a romper: la
siguiente persona —o la siguiente IA, que llega sin contexto— repite el mismo
patrón. Aquí está el porqué de cada regla y de cada test que puedan parecer
arbitrarios.

**Léelo entero antes de tocar código.** Son diez minutos.

Formato de cada entrada:

- **Síntoma** — lo que veía el usuario.
- **Causa raíz** — el mecanismo real, no el "se me olvidó".
- **Cómo se detecta ahora** — el test o la regla que lo bloquea.

Al arreglar un defecto nuevo: añade su entrada con el siguiente `E-0NN`, su test
y, si el patrón puede repetirse en otro sitio, su regla en
`scripts/guards/reglas.mjs`.

---

## Capa de Texto Vivo (edición in-place)

### E-001 · El cuadro de edición se inflaba y tapaba las líneas vecinas

**Síntoma.** Al hacer clic sobre una línea del PDF para editarla, aparecía un
rectángulo blanco enorme que cubría tres o cuatro renglones del documento.

**Causa raíz.** Los bloques se construían con una plantilla indentada:

```js
block.innerHTML = `
  <span class="acrobat-drag-handle">…</span>
  <span class="acrobat-delete-btn">…</span>
  <div class="text-block-content">${line.str}</div>
`;
```

Los saltos de línea y la sangría de la plantilla quedan como **nodos de texto
reales** dentro del elemento. En reposo daba igual (`height` fijo), pero la
clase `.editing` traía `white-space: pre-wrap` + `height: auto`, y bajo
`pre-wrap` esos saltos se pintan como renglones vacíos. Medido: **14 px → 105 px**
(seis líneas fantasma de 15 px + la real).

**Cómo se detecta ahora.**
- Regla `no-innerhtml-interpolado` — prohíbe el patrón que lo origina.
- Test `E-001: el cuadro de edición NO crece en vertical`.
- Test `E-001: el bloque en edición no se solapa con la línea siguiente`.
- El bloque se construye en `createTextBlockElement()` con `createElement` y
  `textContent`, y `.editing` crece en ancho (`white-space: pre; width: max-content`).

---

### E-002 · El PDF exportado salía con líneas borradas

**Síntoma.** El defecto más caro del proyecto. Editabas una línea, guardabas, y
en el PDF descargado faltaban las **tres siguientes**, con fragmentos sueltos
sobrantes en el margen derecho.

**Causa raíz.** Consecuencia de E-001. Al confirmar la edición se guardaba
`boxH: block.offsetHeight` — que en ese momento valía 105 px por el bloque
inflado. La exportación pintaba el parche blanco con ese alto, borrando cuatro
renglones del documento original.

Había además **dos mecanismos de enmascarado que no coincidían**: la máscara de
pantalla usaba `meta.height` (14 px, correcta) y la de exportación usaba `boxH`
(105 px). Lo que veías no era lo que se guardaba.

**Cómo se detecta ahora.**
- Test `E-002: editar una línea NO borra las vecinas del PDF exportado` — extrae
  el texto del PDF resultante con pdf.js y exige que las líneas no tocadas sigan
  ahí. Es el test más importante del repositorio.
- Test `E-002: la máscara tampoco desborda al agrandar la tipografía`.
- `buildReplacementRecord()` ancla `boxH` a `meta.height` y guarda la geometría
  de la máscara en el propio registro, de modo que pantalla y exportación usan
  la misma fuente.

---

### E-003 · El texto del PDF se interpretaba como HTML

**Síntoma.** Un PDF cuyo texto contuviera `<`, `>` o `&` mostraba la línea
corrupta o incompleta. Un PDF preparado a mala fe podía ejecutar código en la
página.

**Causa raíz.** El mismo `innerHTML` de E-001 interpolaba `${line.str}` sin
escapar. El contenido de un fichero abierto por el usuario es **entrada no
confiable**.

**Cómo se detecta ahora.**
- Regla `no-innerhtml-interpolado`.
- Test `E-003: el texto del PDF se muestra literal, nunca como HTML`, con el
  fixture `hostil.pdf`.

---

### E-006 · Texto fantasma desplazado media línea

**Síntoma.** Tras editar, se veía un duplicado borroso del texto ligeramente
desplazado hacia arriba.

**Causa raíz.** `redrawPageAnnotations()` pintaba los textos **otra vez** en el
canvas de anotaciones con `ctx.fillText(...)`, además del bloque DOM que ya los
mostraba. Y lo hacía con `textBaseline = 'middle'` sobre la coordenada del
**borde superior** del bloque: medio renglón de desfase.

**Cómo se detecta ahora.**
- Test `E-006: editar no deja texto fantasma en el canvas de anotaciones`.
- `redrawPageAnnotations()` solo pinta trazos y máscaras. El texto se rasteriza
  únicamente al exportar, en `burnAnnotationsIntoDoc()`.

---

### E-010 · Máscaras apiladas que no se podían deshacer

**Síntoma.** Deshacer una edición devolvía el texto pero seguía sin verse:
quedaba tapado por un parche blanco.

**Causa raíz.** `maskOriginalText()` hacía `push` de un rectángulo nuevo cada
vez, sin identificar a qué bloque pertenecía. Ni se podía sustituir en una
segunda edición ni se podía localizar para retirarlo al deshacer.

**Cómo se detecta ahora.**
- Test `E-010: la máscara blanca es una por bloque y Deshacer la retira`.
- Las máscaras llevan `blockId`; `removeMaskForBlock()` las retira.

---

### E-011 · Rehacer dejaba el estado incoherente

**Síntoma.** Deshacer y rehacer una edición dejaba el texto correcto en pantalla
pero el cambio no aparecía en el PDF exportado, y el texto original reasomaba.

**Causa raíz.** El caso `edit_text` de `redo()` buscaba el registro en
`pageAnn.texts` para actualizarlo — pero `undo()` lo había **eliminado**. No
encontraba nada, no reponía nada, y tampoco volvía a colocar la máscara.

**Cómo se detecta ahora.**
- Test `E-011: deshacer y rehacer dejan el estado coherente`.
- La acción de deshacer guarda `record` y `meta` completos para poder reconstruir.

---

### E-013 · Fuente y Tamaño no afectaban al texto en edición

**Síntoma.** Con una línea abierta para editar, cambiar Tamaño o Fuente en el
panel de Propiedades no hacía nada.

**Causa raíz.** Doble: los controles solo escribían en `docState.properties`
(que solo consultan los cuadros de texto nuevos), y al pulsar un control del
panel el `contenteditable` pierde el foco → se disparaba el `blur`. Si ahí se
borra la referencia al bloque activo, no queda sobre qué aplicar el cambio.

**Cómo se detecta ahora.**
- Test `E-013: el panel de Propiedades actúa sobre el bloque en edición`.
- `activeTextBlock` sobrevive al `blur` (actúa como "bloque seleccionado") y se
  limpia al cargar otro documento.

---

## Exportación

### E-004 · El archivo exportado crecía con cada edición

**Síntoma.** Guardar tras varias ediciones producía un PDF desproporcionado y
tardaba muchísimo.

**Causa raíz.** El bucle de exportación creaba un canvas **de página completa a
2×** y lo incrustaba como PNG **por cada texto**. Diez ediciones en un A4 = diez
imágenes de 1190×1684 superpuestas.

**Cómo se detecta ahora.**
- Test `E-004: N ediciones no multiplican el peso del archivo`.
- `burnAnnotationsIntoDoc()` compone todo en un único canvas por página.

---

### E-005 · Exportar dos veces duplicaba las anotaciones

**Síntoma.** El segundo "Descargar PDF" de la misma sesión salía con las
anotaciones incrustadas dos veces.

**Causa raíz.** La exportación dibujaba sobre `docState.pdfLibDoc`, el documento
vivo. Cada exportación dejaba el estado en memoria contaminado.

**Cómo se detecta ahora.**
- Test `E-005: exportar dos veces produce el mismo resultado`.
- `buildFlattenedDoc()` trabaja sobre una copia serializada.

---

### E-008 · Los filtros de escáner se perdían al guardar

**Síntoma.** Magic Color / B-N / Grises se veían en pantalla y desaparecían en
el PDF descargado.

**Causa raíz.** El filtro se aplicaba con `putImageData` sobre el canvas de
pantalla, que la exportación nunca leía.

**Cómo se detecta ahora.**
- Test `E-008: el filtro aplicado se incrusta en el PDF`.
- La página marca `activeFilter` y `burnAnnotationsIntoDoc()` incrusta el canvas
  filtrado antes de las demás capas.

---

## Ciclo de vida del documento

### E-007 · Las anotaciones sobrevivían a operaciones de página

**Síntoma.** Tras rotar, duplicar o eliminar una página, las ediciones aparecían
en la página equivocada o se incrustaban dos veces al guardar.

**Causa raíz.** `loadPDFBuffer()` no reiniciaba `annotations`, `undoStack` ni
`redoStack`. Como las anotaciones se indexan **por número de página** y esas
operaciones renumeran las páginas, quedaban apuntando a otro sitio. Y al haber
pasado ya por el PDF, se volvían a quemar en la siguiente exportación.

**Cómo se detecta ahora.**
- Test `E-007: una operación de páginas consolida la edición y limpia el estado`.
- `loadPDFBuffer()` parte siempre de cero; toda operación de página llama antes a
  `commitAnnotationsToLiveDoc()`, que incrusta lo pendiente. Nada se pierde y
  nada se duplica.

---

### E-012 · Rotación antihoraria producía un `/Rotate` negativo

**Causa raíz.** `(anguloActual + deg) % 360` con `deg = -90` da `-90`. pdf-lib
lo acepta, pero varios visores no lo interpretan.

**Cómo se detecta ahora.** Test `E-012: rotar en sentido antihorario normaliza
el ángulo a [0,360)`. La fórmula es `(((a + deg) % 360) + 360) % 360`.

---

### E-014 · Fuga de workers de pdf.js

**Síntoma.** Con documentos grandes, el consumo de memoria crecía sin parar
tras varias rotaciones o duplicados.

**Causa raíz.** Cada `pdfjsLib.getDocument()` levanta su propio worker.
`state.pdfJsDoc` se reasignaba sin llamar a `destroy()`, así que cada worker
seguía vivo reteniendo el PDF completo. Cada operación de página deja uno.

**Cómo se detecta ahora.**
- Regla `liberar-recursos`.
- Test `E-014: recargar el documento libera el pdf.js anterior`.

---

### E-020 · Listeners globales acumulados por cada sello

**Causa raíz.** `makeStampInteractive()` registraba `pointermove` y `pointerup`
en `window` por cada sello, sin retirarlos jamás. Cada re-render de la página
añadía otro par permanente.

**Cómo se detecta ahora.**
- Regla `liberar-recursos`.
- Test `E-020: los sellos no dejan listeners globales acumulados`.
- Los listeners se registran al empezar el gesto y se retiran en el `pointerup`.

---

## Interfaz

### E-009 · Al ampliar el zoom la página se recortaba

**Síntoma.** Por encima del 100 %, el lado derecho de la página quedaba cortado
y **no había forma de desplazarse** hasta él.

**Causa raíz.** `transform: scale()` no ocupa espacio de maquetación: el
contenedor sigue midiendo lo mismo, así que no genera scroll. Un segundo
defecto apareció al arreglarlo: dimensionar un `sizer` a partir del ancho del
escenario mientras el escenario tenía `min-width: 100%` respecto al sizer creaba
una **realimentación** (el escenario llegó a medir 6948 px).

**Cómo se detecta ahora.**
- Test `E-009: al ampliar el zoom la página sigue siendo alcanzable con scroll`.
- Test `E-009: el escenario no se realimenta al cambiar el zoom varias veces`.
- `#pdf-zoom-sizer` reserva el tamaño escalado; el escenario usa
  `width: max-content` sin `min-width`; el tamaño natural se mide una vez por
  render y se cachea.

---

### E-015 · La cabecera desbordaba en móvil

**Síntoma.** En pantallas estrechas el botón "Descargar PDF" quedaba fuera y era
inalcanzable, porque `body` tiene `overflow: hidden`. Medido: 525 px de
contenido en un viewport de 375.

**Causa raíz.** Dos cosas. El grupo izquierdo no podía encogerse (sin `min-w-0`),
y el título del documento estaba marcado `hidden sm:flex`, pero el código hacía
`classList.remove('hidden')` al cargar — **eliminando la clase que lo ocultaba**.
Por debajo de `sm` no quedaba ninguna regla de display y volvía a `block`.

**Cómo se detecta ahora.**
- Test `E-015: la cabecera no desborda y el botón de descarga es alcanzable`,
  bajo el proyecto `movil`.
- El título usa `max-sm:!hidden`, que sobrevive a que se quite `hidden`.

> **Regla general:** si el JS va a hacer `classList.remove('hidden')` sobre un
> elemento, su visibilidad responsive **no puede** depender de esa clase.

---

### E-016 · Método declarado dos veces: los cajones móviles no existían

**Síntoma.** En móvil, los botones de miniaturas y de propiedades no hacían
absolutamente nada.

**Causa raíz.** `setupPanelsToggle()` estaba definido **dos veces** en la misma
clase. JavaScript no avisa: la segunda definición gana en silencio. La primera
—la que cableaba los cajones, el telón de fondo y el cierre por toque— nunca
llegó a ejecutarse.

**Cómo se detecta ahora.**
- Regla `no-miembros-duplicados`.
- Tests `E-016` en `responsive.spec.js`.

---

### E-017 · Los atajos de teclado desincronizaban la interfaz

**Causa raíz.** Las teclas V/P/T/U llamaban a `docState.setTool()` pero no
actualizaban el botón resaltado del ribbon ni el cursor: la interfaz mostraba
una herramienta y estaba activa otra.

**Cómo se detecta ahora.** Test `E-017`. Hay un único punto de verdad: el
listener de `toolChanged` actualiza ribbon y cursor, y todos los caminos pasan
por `setTool()`.

---

### E-018 · El selector "Más colores" no hacía nada

**Causa raíz.** Se escribía en `#ribbon-color-custom` al elegir una muestra,
pero nunca se leía: no tenía listener.

**Cómo se detecta ahora.** Regla `no-controles-huerfanos` y test `E-018`.

---

### E-019 · "Insertar otro PDF…" no tenía manejador

**Causa raíz.** La entrada del menú Archivo existía en el HTML desde el
principio; nadie la cableó nunca.

**Cómo se detecta ahora.** Regla `no-controles-huerfanos` y test `E-019`.

---

## Higiene del repositorio

### E-021 · 2.400 líneas de código muerto que se descargaban en cada visita

**Síntoma.** `index.html` cargaba cinco módulos (`organizer`, `annotator`,
`compressor`, `scanner`, `converter`) de una interfaz multipágina anterior.
Ninguno se inicializaba, todos buscaban IDs inexistentes y usaban
`window.appState.<modulo>`, propiedades que ya no existen.

**Por qué importa.** Además de ~90 KB inútiles por visita, es una trampa: una IA
que lea el repo encuentra dos implementaciones de cada función y no puede saber
cuál está viva. Peor aún, `annotator.js` engancha `[data-tool]` y `scanner.js`
engancha `[data-filter]` — los mismos selectores que usa la interfaz actual. Si
alguien llegara a llamar a sus `init()`, se duplicarían los manejadores.

**Resuelto.** Los cinco ficheros se borraron del repositorio. La regla
`no-codigo-muerto` impide que vuelva a aparecer un `js/**/*.js` que `index.html`
no cargue.

---

### E-022 · Clases de Tailwind que no existen

**Causa raíz.** `border-3` y `backdrop-blur-xs` no son utilidades de Tailwind v3
(`backdrop-blur-xs` es de v4). Se leían bien en el código y no pintaban nada.

**Cómo se detecta ahora.** Regla `no-clases-inventadas`, que comprueba cada
utilidad sospechosa contra el CSS realmente compilado.

---

### E-023 · Cache busting incoherente

**Causa raíz.** Los `?v=` de `index.html` se editaban a mano. Un `?v=` viejo
sirve JavaScript antiguo desde la caché del navegador y hace parecer que un
arreglo no funciona.

**Cómo se detecta ahora.** Regla `versiones-coherentes`: todos los `?v=` tienen
que coincidir con `version` de `package.json`, y ningún asset propio puede ir
sin `?v=`. `npm run version:sync` los actualiza.

---

### E-024 · El texto reemplazado sigue siendo extraíble del PDF · **ABIERTO**

**Síntoma.** Al editar o borrar una línea, el PDF exportado la muestra tapada
con un parche blanco — pero el texto original **sigue seleccionable y copiable**
del archivo, y cualquier extractor lo recupera.

**Causa raíz.** El enmascarado es una imagen pintada encima. Los objetos de
texto originales siguen intactos en el flujo de contenido de la página, debajo.
Es como tapar una palabra con corrector: en papel funciona; en un PDF, no.

**Estado: sin resolver.** No es un descuido, es una decisión de diseño
pendiente. Las dos salidas tienen coste:

- Reescribir el flujo de contenido de la página para eliminar los operadores de
  texto afectados. Es lo correcto, y es un trabajo considerable con pdf-lib.
- Rasterizar la página entera al exportar. Trivial, pero convierte todo el
  documento en una imagen: se pierde el texto seleccionable y sube mucho el peso.

**Implicación mientras siga abierto.** Esta herramienta **no sirve para redactar
información confidencial**. Conviene decirlo en la interfaz antes que dejar que
alguien lo suponga.

**Cómo se detecta ahora.** Los tests de exportación asertan sobre el resultado
**visual** (perfil de píxeles por franja), no sobre el texto extraído,
precisamente por esto. Lo descubrió el test `E-002` al fallar por la razón
equivocada.

---

### E-025 · El telón de fondo bloqueaba la cabecera en móvil

**Síntoma.** Con un cajón lateral abierto en móvil, ningún botón de la cabecera
respondía: había que cerrar el cajón antes de poder pulsar cualquier otra cosa.

**Causa raíz.** `#sidebar-backdrop` era `fixed inset-0 z-40`, cubriendo la
ventana entera — cabecera (z-30) y ribbon (z-20) incluidos — e interceptando
todos los eventos de puntero.

**Cómo se detecta ahora.** Test `E-016: los cajones laterales se abren, se
excluyen y se cierran`, que falla con un `intercepts pointer events` muy
explícito. El telón arranca ahora en `top: 106px`, igual que los cajones.

---

### E-026 · El visor se ensanchaba por encima de la pantalla

**Síntoma.** En móvil, el ajuste automático al ancho dejaba la página más ancha
que la pantalla.

**Causa raíz.** `.document-viewport` es un elemento flex, y los elementos flex
traen `min-width: auto`: no encogen por debajo del tamaño de su contenido. Una
página ancha lo empujaba más allá del ancho de la ventana, así que
`viewport.clientWidth` devolvía un valor inflado y `fitToWidth()` calculaba un
zoom demasiado grande.

Había además una fragilidad de origen: el ajuste al ancho se lanzaba con
`setTimeout(..., 150)`. En un móvil lento, ese plazo no basta.

**Cómo se detecta ahora.** Test `el documento se ajusta al ancho al abrirlo en
móvil`. `.document-viewport` lleva `min-width: 0` y `fitToWidth()` se llama
directamente tras el render, sin temporizador.

---

## Reglas de sostenimiento

Estas no vienen de un defecto de producto, sino de mantener vivo el sistema que
impide los anteriores:

- **`espejos-ia-sincronizados`** — `AGENTS.md` se replica a siete formatos de
  reglas (Claude, Gemini, Copilot, Cursor, Cline, Windsurf, Kiro). Si uno se
  queda atrás, esa IA trabaja con reglas viejas. La huella SHA-256 lo impide.
- **`errores-documentados`** — cada regla tiene que aparecer en este documento.
  Una regla sin historia se borra en cuanto estorbe.
- **`suite-viva`** — ni un `test.skip`, `test.only` o `test.fixme` puede llegar a
  `main`. La forma más fácil de perder esta red es desactivar tests uno a uno.
- **`rutas-prohibidas`** — nada de `.env`, claves, capturas sueltas, informes de
  test ni ficheros temporales de sesión (prefijo `_`) en el repositorio.
- **`deuda-acotada`** — `scripts/guards/deuda-tecnica.json` es la única forma de
  eximir un fichero de una regla, y solo puede **encoger**. Cada entrada necesita
  motivo y plan de resolución, se imprime en cada corrida y su número tiene un
  tope. Sin este límite, la lista de excepciones se convierte en el sitio donde
  se aparcan los problemas.

  Hoy está **vacío**, con el tope en 0: contuvo los cinco módulos de E-021
  hasta que se borraron.
