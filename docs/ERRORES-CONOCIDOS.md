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

#### Cómo lo resuelve Adobe Acrobat

Conviene saberlo antes de decidir, porque Acrobat **nunca usa el rectángulo
como mecanismo**: el recuadro que se ve es la *consecuencia* de haber quitado
el texto, no la forma de quitarlo. Son dos funciones distintas y ninguna se
parece a lo que hace hoy este editor.

**1. Editar PDF (edición de texto).** Acrobat interpreta el flujo de contenido
de la página, reconstruye los bloques de párrafo a partir de las tiradas de
glifos y, al escribir, **reescribe ese flujo**: cambia el operando de los
operadores `Tj`/`TJ`, recalcula el kerning del array y las matrices de texto
del resto de la línea, y vuelve a maquetar el bloque. Necesita la fuente: si
está incrustada como subconjunto y no trae el glifo que tecleas, o amplía el
subconjunto (cuando la licencia de incrustación lo permite) o sustituye por una
tipografía parecida — de ahí que a veces cambie el aspecto de la línea editada.
No se pinta ningún parche: **los glifos originales dejan de existir**.

**2. Redactar (censura).** Es deliberadamente de dos fases, y esa separación es
la parte importante del diseño:

- *Marcar para redacción*: crea anotaciones `/Subtype /Redact` (ISO 32000-1,
  §12.5.6.23). Aquí el contenido **sigue intacto** y Acrobat mantiene un aviso
  permanente en pantalla diciéndolo. Guardar en este punto produce exactamente
  el archivo que produce hoy este editor.
- *Aplicar redacciones*: la pasada destructiva. Por cada región, reescribe el
  flujo de contenido eliminando los glifos cuyo recuadro cae dentro — partiendo
  los arrays `TJ` y reemitiendo el posicionamiento para que el texto que
  sobrevive no se mueva —, recorta o elimina las imágenes y trazos afectados y
  *después* pinta el relleno. Además purga el texto de todos los demás sitios
  donde vive: XObjects, anotaciones y campos de formulario, marcadores,
  adjuntos, JavaScript del documento y metadatos (diccionario `Info` y XMP).
  Al terminar obliga a **guardar como archivo nuevo**, con reescritura completa:
  un guardado incremental dejaría la revisión anterior — y por tanto los glifos
  originales — dentro del mismo fichero.

La lección de diseño: Acrobat separa "marcado" de "eliminado" precisamente para
que nadie confunda uno con otro. **Este editor está permanentemente en la fase 1
con el aspecto de la fase 2.** Ese es el riesgo real, más que la carencia
técnica.

#### Las tres salidas, con su coste

**Ruta A · Cirugía del flujo de contenido** (lo que hace Acrobat, lo correcto).
Es viable en el navegador: pdf-lib da acceso al `Contents` de la página y a su
diccionario de recursos, y las anchuras de glifo salen del propio diccionario de
fuente — no hace falta rasterizar nada para calcular los recuadros. Se tokeniza
el flujo manteniendo la máquina de estados (`q/Q`, `cm`, `BT/ET`, `Tf`, `Tm/Td/
TD/T*`, `TJ/Tj/'/"`), se calcula el recuadro de cada tirada y se eliminan o
parten las que caen dentro de la máscara.
*Se puede escalonar*: empezar con **granularidad de operador completo** —
descartar íntegras las tiradas contenidas del todo en la máscara— cubre el caso
real de esta app, que enmascara líneas enteras ya detectadas por pdf.js. El
corte parcial de una tirada se deja para después.
Trabajo pendiente que no se puede saltar: varios `Contents` por página (array),
Form XObjects de forma recursiva y no romper la compresión del flujo. Es la
única ruta que elimina de verdad **y** conserva el texto seleccionable.

**Ruta B · Rasterizar la página al exportar.** Trivial de implementar y
destructiva de más: no queda texto extraíble, pero tampoco queda texto — se
pierde selección, búsqueda y accesibilidad en todo el documento y el peso sube
mucho. Sólo tiene sentido como opción explícita ("exportar aplanado"), nunca
como comportamiento por defecto.

**Ruta C · Rasterizar y volver a poner una capa de texto invisible** (`3 Tr`),
que es lo que hacen las tuberías de OCR. Los glifos originales desaparecen y el
documento sigue siendo buscable y copiable, pero con el texto *nuevo*. Mucho más
barata que la A; a cambio la página pasa a ser una imagen (peso, sin nitidez
vectorial al ampliar). Sirve de red de seguridad para los casos que la Ruta A
escalonada todavía no cubra.

#### Recomendación

1. **Ahora, sin esperar a la solución técnica:** copiar el modelo de dos fases de
   Acrobat en el lenguaje de la interfaz. La acción actual se llama "ocultar" y
   no "eliminar", y la exportación avisa de que el texto tapado sigue en el
   archivo. Coste cercano a cero y cierra el agujero de "alguien lo va a suponer".
2. **Después:** Ruta A por etapas, con la Ruta C como respaldo para las
   intersecciones parciales.
3. **Ruta B** sólo como opción marcada explícitamente por el usuario.

**Implicación mientras siga abierto.** Esta herramienta **no sirve para redactar
información confidencial**.

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

## Seguridad del documento

### E-027 · pdf.js compilaba fuentes con `eval()` (CVE-2024-4367)

**Síntoma.** No lo veía el usuario: es una vía de ejecución de código. Un PDF
manipulado a mala fe podía ejecutar JavaScript arbitrario dentro de la página al
abrirlo, con el mismo alcance que el resto de la app — incluida la red que la
CSP deja salir. En una herramienta cuya promesa es que **ningún PDF sale del
equipo del usuario**, abrir el archivo equivocado bastaba para romperla.

**Causa raíz.** `loadPDFBuffer()` llamaba a `pdfjsLib.getDocument()` sin
`isEvalSupported: false`. Con esa opción por defecto, pdf.js compila las
expresiones de posicionamiento de glifos de ciertas fuentes con `eval()`. El
contenido de un fichero abierto por el usuario es **entrada no confiable** (el
mismo principio que E-003), y la CSP del proyecto permite `'unsafe-eval'`, así
que nada aguas abajo lo frenaba. Es la configuración exacta que el aviso de
CVE-2024-4367 marca como explotable; el parche de fondo llegó en pdf.js 4.2.67.

**Cómo se detecta ahora.**
- Regla `pdfjs-sin-eval` — exige `isEvalSupported: false` en toda llamada a
  `getDocument()`. Es un invariante de configuración, como `liberar-recursos`:
  el guard falla antes del arreglo y pasa después.
- `getDocument()` en `loadPDFBuffer()` pasa `isEvalSupported: false`.
- La suite E2E completa sigue en verde con la opción activada: prueba que
  desactivar `eval` no rompe el renderizado de fuentes ni de cMaps.

**Pendiente (no lo cierra esta entrada).** El vendorizado `js/pdf.min.js` es
3.11.174; la rama 4.x trae el parche de raíz pero solo se distribuye como módulo
ES, lo que choca con la arquitectura de scripts globales. Desactivar `eval` es
la mitigación correcta y suficiente mientras tanto; actualizar el motor va con
la reconstrucción de los cimientos. Retirar `'unsafe-eval'` de la CSP sería
defensa en profundidad y necesita permiso explícito (AGENTS.md §5).

---

## Motor PDFium

### E-028 · Los getters de cadena de PDFium devolvían basura con textos largos

**Síntoma.** Ya se sufrió una vez en el PR #42: `getNotes` con un buffer fijo de
4096 bytes devolvía 4 caracteres de basura para una nota de 5000. El mismo
patrón seguía vivo en `getPageText`: un run de texto de más de ~511 caracteres
UTF-16 (buffer fijo de 1024 bytes) o un nombre de fuente de más de 255 bytes
(buffer fijo de 256 bytes) se leían truncados o directamente como basura.

**Causa raíz.** Los getters de cadena de PDFium (`FPDFTextObj_GetText`,
`FPDFFont_GetBaseFontName`, `FPDFAnnot_GetStringValue`, `FPDFText_GetText`...)
no truncan como una API de cadenas en C convencional: si el buffer es menor
que lo necesario, **no escriben nada en él**. Leer ese buffer da memoria WASM
sin inicializar —basura—, no un texto cortado por la mitad. Cualquier tamaño
fijo elegido "a ojo" (1024, 256, 4096...) es solo cuestión de tiempo hasta que
un documento real lo supere.

**Cómo se detecta ahora.**
- Test `getPageText no trunca ni devuelve basura en un run de texto largo
  (>511 caracteres UTF-16)` en `tests/unit/PdfiumEngine.longtext.test.ts` —
  falló con `expected 4 to be 1200` antes del arreglo, el mismo síntoma que el
  PR #42.
- El caso de `FPDFFont_GetBaseFontName` con un nombre largo no tiene test de
  comportamiento: `FPDFPageObj_NewTextObj` exige un nombre de la familia
  estándar de 14 fuentes y rechaza (objeto nulo) cualquier nombre no
  reconocido, incluso uno corto, así que no hay ruta para producirlo desde
  este motor en pruebas. Queda cubierto por el arreglo por construcción
  (mismo helper que el resto) y por la regla determinista.
- Regla `pdfium-buffer-fijo` — bloquea cualquier llamada a un getter de cadena
  de PDFium (`FPDF\w*_Get\w*(Text|Name|StringValue|MetaText|Label)\w*\(`) cuyo
  último argumento sea un literal numérico distinto de 0.
- `leerCadenaPdfium()` en `src/engine/pdfium/mem.ts` implementa el patrón de
  dos llamadas una sola vez (sondeo con tamaño 0 → tamaño exacto → buffer
  justo) y lo usan los tres getters de `PdfiumEngine.ts`: `readTextRun()`
  (texto y nombre de fuente) y `getNotes()`. Antes `getNotes` ya tenía el
  patrón correcto pero duplicado a mano; ahora hay un único sitio.

---

### E-031 · Un outline (marcadores) hostil con un ciclo colgaría el recorrido

**Síntoma.** No llegó a producirse: se previno al implementar el panel de
marcadores (fase 1, solo lectura y navegación). Un PDF construido a mala fe
puede definir un árbol de marcadores donde el `/Next` de un hermano, o el
`/First` de un hijo, apunte hacia atrás a un nodo ya visitado — un ciclo. Un
recorrido que siga esos punteros sin más entraría en bucle infinito y colgaría
la pestaña al abrir ese documento.

**Causa raíz (de diseño, anticipada).** El árbol de marcadores de PDFium se
recorre con punteros (`FPDFBookmark_GetFirstChild`/`GetNextSibling`) que
vienen directamente del propio documento — que es entrada no confiable, igual
que el texto (E-003) o las fuentes que compilan con `eval` (E-027). Nada en la
API del motor garantiza que ese grafo sea realmente un árbol.

**Cómo se detecta ahora.** `PdfiumEngine.getOutline()`
(`src/engine/pdfium/PdfiumEngine.ts`) recorre con tres cotas: un `Set` de
handles de marcador ya visitados corta cualquier ciclo (hermano o hijo que
apunte hacia atrás), un límite de profundidad (`OUTLINE_MAX_DEPTH = 32`) acota
la recursión, y un límite total de nodos (`OUTLINE_MAX_NODES = 10000`) acota
el trabajo aunque no haya ciclo. El fixture `outline-ciclo.pdf`
(`tests/fixtures/generar-fixtures.mjs`) construye un outline de dos nodos cuyo
segundo `/Next` apunta de vuelta al primero; el test `getOutline termina sin
colgarse ante un outline hostil con un ciclo...`
(`tests/unit/PdfiumEngine.outline.test.ts`) comprueba que el recorrido termina
y que cada nodo aparece como mucho una vez.

---

## Capa de texto vivo (app nueva)

### E-029 · La capa de texto duplicaba cada línea en negro sans-serif encima del render

**Síntoma.** En reposo (sin tocar nada) cada línea del PDF se veía dos veces:
el render real del motor (PDFium, con su fuente y color) y, superpuesto en la
misma posición, el mismo texto otra vez en negro `sans-serif` con el alto de
la caja como tamaño de fuente. Además, un tirador morado (`.run-drag`) quedaba
visible sobre cada línea aunque no se estuviera interactuando con ella. Es la
queja central del dueño del producto: "al editar cambia la fuente / no queda
como estaba". Acrobat y PDF Agile no hacen esto: en reposo se ve solo el PDF;
un contorno aparece al pasar el ratón; el texto solo se hace visible —con su
tipografía real— mientras se edita esa línea.

**Causa raíz.** `TextLayer.build()` (`src/ui/TextLayer.ts`) ponía
`block.textContent = run.text` y `font: ${r.height}px sans-serif` **siempre**,
no solo durante la edición. El `<div class="run">` es el hitbox necesario para
seleccionar/editar/arrastrar esa línea, pero no tenía ninguna razón para pintar
el texto en reposo: ese texto ya está en el `<canvas>` de abajo, pintado por el
motor con la fuente, el tamaño y el color reales. Pintarlo dos veces con una
aproximación (altura de caja como tamaño, `sans-serif` fija) es exactamente el
"cambia la fuente" que se reporta.

**Arreglo.** En reposo la `.run` es invisible: `color: transparent`, sin
fondo, sin contorno, tirador en `opacity: 0` — todo por clase CSS en
`index.next.html`, no inline. Al pasar el ratón o al seleccionar (clase
`.selected`, que `TextLayer` pone en clic y quita de las demás runs de la
página) aparece un contorno sutil y el tirador. Solo al entrar en edición
(`.editing`) el fondo se vuelve blanco — la caja de esa máscara sigue saliendo
de la geometría **original** del run (`run.boxPt` → `geom.rectPtToCss`), nunca
de `offsetHeight` en edición (E-002) — y el texto se hace visible con la mejor
aproximación de su tipografía real: color = `run.color`, tamaño = `run.sizePt`
convertido a px CSS con `geom.scale` (no con el alto de la caja), familia
deducida de `run.fontName` en la función pura `cssFontFor()`
(`src/ui/cssFontFor.ts`: Times/serif → `serif`, Courier/mono → `monospace`,
resto → `sans-serif`; `Bold` → peso 700; `Italic`/`Oblique` → cursiva). Esas
tres propiedades (color, fuente, tamaño) son datos del documento, no estado de
UI, así que se fijan en línea igual que la geometría — el resto de estados
(reposo/hover/seleccionada/edición) es CSS puro por clase.

**Cómo se detecta ahora.**
- `tests/e2e/next/fidelidad-reposo.spec.ts`, prueba de oro de píxeles: capturar
  la página en reposo, ocultar toda `.run` por script (`visibility: hidden`) y
  volver a capturar — **antes del arreglo los dos PNG diferían** (texto
  fantasma); ahora `Buffer.compare` da `0`. Las otras dos pruebas del mismo
  fichero fijan `getComputedStyle(run).color === 'rgba(0, 0, 0, 0)'` y el
  tirador en `opacity: '0'` en reposo, y que al editar el fondo sea blanco, el
  color rojo del fixture, la familia contenga `serif` sin ser `sans-serif` y el
  tamaño ronde `18 × escala` px.
- `tests/unit/cssFontFor.test.ts` — la función pura de mapeo fuente → CSS.
- No hay regla determinista nueva: el patrón (pintar datos del documento en
  una capa que se superpone al render del motor) no se presta a un grep
  estático fiable — no hay una firma sintáctica única que lo distinga de un uso
  legítimo de `textContent`/`color` en otra capa (notas, formularios, resaltado
  ya lo usan con intención). La defensa es la prueba de oro de píxeles de
  arriba, que además cubre cualquier regresión futura del mismo síntoma aunque
  cambie el mecanismo.

---

### E-030 · El texto en edición quedaba desplazado en vertical respecto al original

**Síntoma.** Al hacer clic sobre una línea para editarla, el texto (con su
tipografía real, arreglo de E-029) aparecía descolocado: el contorno de la
caja no enmarcaba las letras, las cruzaba, y la línea base no coincidía con
la del PDF de debajo. En Acrobat y PDF Agile, al editar, el texto cae EXACTO
en su sitio — misma línea base, mismo x de inicio.

**Causa raíz.** El bloque en edición se posicionaba y dimensionaba con
`run.boxPt` — la caja ajustada a los GLIFOS (`FPDFPageObj_GetBounds`), que
para la mayoría de fuentes es más baja que el tamaño real de fuente (no
incluye el hueco de línea ni, a veces, ascendentes/descendentes completos) —
y con `line-height` igual a ese alto. Como `sizePt` real es mayor que
`boxPt.hPt`, la línea base que el navegador calcula para ese `line-height`
no coincide con la línea base real del PDF.

**Arreglo.** `TextRun` (`src/engine/PdfEngine.ts`) gana `originPt`: el origen
real de la línea base del objeto de texto — (e, f) de su matriz
(`FPDFPageObj_GetMatrix`), leído en `readTextRun()`
(`src/engine/pdfium/PdfiumEngine.ts`). Al ENTRAR en edición, `TextLayer`
(`src/ui/TextLayer.ts`) reposiciona el bloque para que su línea base caiga en
`originPt` convertido a px CSS con `PageGeometry.ptToCss` (nunca con
`boxPt`), con `line-height` = ascenso + descenso MEDIDOS de la fuente
(`measureFontAscent()`, `src/ui/measureFontAscent.ts`, vía
`CanvasRenderingContext2D.measureText().fontBoundingBox{Ascent,Descent}`) —
no el tamaño de fuente a secas, que deja un "half-leading" desconocido y
desalinea unos px. `top = líneaBase − ascenso`; `left = origen.x`.

Como el bloque ahora se MUEVE al editar, ya no garantiza por sí solo tapar la
caja original (E-002). Un elemento `.run-mask` aparte, posicionado SIEMPRE
con la caja original `boxPt` (nunca reposicionado, nunca derivado del bloque
en edición), es quien tapa el texto original pase lo que pase con el bloque.
Al salir de edición (`commit()`), el bloque restaura exactamente sus valores
de reposo (`left/top/height/lineHeight` de `boxPt`), igual con Escape.

**Cómo se detecta ahora.**
- Test `getPageText devuelve originPt = punto de inserción del texto` en
  `tests/unit/PdfiumEngine.originPt.test.ts` (motor real): inserta texto en
  (72, 700) y exige `originPt` ≈ (72, 700), ±0.5 pt.
- Test E2E `linea-base-edicion: al editar, la línea base y el x de inicio
  coinciden con el original` en `tests/e2e/next/linea-base-edicion.spec.ts`:
  mide la línea base REAL con un marcador de alto 0 y `vertical-align:
  baseline`, y la compara con `originPt` convertido a px CSS. Tolerancia
  ±1.5 px, para línea base y para x de inicio.
- La prueba de oro de píxeles de `fidelidad-reposo.spec.ts` sigue en verde:
  la geometría de reposo no cambia, solo la de edición.

---

### E-032 · Clic en una miniatura y "Eliminar página" borraba otra página distinta

**Síntoma.** El usuario hacía clic en la miniatura 3, el indicador seguía
mostrando la página que ya estaba abierta, pulsaba "Eliminar página" y se
borraba la página 1 (o cualquier otra, la que estuviera activa antes del
clic) en vez de la 3. Lo mismo con prev/next y con los marcadores: el PR #49
tuvo que usar páginas A4 grandes en su fixture (`marcadores.pdf`) para que su
propio test E2E no fuera flaky por este defecto.

**Causa raíz.** `App.goToPage(i)` (`src/ui/App.ts`) solo llamaba a
`viewer.scrollToPage(i)` y confiaba en que el `IntersectionObserver` del
`Viewer` (`src/ui/Viewer.ts`) actualizara `currentPage` al detectar la
página "más visible" tras el scroll. Pero si el scroll no se movía —porque
el destino ya estaba visible, porque todas las páginas cabían a la vez en el
viewport, o porque el scroll ya estaba al final— el observer nunca disparaba
y `currentPage` se quedaba con el valor anterior. Todas las operaciones "de
la página actual" (eliminar, rotar, duplicar, subir/bajar, extraer, OCR,
insertar imagen…) actúan sobre `currentPage`, así que la UI mostraba una
selección que no era la que de verdad iban a afectar los botones.

**Arreglo.** `goToPage` pasa a ser el único punto de entrada para cambiar de
página (prev/next, clic en miniatura, clic en marcador ya pasaban todos por
ahí) y ahora fija `currentPage`, el indicador y la miniatura activa **antes**
de tocar el scroll — la selección explícita del usuario manda,
independientemente de si el scroll se mueve o no. `Viewer.scrollToPage`
fija además un "pin" (`pinnedPage`): mientras esté activo, el
`IntersectionObserver` no puede reafirmar una página distinta, ni siquiera
si calcula que "la más visible" es otra. Solo un scroll real del usuario
libera el pin y devuelve el control al observer; el pin también se limpia en
`Viewer.rebuild()`, porque una operación de página puede renumerar los
índices y `App.onReload` recalcula `currentPage` por su cuenta en ese caso.

**Corrección de revisión (mismo defecto, otro disparador).** La primera
versión de este arreglo solo liberaba el pin con los eventos `wheel` y
`touchmove`. Eso dejaba fuera CUALQUIER otra forma de desplazar el visor:
teclado (PageDown/flechas/Home/End/espacio con el visor enfocado) o arrastrar
la barra de scroll con el ratón. Tras una navegación explícita, si el
usuario seguía con el teclado o la barra en vez de la rueda, el indicador
volvía a quedarse congelado y "Eliminar página" podía volver a actuar sobre
la página equivocada — la revisión de código de este PR lo encontró antes de
fusionar.

La solución no depende de enumerar gestos de entrada, sino de distinguir
**scroll programático** de **scroll del usuario** por su origen, no por su
disparador. `Viewer.scrollToPage()` marca `programmaticScroll = true` justo
antes de llamar a `scrollIntoView` y arma un temporizador de respaldo de
~150ms (`armScrollEndFallback()`); ese respaldo se reinicia en cada evento
`scroll` mientras el flag siga activo y se cierra de inmediato con el evento
nativo `scrollend` en cuanto el navegador lo soporta (Chromium/Firefox). El
listener de `scroll` del visor consulta ese flag: si sigue `true`, el evento
es un eco del propio `scrollToPage` y no toca el pin; si ya es `false`, es
scroll real del usuario —venga de teclado, barra de scroll, o cualquier otra
vía— y libera el pin. `wheel`/`touchmove` se conservan como liberación
inmediata aparte, porque son intención del usuario incluso si ocurren
*durante* un `scrollToPage` todavía en vuelo (p. ej., el usuario mueve la
rueda mientras el smooth-scroll programático sigue animando). Si
`scrollIntoView` no dispara ningún `scroll` porque el destino ya era
visible, el temporizador de respaldo —armado también dentro de
`scrollToPage`, no solo en el listener de `scroll`— es quien cierra la
ventana igualmente.

**Cómo se detecta ahora.** `tests/e2e/next/pagina-actual.spec.ts`:
- El test del defecto destructivo: abre `paginas-pequenas.pdf` (4 páginas de
  200×120 pt que caben todas a la vez en el viewport de 1440×900, fixture
  nuevo en `tests/fixtures/generar-fixtures.mjs`, cada página con un texto
  único "PAGINA-1".."PAGINA-4"), clic en la miniatura 3, `#page-indicator`
  debe decir "3 / 4"; pulsa "Eliminar página" y comprueba que "PAGINA-3" ya
  no existe en la capa de texto mientras las otras tres siguen ahí. Antes del
  arreglo fallaba con el indicador en "1 / 4" (nunca cambiaba) y, si se
  seguía el flujo hasta el final, se borraba la página equivocada.
- `#btn-next`/`#btn-prev` avanzan `currentPage` aunque las 4 páginas quepan
  en pantalla.
- Clic en un marcador (`paginas-pequenas-marcadores.pdf`, mismo tamaño de
  página con un outline de un nodo por página) fija el indicador a su
  página.
- El scroll manual con la rueda (`page.mouse.wheel`) sobre `nativo.pdf`
  (páginas A4, que no caben todas) sigue actualizando el indicador con
  normalidad.
- (Corrección de revisión) El teclado (`page.keyboard.press('End')` con el
  visor enfocado — `#viewer` gana `tabIndex = -1` en `App.ts` para poder
  recibir foco por script) libera el pin y actualiza el indicador. Antes de
  esta corrección se quedaba en "1 / 2".
- (Corrección de revisión) Un scroll inyectado directamente en `scrollTop`
  sin pasar por `scrollToPage()` ni disparar `wheel`/`touchmove` —lo mismo
  que hace el navegador al arrastrar el thumb de la barra de scroll— también
  libera el pin. Antes de esta corrección se quedaba en "1 / 2".

Regla `navegacion-por-gotopage`: `Viewer.scrollToPage()` solo se puede llamar
desde dentro de `App.goToPage()`. No cubre el invariante completo (el orden
"fijar `currentPage` antes de desplazar" no es una firma sintáctica que un
grep pueda verificar sin falsos positivos — de eso responde el test E2E de
arriba), pero sí cierra la vía más probable de que vuelva a romperse: que un
botón o un manejador nuevo llame a `viewer.scrollToPage(i)` directamente en
vez de pasar por `goToPage(i)`, saltándose por completo la fijación de
`currentPage`.

---

### E-033 · `npm run verify` en local podía probar un build viejo de la app nueva

**Síntoma.** `playwright.config.js` define dos `webServer`. El de la app nueva
ejecuta `npm run build:next && npm run preview:next` en el puerto 4173 con
`reuseExistingServer: !process.env.CI`. En local, si quedaba vivo un
`vite preview` de una sesión anterior escuchando en 4173, Playwright lo
**reutilizaba sin reconstruir**, y los E2E de `tests/e2e/next/` corrían contra
el `dist/` viejo. `npm run verify` podía dar verde (o rojo) sobre código que ya
no existía. Ocurrió en el PR #52: un test "antes del arreglo" daba un
resultado falso hasta matar el puerto a mano y reconstruir.

**Causa raíz.** A diferencia de `node server.js` (el webServer de la app
vieja), que lee los ficheros del disco en cada petición y por tanto nunca
sirve algo desactualizado aunque se reutilice el proceso, `vite preview` sirve
un `dist/` **congelado en el instante del build**. `reuseExistingServer: true`
(o `!process.env.CI`, que es `true` en local) asume que "un servidor vivo en
ese puerto es equivalente a arrancarlo de nuevo" — una suposición correcta
para `server.js` y falsa para `vite preview`, porque el build no vuelve a
correr. AGENTS.md dice que `npm run verify` es la verdad; este supuesto lo
rompía en local para cualquier IA o humano.

**Cómo se detecta ahora.**
- El webServer de `build:next` en `playwright.config.js` fija
  `reuseExistingServer: false` **siempre**, incluso en local. Si el puerto
  4173 ya está ocupado, Playwright falla alto con "puerto ya en uso" en vez de
  probar código viejo en silencio — el fallo es el comportamiento correcto.
- `node server.js` (app vieja) sigue con `reuseExistingServer: !process.env.CI`
  a propósito: sirve el disco en vivo, así que reutilizarlo nunca da código
  viejo.
- `scripts/liberar-puertos.mjs` (`npm run e2e:liberar`) libera 4173 (y 3100)
  cuando el fallo por puerto ocupado estorba, pero **no** se ejecuta dentro de
  `verify`: matar procesos automáticamente en un pipeline es invasivo, y el
  propio mensaje de error de Playwright ya explica qué comando ejecutar. Solo
  mata el proceso que escucha en el puerto si su nombre es `node` o `vite`;
  si no puede determinar el nombre, avisa y no lo toca.
- Regla `webserver-next-no-reusar` — exige `reuseExistingServer: false` en la
  entrada de `webServer` cuyo `command` contenga `build:next`.
- Test `sobre el repo real no encuentra nada: playwright.config.js ya tiene
  reuseExistingServer: false en build:next` en `reglas.test.mjs`.

---

## Reglas de sostenimiento

Estas no vienen de un defecto de producto, sino de mantener vivo el sistema que
impide los anteriores:

- **`motor-encapsulado`** — la API cruda `FPDF_` del motor PDFium solo puede
  aparecer en `src/engine/`. Toda la reconstrucción (spec de cimientos §3) se
  apoya en que el motor sea reemplazable detrás de la interfaz `PdfEngine`: si la
  UI, el modelo o los comandos llaman a `FPDF_*` directamente, esa capa deja de
  aislar y cambiar de motor se vuelve imposible. Nace con el subproyecto 1 de la
  reconstrucción, no de un defecto de producto.
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
