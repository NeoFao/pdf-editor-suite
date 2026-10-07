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
la reconstrucción de los cimientos.

**Actualización (2026-09-29, defensa en profundidad, E-046).** Con permiso
explícito del dueño (paso 3 del cutover de despliegue), `'unsafe-eval'` se
retiró de `script-src` en `vercel.json` y `server.js` (sustituido por
`'wasm-unsafe-eval'` para que el motor PDFium siga compilando WASM). Ya no
hace falta confiar solo en `isEvalSupported: false`: aunque algo lo pasara por
alto, la CSP bloquea el `eval()`/`new Function()` igualmente. Verificado sin
romper nada bajo los 161 tests E2E del repo — ver E-046 para el detalle y los
tests que lo prueban bajo la CSP real.

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

### E-034 · Un gesto de puntero solo terminaba en `pointerup`: `pointercancel` lo dejaba colgado

**Síntoma.** Encontrado en revisión del PR #55 (sello interactivo), antes de
fusionar. Todo gesto de arrastre de la app nueva (mover/redimensionar una
imagen en `ImageLayer`, arrastrar una línea de texto en `TextLayer`, arrastrar
una miniatura para reordenar en `App.beginThumbDrag`) armaba
`window.addEventListener('pointermove'/'pointerup', …)` en el `pointerdown` y
los retiraba en el `pointerup`. El navegador puede no entregar jamás ese
`pointerup`: un gesto táctil interrumpido por el scroll del sistema, un
cambio de pestaña o de ventana, o la pérdida de la captura del puntero
mandan `pointercancel` en su lugar. Sin manejarlo, dos cosas se rompían a la
vez: los `removeEventListener` de `window` nunca llegaban a ejecutarse (la
misma familia de fuga que E-014/E-020, §2.6) y cualquier estado temporal del
gesto se quedaba a medias hasta recargar la página — en `ImageLayer`,
`document.body.style.userSelect` se quedaba en `'none'` (**toda la app**
perdía la selección de texto, no solo el marco de la imagen); en el arrastre
de miniaturas, la miniatura se quedaba atenuada (`.thumb-dragging`) con el
indicador de inserción todavía en el DOM.

**Causa raíz.** Cada gesto trataba `pointerup` como el único punto de salida
posible, sin ningún manejador de `pointercancel` que revirtiera la vista
previa y retirara los listeners por esa vía.

**Arreglo.** `src/ui/gesto.ts` (`registrarGesto()`) es el ÚNICO sitio de la
app que engancha `pointermove`/`pointerup`/`pointercancel` de `window` o
`document`. Todo gesto pasa por él: `onMove`/`onUp` para el camino normal,
`onCancel` para `pointercancel` (y Escape, si `cancelarConEscape` — ya
existía para el arrastre de miniaturas) — `onCancel` deshace la vista previa
(geometría del marco/bloque a su posición de reposo, indicador de
inserción) y NUNCA dispara un comando; `onSettle` cubre la limpieza común a
ambos caminos (restaurar `userSelect` en `ImageLayer`). Los tres sitios
(`ImageLayer.beginMove`/`makeHandle`, `TextLayer.makeDragHandle`,
`App.beginThumbDrag`) se reescribieron sobre este helper. De paso,
`SignaturePad` (que usa listeners del propio `<canvas>`, no de
`window`/`document` — sin riesgo de fuga, pero con el mismo defecto de
estado: `drawing` se quedaba en `true`) gana un `pointercancel` que llama al
mismo `stop()` que `pointerup`/`pointerleave`. La captura de pluma de
`Viewer.attachPenCapture` ya trataba `pointercancel` correctamente (usa
`setPointerCapture` sobre un elemento propio, no listeners globales) — se
revisó y no necesitó cambios.

**Cómo se detecta ahora.**
- `tests/e2e/next/sello.spec.ts`: empieza a arrastrar la imagen seleccionada
  (`pointerdown` + varios `pointermove`), despacha `pointercancel` sobre
  `window` y comprueba que (a) `document.body`'s `userSelect` ya no es
  `none`, (b) el rect de la imagen en el motor (tras guardar) no cambió, y
  (c) un `pointermove` posterior no mueve el marco en el DOM — antes del
  arreglo, (a) fallaba (`userSelect` se quedaba en `'none'`) y (c) fallaba
  (el marco seguía el cursor: el listener nunca se había retirado).
- `tests/e2e/next/mover.spec.ts`: arrastra el tirador de una línea, cancela
  con `pointercancel`, comprueba que el bloque vuelve a su posición de
  reposo en el DOM y que el PDF exportado no cambió — antes del arreglo el
  bloque se quedaba desplazado (sin restaurar) y seguía el cursor tras el
  cancel.
- `tests/e2e/next/arrastrar-miniaturas.spec.ts`: arrastra una miniatura más
  allá del umbral, cancela con `pointercancel`, comprueba que
  `.thumb-dragging`/`.thumb-drop-indicator` desaparecen y que el orden de
  páginas no cambió al guardar — antes del arreglo la miniatura quedaba
  atenuada con el indicador colgado y un `pointermove` posterior lo seguía
  reposicionando.
- Regla `gesto-con-cancelacion` — ningún fichero de `src/**/*.ts` salvo el
  propio `src/ui/gesto.ts` puede enganchar `pointermove`/`pointerup`/
  `pointercancel` de `window`/`document` directamente. Deliberadamente más
  estricta que "todo `pointerup` debe tener su `pointercancel`": esa versión
  se cumple con un `pointercancel` que no hace nada útil (p. ej. uno vacío)
  y el defecto real —vista previa sin deshacer— seguiría colando. Centralizar
  el enganche en un único fichero pequeño y auditado a mano es la defensa
  robusta. **Límite conocido:** no impide que alguien reimplemente el mismo
  patrón roto DENTRO de `gesto.ts` — ese fichero sigue dependiendo de
  revisión humana, como el propio helper de E-028
  (`leerCadenaPdfium`)/E-032 (disciplina de `goToPage`).

---

### E-035 · `Mem.HEAPU8` capturado una vez se desconectaba al crecer la memoria WASM

**Síntoma.** Encontrado implementando el lote E (filtros/compresión de
imagen, §9 #25 y #29), al procesar una imagen grande (~2000×2000 px o más:
el caso real de una página escaneada a buena resolución). `replaceImageJpeg`
—y, por el mismo motivo, cualquier operación que procese suficientes
píxeles como para que el heap WASM tenga que crecer— fallaba con
`TypeError: Cannot perform Construct on a detached ArrayBuffer` a mitad de
la llamada, dentro del propio motor PDFium.

**Causa raíz.** `makeMem()` (`src/engine/pdfium/mem.ts`) construía el
objeto `Mem` con `HEAPU8: m.HEAPU8` — una propiedad de datos normal,
evaluada UNA SOLA VEZ en el momento de crear el motor (`PdfiumEngine.create()`).
Cuando el módulo Emscripten necesita más memoria de la reservada
inicialmente, no la amplía en sitio: crea un `ArrayBuffer` nuevo y
reasigna sus propias vistas (`Module.HEAPU8`, etc.) para que apunten ahí,
dejando el `ArrayBuffer` anterior **desconectado** ("detached"). Cualquier
`Uint8Array` construido sobre ese buffer antiguo —como el `HEAPU8`
capturado en `makeMem()`— pasa a ser inválido: hasta un simple
`.subarray()` sobre él lanza esa excepción. Como casi todas las operaciones
del motor tocan pocos KB, el heap raramente necesita crecer y el defecto
llevaba invisible desde que `mem.ts` existe; una imagen de varios
megapíxeles (RGBA sin comprimir) sí lo dispara con facilidad. Nótese que
`copyIn()`/`wide()`, en el mismo fichero, nunca sufrieron esto: leen
`m.HEAPU8` directamente en cada llamada (variable de closure, no un campo
capturado), así que siempre ven la vista vigente.

**Cómo se detecta ahora.**
- Test `replaceImageJpeg con una imagen grande no falla por buffer WASM
  desconectado` en `tests/unit/PdfiumEngine.heapgrowth.test.ts`: inserta una
  imagen de 2000×2000 y sustituye su bitmap por un JPEG real (generado con
  Chromium vía Playwright, igual que en `PdfiumEngine.imagepixels.test.ts`)
  — fallaba con el `TypeError` de arriba antes del arreglo.
- `Mem.HEAPU8` (`src/engine/pdfium/mem.ts`) es ahora un **getter**
  (`get HEAPU8() { return m.HEAPU8; }`), no un valor capturado: cada
  `mem.HEAPU8` relee la vista actual del módulo, crezca o no el heap entre
  medias.
- Regla `heapu8-siempre-getter` — bloquea que `mem.ts` vuelva a declarar
  `HEAPU8: m.HEAPU8` como propiedad de datos en vez de getter.

---

### E-036 · `save()` fugaba un slot de la tabla de funciones de WASM en cada llamada

**Síntoma.** No llegó a producirse un fallo visible en esta sesión (ver
"Investigación" más abajo), pero es una fuga de memoria de crecimiento
ilimitado: en una sesión de edición larga, cada acción con deshacer hace un
`c.engine.save(c.doc)` por snapshot, además de los guardados de exportar e
imprimir. Sin arreglar, la tabla de funciones indirectas de WASM crece un
slot por cada uno de esos guardados y no se libera nunca hasta recargar la
página.

**Causa raíz.** `save()` (`src/engine/pdfium/PdfiumEngine.ts`) registraba el
callback `WriteBlock` de `FPDF_FILEWRITE` con
`this.mem.addFunction(..., 'iiii')` en cada llamada, para que PDFium pueda
invocar código JS por cada bloque que escribe. Ese callback ocupa una entrada
nueva de la tabla de funciones indirectas de WebAssembly hasta que se libera
explícitamente con `removeFunction()` — la propia tabla no tiene recolector
de basura. `save()` llamaba a `mem.free(fw)` en el `finally` para el buffer
del struct `FPDF_FILEWRITE`, pero nunca a `mem.removeFunction(cb)`: cada
guardado dejaba un slot ocupado para siempre. El mismo patrón, con el mismo
riesgo, ya se había resuelto correctamente en `replaceImageJpeg()` (PR #57),
que sí hace `removeFunction(cb)` en su `finally` — `save()` era la única
llamada a `addFunction()` del motor que se había quedado sin su contraparte.

**Investigación: ¿`addFunction()` llega a lanzar con el build actual?** No.
Se probó con hasta 200 000 `save()` seguidos sobre un PDF de una página en
blanco (72×72 pt) sin que `addFunction()` lanzara ninguna excepción: el
módulo `@embedpdf/pdfium` de este proyecto está compilado con crecimiento de
tabla permitido (comportamiento por defecto de Emscripten moderno,
equivalente a `ALLOW_TABLE_GROWTH`), así que la tabla simplemente sigue
creciendo — WebAssembly no tiene un tope propio salvo el que imponga el
motor JS/wasm del navegador. Con otro build de PDFium compilado con
`RESERVED_FUNCTION_POINTERS` fijo y sin crecimiento, el mismo defecto sí
lanzaría `TypeError: Table.length is out-of-bounds` (o similar) en cuanto se
agotaran los slots reservados — por eso el arreglo es correcto
independientemente de cómo esté compilado el módulo en cada momento: no hay
que esperar a que reviente para que sea un defecto real.

**Cómo se detecta ahora.**
- Test `E-036: 500 save() seguidos no agotan la tabla de funciones indirectas
  de WASM` en `tests/unit/PdfiumEngine.savetablefeak.test.ts` (motor real).
  Mide indirectamente el tamaño de la tabla: toma una "sonda" —
  `addFunction()` seguido de `removeFunction()` inmediato— antes y después de
  500 `save()`, y compara los índices que devuelve `addFunction()`. Los
  índices liberados se reciclan (el primero libre disponible), así que si
  `save()` no libera los suyos, cada sonda nueva tiene que pedir un índice
  más alto: la sonda de después caía exactamente 500 por encima de la de
  antes (`expected 500 to be less than or equal to 2`) antes del arreglo, y
  ahora la diferencia es 0.
- `save()` libera su callback con `this.mem.removeFunction(cb)` en el mismo
  `finally` donde ya liberaba el buffer del `FPDF_FILEWRITE`.
- Regla `addfunction-con-removefunction` — heurística por FICHERO, no por
  método: en cada `.ts` de `src/engine/**` (salvo el propio `mem.ts`, ver
  abajo), el número de llamadas a `addFunction(` no puede superar al número
  de llamadas a `removeFunction(` en ese mismo fichero. Más simple que
  trocear el cuerpo de cada método — no hay en el repo un parser de límites
  de método reutilizable — y suficiente hoy: los dos únicos sitios de `src/`
  que llaman a `addFunction()` (`save()` y `replaceImageJpeg()`) viven en el
  mismo fichero (`PdfiumEngine.ts`) y cada uno ya libera el suyo. **Límite
  conocido:** si un fichero tuviera dos métodos con `addFunction()` y solo
  uno liberase el suyo (dos veces), el recuento por fichero no lo
  distinguiría de "los dos están bien" — ese caso no existe hoy y, si
  aparece, depende de la revisión humana del PR, igual que
  `gesto-con-cancelacion` depende de revisión humana dentro de su propio
  `gesto.ts`. `mem.ts` —donde vive el wrapper
  `addFunction: (fn, sig) => m.addFunction(fn, sig)`— queda excluido a
  propósito: ese wrapper no reserva ningún slot por sí mismo, solo delega la
  llamada de quien sí lo hace.

**Opción descartada: un callback cacheado por instancia del motor.** Se
valoró crear el callback `WriteBlock` una sola vez en `PdfiumEngine.create()`
y reutilizarlo en cada `save()`, con el array de trozos de salida en un campo
mutable en vez de una variable de closure por llamada — evitaría reservar y
liberar un slot en cada guardado. Se descartó porque el `finally` con
`removeFunction()` ya dejó la fuga en cero sin coste medible (500 `save()` de
un PDF de una página tardan un puñado de milisegundos, ver el test de
arriba) y con menos superficie: no hay que razonar sobre reentrancia (¿qué
pasa si algo dispara un `save()` mientras el campo mutable del callback
cacheado ya tiene datos de un `save()` anterior sin terminar? hoy no ocurre,
porque JS es de un solo hilo y `save()` es síncrono de principio a fin, pero
un campo compartido es una invitación a que un cambio futuro lo rompa) ni
sobre cuándo se libera ese slot cacheado al cerrar el documento o el motor.
`replaceImageJpeg()` ya establece el mismo patrón de "reservar y liberar por
llamada" para su propio callback — mantener `save()` igual es la opción más
simple y más consistente con el resto del fichero.

---

### E-037 · Insertar/dibujar en bucle sobre una página era O(N²)

**Síntoma.** Encontrado al medir el PR #60 (Markdown → PDF): emitir muchos
`insertText`/`fillRect` seguidos sobre una misma página tardaba varios
segundos y el tiempo NO crecía en línea recta con el número de operaciones.
El caso real más expuesto es el OCR de una página densa
(`OcrPageCmd`, `src/commands/OcrPage.ts`): una imagen escaneada normal da
50-100 líneas reconocidas, cada una insertada con su propio `insertText`.

**Medido antes del arreglo** (motor real, Node, `insertText` uno a uno sobre
la misma página):

| N   | tiempo     |
|-----|-----------|
| 20  | ~31-43 ms |
| 50  | ~59-70 ms |
| 100 | ~225-240 ms |
| 200 | ~1300-1390 ms |

De 100 a 200 (×2 operaciones) el tiempo se multiplica por ~5,8, no por 2:
crecimiento claramente superlineal, compatible con O(N²).

**Causa raíz.** Cada método del motor que dibuja o inserta texto
(`insertText`, `fillRect`, `highlightRect`, `drawStroke`, `drawRect`, y los
que editan un run existente) hacía `FPDF_LoadPage` → mutar →
`FPDFPage_GenerateContent` → `FPDF_ClosePage` **por llamada**.
`FPDFPage_GenerateContent` no añade una operación al content stream: **
reserializa TODO el contenido ya insertado en la página** cada vez que se
llama. Insertar N objetos uno a uno con este patrón hace, en total, trabajo
proporcional a 1+2+...+N ≈ O(N²), no O(N).

**Arreglo.** `PdfEngine.applyPageOps(doc, pageIndex, ops: PageOp[])`
(`src/engine/PdfEngine.ts`, implementado en
`src/engine/pdfium/PdfiumEngine.ts`) carga la página **una sola vez**, aplica
todas las `PageOp` del lote (unión discriminada: `insertText`, `fillRect`,
`highlightRect`, `drawStroke`, `drawRect`) y llama a `GenerateContent()` **una
sola vez** al final, antes de un único `ClosePage`. Los cinco métodos
unitarios (`insertText`, `fillRect`, `highlightRect`, `drawStroke`,
`drawRect`) pasaron a ser envoltorios de una línea que delegan en
`applyPageOps` con un array de un solo elemento — `applyPageOps` es ahora la
ÚNICA implementación real de cada tipo de operación, sin lógica duplicada
entre la ruta "una op" y la ruta "en lote". Se usa en:
- `OcrPageCmd.execute()` — todas las líneas reconocidas de una página en una
  sola llamada.
- `ConversorMarkdownNavegador.convertir()` — las `barras` (fondos) y
  `trazos` (texto) se agrupan por página (conservando el orden barras-antes-
  que-trazos dentro de cada página, para no alterar el z-order) y se aplican
  con un `applyPageOps` por página en vez de una llamada por barra/trazo.
  La FUSIÓN de palabras consecutivas del mismo estilo en un solo trazo
  (`lineToFlowLine`, `src/convert/markdown/layout.ts`, ya existente desde el
  PR #60) **se conserva**: sigue reduciendo el número de OBJETOS de texto del
  PDF final (menos operadores de posicionamiento, archivo más pequeño), algo
  que `applyPageOps` no sustituye — resuelve el coste de LLAMADA al motor,
  no el número de objetos del documento resultante.

**Medido después del arreglo:** 200 `insertText` en un solo `applyPageOps`:
~10-11 ms (frente a ~1300-1390 ms uno a uno). Una página OCR densa (80
líneas) vía `OcrPageCmd`: por debajo de medio segundo con holgura amplia
frente al crecimiento cuadrático de antes.

**Cómo se detecta ahora.** (Los dos tests de tiempo que medían esto en
milisegundos se sustituyeron por aserciones sobre el nº de llamadas —
E-040, más abajo — porque un umbral de reloj daba falsos positivos bajo
carga sin que hubiera ninguna regresión real.)
- Test `E-037: 200 insertText por applyPageOps en un solo lote hacen UNA
  sola llamada a FPDFPage_GenerateContent, no 200` en
  `tests/unit/PdfiumEngine.applyPageOps.test.ts` (motor real): espía
  `FPDFPage_GenerateContent` del módulo WASM con `vi.spyOn` y exige
  exactamente 1 llamada, sin importar el nº de ops del lote.
- Test `E-037: applyPageOps en lote produce el MISMO contenido que aplicar
  cada op una a una` en el mismo fichero — compara `getPageText()` entre
  las dos rutas.
- Tests de `applyPageOps` mezclando los cinco tipos de op en un mismo lote y
  comprobando que un op rechazado (rectángulo <3×3, trazo de un punto) no
  afecta al resto del lote ni cuenta como mutación.
- Test `E-037: OcrPageCmd con 80 líneas reconocidas (página densa) hace UNA
  sola llamada a applyPageOps, no 80` en `tests/unit/OcrPage.test.ts`: espía
  `engine.applyPageOps` y además compara el resultado contra insertar las
  mismas líneas una a una con `insertText`.
- Regla `motor-lote-en-bucle` (ver más abajo): un fichero de
  `src/commands/**` o `src/convert/**` con un bucle Y una llamada de
  dibujo/texto del motor, sin usar `applyPageOps`, falla el guard.

---

### E-038 · Cada GenerateContent() dejaba un stream de contenido huérfano en el guardado

**Síntoma.** El PDF que se lleva el usuario al pulsar Guardar crecía con
cada edición sobre la MISMA línea/objeto, aunque el contenido visible final
fuera idéntico. Ya se había visto una vez, solo para imágenes: el PR #57
documentó (comentario en `ComprimirDocumentoCmd`) que sustituir el bitmap de
una imagen de 233 KB por un JPEG de 700 B seguía dejando un documento de
~234 KB hasta reabrirlo desde sus propios bytes. E-037 generaliza la misma
causa a CUALQUIER operación que llame a `GenerateContent` más de una vez
sobre la misma página: texto insertado, runs editados, color de run
cambiado, trazos, rectángulos...

**Medido antes del arreglo** (motor real, Node; documento base con un solo
run de texto, `editTextRun` alternando entre dos textos sobre el MISMO run):

| ediciones (N) | `save()` directo | `save(open(save()))` (reabierto) |
|---|---|---|
| 0   | 1536 bytes  | 1348 bytes |
| 10  | 4061 bytes  | 1437 bytes |
| 50  | 14116 bytes | 1443 bytes |
| 100 | 26766 bytes | 1443 bytes |

`save()` directo crece de forma prácticamente lineal con N (~250 bytes por
edición) aunque el texto final es siempre uno de dos strings de 4
caracteres; reabrir desde los propios bytes y volver a guardar lo deja
plano en ~1443 bytes pase lo que pase N. Idéntico patrón con `setRunColor`
en vez de `editTextRun` (mismos números para N=10/50). El coste de hacer ese
`open()+save()` extra sobre un documento con 100 ediciones: ~0,25-0,30 ms
por encima de un `save()` normal (~1,6-1,8 ms) — no es un cambio de orden de
magnitud.

**Hallazgo negativo, también medido:** `extractPages()` (usada por
"Extraer página" y "Dividir") **ya es inmune** a este defecto sin ningún
cambio: sobre el mismo documento con 100 ediciones huérfanas, `save()`
directo pesaba 26766 bytes y `extractPages(doc, [0])` pesaba 1048 bytes.

**Causa raíz.** `FPDFPage_GenerateContent()` no muta el content stream
existente: crea uno **nuevo** con el contenido serializado actual y
actualiza `/Contents` de la página para que apunte a él. El stream
**anterior** no se libera ni se desreferencia de la tabla de objetos del
documento que el motor mantiene en memoria — sigue ahí, simplemente ya no
lo apunta nada. `FPDF_SaveAsCopy()` escribe la tabla de objetos tal cual
está en memoria, huérfanos incluidos: por eso `save()` los arrastra. Al
volver a **abrir** ese PDF desde sus bytes (`FPDF_LoadDocument`), el motor
solo reconstruye los objetos alcanzables recorriendo desde la raíz del
documento — un stream sin ninguna referencia entrante simplemente no se
carga —, así que un `save()` posterior sobre ese documento reabierto ya no
lo escribe. `extractPages()` es inmune por el mismo mecanismo: construye un
documento NUEVO e importa solo las páginas pedidas (`FPDF_ImportPages`), que
analiza el documento origen igual que un `open()` — trae lo alcanzable, no
la tabla de objetos entera.

No se investigaron flags de `FPDF_SaveAsCopy` (`FPDF_INCREMENTAL`/
`FPDF_NO_INCREMENTAL`/`FPDF_REMOVE_SECURITY`) porque ninguno de los tres
tiene relación con purgar objetos inalcanzables — son sobre guardado
incremental (que este motor no usa: siempre pasa `0`) y sobre cifrado.

**Arreglo (opción "guardado compacto", (a) de las tres del encargo).**
`PdfEngine.saveCompact(doc)` (`src/engine/pdfium/PdfiumEngine.ts`) hace
`save()` → `open(bytes)` sobre un documento efímero → `save()` de ese
documento efímero → `close()` del efímero, sin tocar `doc`. Coste medido:
irrelevante (ver arriba). Se descartó (b) "eliminar el stream viejo al
regenerar": la API pública de PDFium no expone un delete-por-referencia del
stream de `/Contents` anterior sin arriesgar los propios punteros que usa
`GenerateContent` internamente; (a) ya resuelve el problema por completo con
coste despreciable, así que no hacía falta.

**Dónde se aplica.** Guardados DE CARA AL USUARIO:
`App.save()`/`App.print()` (botón Guardar y vista previa de impresión) y el
tamaño que informa `ComprimirDocumentoCmd` tras comprimir (para que lo que
se muestra coincida con lo que se llevará el usuario al pulsar Guardar
después). **NO** se aplica en:
- Los snapshots internos de deshacer (`this.before = c.engine.save(c.doc)`
  en cada comando): priorizan velocidad, se descartan casi siempre sin
  llegar a disco, y el coste de `saveCompact` en cada uno de ellos (aunque
  pequeño) no se justifica frente al beneficio nulo. Decisión documentada
  aquí, no en el código de cada comando.
- `extractPages` (Extraer página / Dividir): ya es inmune por construcción
  (ver el hallazgo negativo arriba) — envolverla en `saveCompact` sería
  trabajo redundante.
- `ConversorMarkdownNavegador`: con el arreglo de E-037 (un solo
  `GenerateContent` por página vía `applyPageOps`), el documento que
  construye desde cero nunca llega a acumular huérfanos en primer lugar —
  no hay nada que compactar.

**Cómo se detecta ahora.**
- Test `E-038: saveCompact tras 100 editTextRun pesa ~igual que sin
  ediciones, con el mismo texto final` en
  `tests/unit/PdfiumEngine.savecompact.test.ts` (motor real): exige que
  `saveCompact` quede por debajo de 1,1× el tamaño base y que el `save()`
  directo (sin compactar) siga por encima de 2× — deja constancia numérica
  del defecto original en el propio test.
- Test `E-038: saveCompact NO muta el documento vivo` — invariante
  equivalente a E-005 (exportar dos veces da el mismo resultado) para la
  app nueva: llamarlo dos veces da el mismo tamaño y el documento vivo
  sigue con un único run, no duplicado.
- Test `E-038: extractPages ya es inmune a los huérfanos por construcción` —
  fija el hallazgo negativo para que no se pierda si alguien "arregla" algo
  que ya funcionaba.
- Test `E-038: el coste extra de saveCompact frente a save() es CONSTANTE
  (una llamada a save/open/close), no crece con el número de ediciones` —
  antes comparaba una razón de milisegundos (frágil bajo carga); ahora espía
  `save`/`open`/`close` con `vi.spyOn` y exige 2/1/1 llamadas exactas pase lo
  que pase el número de ediciones (E-040, más abajo).
- E-005 (`tests/e2e/exportacion.spec.js`, app vieja) sigue intacto: este
  arreglo vive enteramente en `src/` (motor PDFium), no toca
  `buildFlattenedDoc()` ni el resto de la app vieja.

---

### E-039 · La prueba de oro de reposo (E-029) podía capturar una transición CSS a medias · defecto del TEST, no de la app

**Síntoma.** Una corrida completa de `npm run verify` (PR #63) falló UNA vez,
con la máquina cargada (varias pestañas de Chrome abiertas), en la prueba de
oro de píxeles de `tests/e2e/next/sustituir-fuente.spec.ts`: capturar la
página con `.run` visible y con `.run` oculta por script daba
`Buffer.compare` distinto de `0`. En aislamiento (sin carga) el test siempre
pasaba, lo que apuntaba a una carrera de temporización, no a una regresión
del producto — confirmado abajo.

**Causa raíz — mecanismo confirmado por instrumentación directa, no solo por
sospecha.** El test edita una línea, la fuente original no tiene el glifo
(`glyph-missing`) y `ReplaceRunFontCmd.execute()` llama a `c.refresh()`, que
reconstruye TODA la capa de texto (`Viewer.rebuild()`): el `.run` original se
elimina del DOM y se crea uno nuevo en su lugar. El cursor del ratón se había
quedado posicionado sobre la línea (desde el `run.click()` inicial) y no se
ha movido con un `mousemove` real desde entonces — pero Chromium, al eliminar
del DOM el elemento que tenía `:hover`, recalcula el hit-test en la posición
actual del cursor y aplica `:hover` al nuevo `.run` que quede debajo, SIN
necesidad de un evento de ratón nuevo. Medido con `getComputedStyle` justo
tras el commit, antes de que el test apartara el ratón:
`{ matchesHover: true, outline: 'dashed', handleOpacity: '0.983538' }` — el
tirador `.run-drag` (`src/ui/estilos.css`, `transition: opacity .1s`) ya
estaba animándose. El test aparta el ratón a `(0, 0)` precisamente para
evitar este contorno fantasma (comentario ya existente en el spec), y eso
SÍ limpia `:hover` — pero dispara la transición de SALIDA del tirador, que
tarda sus ~100 ms reales en llegar a `opacity: 0`. Medido inmediatamente
después de apartar el ratón: `{ matchesHover: false, outline: 'none',
handleOpacity: '0.778604' }` — la transición seguía en curso. La captura
"antes" no esperaba a que esa transición terminara; la captura "despues" se
toma tras un `page.evaluate()` adicional (para ocultar `.run`), con algo más
de margen real. Bajo carga de máquina ese margen relativo entre ambas
capturas puede ensancharse lo suficiente para que una capture el tirador a
media transición y la otra no — un `Buffer.compare` distinto de `0` que no
tiene nada que ver con lo que el test dice comparar (la capa de texto).

**Por qué es un defecto del TEST y no de la app.** El comportamiento real
—un contorno sutil y un tirador que aparecen con una transición suave al
pasar el ratón, y que el hover se reafirme sobre el elemento que reemplaza al
que tenía el foco del cursor— es exactamente el diseño intencional de E-029 y
no algo que un usuario perciba como roto: nadie ve `Buffer.compare` en pantalla.
El defecto es que la prueba de oro de píxeles asumía implícitamente que dos
capturas consecutivas representan el mismo frame estable, sin tener en cuenta
que una transición CSS real, gobernada por el reloj de pared del navegador
(no por la velocidad del hilo de JS del test), puede seguir en curso entre
ambas.

**Arreglo.** Las cuatro capturas de píxeles de la suite
(`tests/e2e/next/fidelidad-reposo.spec.ts` y
`tests/e2e/next/sustituir-fuente.spec.ts`) pasan
`{ animations: 'disabled' }` a `screenshot()`: Playwright congela cualquier
transición/animación CSS a su estado FINAL antes de capturar. Es
determinista y no relaja la comparación de píxeles — sigue exigiendo
`Buffer.compare === 0` byte a byte; solo elimina la variable de "en qué
punto de una animación en curso cayó la captura".

**Reproducción.** No se logró forzar el `Buffer.compare` real a fallar en
esta sesión pese a más de 700 repeticiones combinando `--repeat-each`,
`--workers` sobresuscritos (hasta 16 sobre 12 núcleos), CPU throttling vía
CDP (`Emulation.setCPUThrottlingRate`, ratio 6) y corridas completas de la
suite `next` en paralelo: el pipeline de captura de Playwright en esta
máquina concreta tarda, por sí solo, más que los ~100 ms de la transición, así
que "antes" ya la capturaba completa. El mecanismo se confirmó por dos vías
independientes: (a) lectura directa de `getComputedStyle` en los puntos
exactos de la secuencia del test (arriba), que demuestra la transición en
curso con datos, no con sospecha; (b) alargar artificialmente la transición
(`transition-duration: 500ms !important` inyectado con `addStyleTag`, solo
para el diagnóstico) junto con una espera explícita entre capturas SÍ produce
`Buffer.compare !== 0` de forma reproducible sin el arreglo, y `=== 0` de
forma reproducible con `animations: 'disabled'` — la ventana real en CI es
más estrecha (la transición de producción es de ~100 ms, no 500 ms) y
depende de que el compositor del navegador vaya con retraso respecto al
pipeline de captura bajo carga externa real de la máquina, algo que no
equivale a saturar solo los hilos de JS de los propios workers de Playwright.

**Cómo se detecta ahora.**
- Las cuatro capturas de píxeles en `tests/e2e/next/` pasan
  `{ animations: 'disabled' }`.
- Patrón obligatorio documentado en `docs/TESTING.md` § "Capturas de
  píxeles".
- Regla `captura-pixel-sin-animations-disabled` — cualquier `.screenshot(`
  nuevo dentro de `tests/e2e/next/*.spec.ts` sin `animations: 'disabled'` en
  la misma llamada falla el guard.

---

### E-040 · Umbrales de milisegundos en tests unitarios daban falsos positivos bajo carga · defecto del TEST, no de la app

**Síntoma.** En una corrida local con la máquina cargada, el test
`E-037: OcrPageCmd con 80 líneas reconocidas (página densa) termina muy
rápido` (`tests/unit/OcrPage.test.ts`) dio `598 ms` contra un umbral de
`< 500 ms` y falló, sin que hubiera ninguna regresión de verdad: la propia
`OcrPageCmd` seguía haciendo una única llamada en lote a `applyPageOps`
(el arreglo de E-037 seguía intacto). Los mismos cuatro ficheros
(`tests/unit/OcrPage.test.ts`,
`tests/unit/PdfiumEngine.applyPageOps.test.ts`,
`tests/unit/PdfiumEngine.savecompact.test.ts` y
`tests/unit/markdown-parse.test.ts`) tenían más aserciones de
`performance.now()`/`Date.now()` con el mismo problema de fondo.

**Causa raíz.** Los tests de E-037/E-038 (arriba) y las tres pruebas de
"entrada hostil" de `markdown-parse.test.ts` medían tiempo de reloj real
para verificar una propiedad que en realidad es de **trabajo realizado**
(cuántas veces se regenera el contenido de una página, cuántas llamadas
hace `saveCompact`, cuántos pasos consume el analizador de Markdown), no de
velocidad del hardware. Un runner de CI compartido o una máquina de
desarrollo con carga variable pueden hacer que la MISMA operación, sin
cambiar una sola línea de código de producción, tarde por encima de
cualquier umbral fijo razonable — AGENTS.md §2.1 exige ejecutar y pegar la
salida, pero ni siquiera eso protege de una corrida puntual lenta que hace
fallar CI sin que nadie haya roto nada. Es la contracara de E-039: allí la
carga de máquina ensanchaba una ventana de temporización real entre dos
capturas; aquí, directamente aserta sobre la duración de una operación de
CPU sin ningún motivo para acoplar la garantía al reloj de pared.

**Arreglo.** Cada aserción de tiempo se sustituyó por una aserción
DETERMINISTA sobre la propiedad que el test dice proteger:

| Fichero | Antes (frágil) | Después (determinista) |
|---|---|---|
| `PdfiumEngine.applyPageOps.test.ts` | `t1 - t0 < 200 ms` para 200 `insertText` en lote | `vi.spyOn(p, 'FPDFPage_GenerateContent')` — exactamente 1 llamada, sin importar el nº de ops |
| `OcrPage.test.ts` | `t1 - t0 < 500 ms` para 80 líneas OCR | `vi.spyOn(engine, 'applyPageOps')` — exactamente 1 llamada con las 80 ops en un solo lote, más comparación de resultado contra insertarlas una a una |
| `PdfiumEngine.savecompact.test.ts` | `(t2-t1) < max(50, (t1-t0)*20)` | `vi.spyOn` de `save`/`open`/`close` — exactamente 2/1/1 llamadas, constante sin importar el nº de ediciones (100 `editTextRun` en el test) |
| `markdown-parse.test.ts` (3 tests de "entrada hostil") | `Date.now() ... < 1000 ms` | Propiedades estructurales acotadas por las cotas del parser: un run de `*` colapsa a un único bloque `hr`; el anidamiento de `>` se acota a `MAX_BLOCKQUOTE_DEPTH` (30, no al nº de `>` de la entrada); una línea gigante se analiza con el presupuesto de pasos `MAX_INLINE_STEPS` acotado (exportado desde `src/convert/markdown/parse.ts` junto con `MAX_BLOCKQUOTE_DEPTH`), sin perder texto. Se añadió además un cuarto test nuevo (`"[" sin cerrar, repetido`) que ataca directamente el patrón que SÍ es O(n²) sin presupuesto — verificado quitando temporalmente la cota: sin ella, 200 `[` cuestan ~20 100 pasos y 400 `[` (2×) cuestan ~80 200 (~4×, cuadrático); con la cota, ambos tamaños saturan en el mismo valor. |

`src/convert/markdown/parse.ts` ganó un parámetro diagnóstico opcional en
`parseInline(text, stats?)` que, si se pasa, recibe `{ steps }` con el
presupuesto consumido — no cambia el comportamiento del análisis ni el
contrato del resto del código, es puramente para que los tests puedan leer
el trabajo hecho. `MAX_BLOCKQUOTE_DEPTH`, `MAX_INLINE_DEPTH` y
`MAX_INLINE_STEPS` pasaron de constantes privadas del módulo a exportadas,
por la misma razón.

`PdfiumEngine.applyPageOps` y `PdfiumEngine.savecompact` ya no tienen
ninguna aserción de milisegundos: las propiedades que protegían (una sola
regeneración de contenido por lote; un coste extra constante de
`saveCompact`) se verifican contando llamadas con `vi.spyOn`, que es
determinista por construcción — no puede dar un falso positivo por carga
de máquina, y si alguien reintroduce el bucle uno-a-uno o un round-trip
extra, el conteo lo detecta con el mismo mensaje de fallo pase lo que pase
la velocidad de la máquina.

**Verificación de que cada test nuevo detecta el defecto que protege**
(reintroducido temporalmente, revertido después de comprobar el fallo):
- `OcrPageCmd` volviendo a un `insertText` por línea (en vez de
  `applyPageOps` en lote): `expected "applyPageOps" to be called 1 times,
  but got 80 times`.
- `PdfiumEngine.applyPageOps` llamando a `FPDFPage_GenerateContent` dentro
  del bucle de `insertText` (regenerando por op): `expected "spy" to be
  called 1 times, but got 201 times` (y la corrida real tardó ~95 s con 200
  ops, confirmando además el propio coste cuadrático que el arreglo evita).
- `saveCompact` con un round-trip `open()+save()` extra innecesario:
  `expected "save" to be called 2 times, but got 3 times`.
- `markdown-parse`: sin `MAX_BLOCKQUOTE_DEPTH`, la entrada de 10000 `>`
  hace `RangeError: Maximum call stack size exceeded` (desborda la pila,
  no solo tarda más). Sin el presupuesto compartido de pasos (
  `MAX_INLINE_STEPS` elevado a un valor grande), `'['.repeat(400)` consume
  ~4× los pasos de `'['.repeat(200)` en vez de la misma cantidad —
  `expected 80200 to be 20100`.

**Cómo se detecta ahora.**
- Los tests listados arriba, todos deterministas.
- Regla `sin-cronometraje-en-unit` (`scripts/guards/reglas.mjs`): ningún
  fichero de `tests/unit/**/*.test.ts` puede contener
  `performance.now()`/`Date.now()` salvo con el escape estándar del
  repositorio (`// guard-disable-next-line sin-cronometraje-en-unit: <razón
  de ≥10 caracteres>` en la línea anterior) — por ejemplo, para una red
  anti-cuelgue genuina contra un hang real, con un margen muy holgado (p.
  ej. `< 10 s`) y documentada como tal, no como medida de rendimiento. Hoy
  ninguno de los cuatro ficheros necesita esa excepción: el timeout por
  test por defecto de Vitest (5 s) ya actúa como red anti-cuelgue del
  propio runner ante un hang real, sin necesitar una medición manual.
- Regla del propio `AGENTS.md` §2.1: "no bajar umbrales para poner el CI en
  verde" — aquí no se bajó ningún umbral, se cambió QUÉ se mide, hacia una
  garantía más fuerte y determinista de la misma propiedad.
- Documentado en `docs/TESTING.md` § "No se aserta sobre tiempo de reloj".

---

## Conversión de documentos

### E-041 · El maquetador común insertaba un espacio de más entre una palabra y la puntuación pegada a ella (DOCX)

**Síntoma.** Al convertir un `.docx` con formato mezclado a mitad de frase
(p. ej. `**negrita**,`), el PDF salía con un espacio visible de más antes de
la coma: "negrita ," en vez de "negrita,". Se descubrió mirando la captura
de `word-basico.docx` (§2.8 de AGENTS.md: "ábrelo, pruébalo, mira el
resultado"), no en un test — la revisión visual del lote encontró lo que los
tests no cubrían.

**Causa raíz.** `wrapAtoms`/`lineToFlowLine` (`src/convert/flujo/layout.ts`)
vienen de generalizar el maquetador de Markdown (fila #32), donde cada
"átomo" es siempre una PALABRA separada de la siguiente por un espacio real
— así es como funciona un texto Markdown. Word, en cambio, parte un mismo
"word visual" en varios `w:r` (runs) cada vez que cambia el formato a mitad
de palabra o justo en un signo de puntuación, SIN que haya un espacio real
entre ellos en el XML. El algoritmo, al no saber distinguir "dos átomos
separados por espacio" de "dos átomos que vienen de runs consecutivos sin
espacio", insertaba el espacio de unión SIEMPRE.

**Cómo se detecta ahora.**
- `Atom.pegado` (`src/convert/flujo/layout.ts`): marca opcional, `false`/
  `undefined` en todo lo que produce Markdown (comportamiento idéntico a
  antes — sus tests no cambiaron). `src/convert/docx/render.ts` la activa en
  el primer átomo de una `parte` de texto cuando el texto crudo (con
  `xml:space="preserve"`) no tenía espacio real respecto al átomo anterior.
- Tests `tests/unit/flujo-layout.test.ts`: "un átomo 'pegado' del MISMO
  estilo se fusiona... sin espacio", "...de OTRO estilo queda en un trazo
  aparte, pero sin hueco...", "wrapAtoms no reserva hueco...", "justificado:
  un hueco 'pegado' no recibe el espacio extra...".

### E-042 · El lector de ZIP descomprimía la entrada ENTERA antes de comprobar su tamaño: una zip bomb con el tamaño declarado a la baja agotaba la memoria

**Síntoma.** Encontrado en revisión de PR (#66), no en producción. Todas las
defensas de `src/convert/docx/zip.ts` contra "zip bomb" (ratio de compresión,
tamaño por entrada y total) se calculaban sobre los tamaños **DECLARADOS**
en el directorio central — y esos campos los pone el atacante. Una entrada
cuya cabecera mintiera con un tamaño descomprimido PEQUEÑO (p. ej. 1 KB),
pero cuyo `deflate` real produjera algo enorme, pasaba el filtro de ratio
(1 KB / unos pocos KB comprimidos no es un ratio sospechoso) y el de tamaño
por entrada (1 KB < 200 MB) sin disparar nada. Solo al llamar a `leer()`,
`inflateRaw()` descomprimía la entrada ENTERA con
`new Response(flujo).arrayBuffer()` — que no puede comprobar nada hasta
tener el resultado completo en memoria — y únicamente DESPUÉS comparaba la
longitud resultante con lo declarado. Para entonces, si el `deflate` real
producía gigabytes, la pestaña ya se había quedado sin memoria.

**Causa raíz.** Dos ideas mezcladas que parecían la misma defensa pero no lo
eran: "los tamaños declarados sirven para RECHAZAR pronto, sin leer nada" (SÍ
vale — ver `MAX_RATIO`/`MAX_ENTRADA_BYTES` en `leerDirectorioCentral`) y "los
tamaños declarados sirven para saber CUÁNTO voy a leer con seguridad" (NO
vale — el atacante los controla). Los límites tienen que imponerse al LEER,
no solo al declarar.

**Cómo se detecta ahora.**
- `inflateAcotado()` (`src/convert/docx/zip.ts`) sustituye a `inflateRaw()`:
  lee el `ReadableStream` de salida del `DecompressionStream` con un bucle
  `reader.read()`, cuenta los bytes entregados y, en cuanto el total supera
  `min(descomprimidoBytes declarado, MAX_ENTRADA_BYTES, presupuesto restante
  del documento)`, cancela el stream (`reader.cancel()`) y lanza
  `DocxError` — nunca sigue leyendo más allá del límite.
- El presupuesto de `MAX_TOTAL_BYTES` se impone también en streaming,
  compartido entre TODAS las llamadas a `leer()` de un mismo `ZipArchivo`
  (no solo dentro de una), incluidas las entradas `stored`.
- Tras extraer, el tamaño final tiene que coincidir EXACTAMENTE con lo
  declarado (ni más —ya cortado por `inflateAcotado`— ni menos), y además el
  **CRC-32** declarado en la cabecera tiene que coincidir con el contenido
  real — una entrada con el tamaño correcto pero el contenido manipulado
  también se rechaza.
- Una entrada `stored` (método 0) cuyo tamaño comprimido y descomprimido
  declarados no coincidan (deberían ser el mismo número: `stored` no
  transforma nada) se rechaza en `leerDirectorioCentral`, sin tocar ni un
  byte de datos.
- Regla determinista `docx-descomprimir-acotado`
  (`scripts/guards/reglas.mjs`): ningún fichero de `src/convert/**` puede
  leer la salida de un `DecompressionStream` con
  `new Response(...).arrayBuffer()/.blob()/.text()` — ese es exactamente el
  patrón que causó esto.
- Tests `tests/unit/docx-zip.test.ts` (prefijo "E-042"): una entrada con
  tamaño declarado pequeño (1024 B) pero un `deflate` real de 8 MB de ceros
  se rechaza SIN leer más que lo declarado (medido con un espía que envuelve
  `DecompressionStream` global y cuenta los bytes que realmente atraviesan
  el stream — no se cronometra nada, AGENTS.md/E-040); un CRC-32 declarado
  que no coincide se rechaza; una entrada `stored` con tamaños inconsistentes
  se rechaza sin excepción de rango. Tests de la regla en
  `scripts/guards/reglas.test.mjs` ("docx-descomprimir-acotado").

---

### E-043 · Abrir un documento grande leía el texto y pintaba las miniaturas de las 500 páginas de golpe

**Síntoma.** Todas las fixtures de la app nueva tenían 1-4 páginas — muy por
debajo de un contrato o manual real (300-1000 páginas), que Acrobat abre al
instante. Con un documento de 500 páginas (`grande.pdf`, fixture nueva): la
interfaz tardaba más de un segundo en volverse usable, "Guardar" quedaba
disponible pero el panel de miniaturas se construía entero antes de que el
usuario pudiera hacer nada, y la memoria del proceso era casi el doble de lo
necesario para lo que de verdad estaba en pantalla.

**Causa raíz (dos mecanismos independientes, medidos por separado).**

1. `EditSession.buildPages()` (`src/model/EditSession.ts`) llamaba a
   `engine.getPageText(doc, i)` — la operación más cara por página del motor
   (recorre cada objeto de texto de la página y lee varias cadenas de
   PDFium por cada uno, E-028) — para **todas** las páginas, tanto al abrir
   el documento como en cada `refresh()`. El usuario solo puede editar o
   buscar en las páginas que ha visto: pedir el texto de las 500 al simple
   abrir es trabajo que casi nunca hace falta.
2. `App.buildThumbnails()` (`src/ui/App.ts`) llamaba a `engine.renderPage()`
   — la otra operación cara del motor — para **todas** las páginas al
   construir el panel de miniaturas, de forma síncrona, antes de que el
   panel pudiera ni pintarse. El visor principal (`Viewer.renderVisible()`)
   ya era perezoso AL PINTAR desde antes (solo renderiza las páginas
   visibles, gracias al `IntersectionObserver` de E-032) — el defecto de
   ESTA entrada estaba solo en las miniaturas y en el texto.
   **Precisión de revisión:** "perezoso al pintar" no es lo mismo que
   "perezoso al liberar" — `Viewer` seguía sin desalojar nunca una página ya
   pintada que salía de la vista, un defecto propio, más grave, con su causa
   raíz y arreglo aparte en **E-045**, más abajo.

**Medido antes del arreglo** (motor real y Chromium real, `grande.pdf`, 500
páginas A4 con texto único por página):

| Medida | Antes |
|---|---|
| `EditSession.buildPages()` en Node (motor real) | 500 `getPageText`, 500 `pageSize`, 500 `pageRotation`, ~124-158 ms |
| Tiempo hasta que `.run` es visible (navegador) | ~1432 ms |
| Tiempo hasta que las 500 miniaturas terminan de pintarse | ~1461 ms (prácticamente junto con lo anterior: bloquea la apertura) |
| `<canvas>` de miniatura con bitmap pintado al abrir | 500 |
| `<canvas>` de página pintados en el visor principal, recién abierto | 2 (ya era perezoso AL PINTAR — ver la corrección de E-045 sobre "liberar") |
| Memoria aproximada (`performance.memory`) | ~98 MB |

**Arreglo.**

- **Texto perezoso.** `EditSession.buildPages()` deja `runs: []` sin cargar;
  el nuevo `EditSession.ensureText(pageIndex)` lo carga del motor la primera
  vez que de verdad hace falta y lo cachea en `model.pages[i].runs` — nunca
  dos veces la misma página sin invalidarla antes. `Viewer.renderPage()`
  llama a `ensureText()` justo antes de construir la `TextLayer` de esa
  página (la primera vez que se pinta es también la primera vez que hace
  falta su texto). Búsqueda y "Texto…"/Exportar Markdown (`App.search()`,
  `App.allPagesLineas()`) pasan también por `ensureText()`, así que una
  página ya vista en el visor no se vuelve a leer del motor. Único sitio de
  `src/` (fuera del propio motor) con permiso para llamar a
  `engine.getPageText()` — regla `texto-perezoso-via-editsession`, más
  abajo.
- **Miniaturas perezosas.** `App.buildThumbnails()` crea un `<canvas>`
  PLACEHOLDER por página — con `width`/`height` ya fijados a partir de
  `page.sizePt` (la proporción real de la página, **sin** llamar al motor),
  así que el panel mide su scroll exacto desde el primer instante, sin
  saltos — y un `IntersectionObserver` (`observeThumbs`, `rootMargin:
  '600px 0px'` como margen por delante) pinta el bitmap real
  (`renderThumb`) la primera vez que la miniatura entra o casi entra en el
  viewport del panel. `maybeEvictFarThumbs` descarta (vuelve a placeholder)
  las miniaturas pintadas más antiguas por encima de 120 a la vez —salvo
  las que sigan cerca de la que se acaba de pintar— para que pasearse por
  un documento de 500 páginas no acumule 500 bitmaps en memoria; las
  descartadas se vuelven a observar, así que se repintan solas si el
  usuario regresa a esa zona.
- **Operaciones de documento completo ceden el hilo.** Búsqueda
  (`App.search()`) y "Texto…"/Exportar Markdown (`App.allPagesLineas()`)
  recorren TODAS las páginas por diseño (no hay forma perezosa de
  "buscar en una página que no se ha mirado"): en un documento de cientos
  de páginas, hacerlo de una sentada bloquearía el hilo principal. Ambas
  ceden el hilo cada `PAGE_YIELD_CHUNK` (20) páginas
  (`await new Promise(resolve => setTimeout(resolve, 0))`, función
  `cederHilo()`) e informan el avance en `#status` ("Buscando… 120/500").
  `search()` además guarda un `searchSeq` creciente: si el usuario teclea
  de nuevo antes de que termine, la búsqueda vieja se abandona sin pintar
  sus resultados — la "cancelación" de esta operación (no hay forma de
  abortar `findText` a media página, pero dejar de continuar el bucle y de
  aplicar el resultado es equivalente desde fuera). `Comprimir documento`
  no se tocó en este PR: sigue siendo una operación de documento completo
  sin ceder el hilo — mejora futura, fuera de alcance porque además de
  ceder necesitaría revisar su propio coste por imagen (recodificar JPEG),
  no solo el bucle de páginas.

**Medido después del arreglo** (mismas condiciones):

| Medida | Después |
|---|---|
| `EditSession.open()` en Node (motor real) | 0 `getPageText` (500 `pageSize`/`pageRotation`, que son baratos y siguen eager), ~63 ms |
| Tiempo hasta que `.run` es visible (navegador) | ~417 ms (antes ~1432 ms) |
| `window.__diagnostico.renderPage` tras abrir (navegador) | 10 |
| `window.__diagnostico.getPageText` tras abrir (navegador) | 2 |
| `<canvas class="thumb">` en el DOM (placeholders, tamaño correcto) | 500 (sin cambio: la lista de páginas sigue siendo completa) |
| Memoria aproximada | ~54 MB (antes ~98 MB) |

**Diagnóstico para comprobarlo en un test.** `window.__diagnostico =
{ renderPage, getPageText }` (`src/diagnostico.ts`) cuenta las llamadas
reales a `engine.renderPage()`/`engine.getPageText()`. Apagado por defecto;
se activa SOLO con `?diagnostico=1` en la URL
(`activarDiagnosticoSiCorresponde()`, llamada una vez desde `main.ts`), para
no dejar ningún rastro en producción.

**Cómo se detecta ahora.**
- `tests/e2e/next/documento-grande.spec.ts`, con la fixture nueva
  `grande.pdf` (500 páginas, `tests/fixtures/generar-fixtures.mjs`): tras
  abrir, `window.__diagnostico.renderPage`/`getPageText` están muy por
  debajo de 500 (nunca 500 ni 1000); el diagnóstico está `undefined` sin
  `?diagnostico=1`; saltar a la página 400 por miniatura pinta esa página y
  el indicador dice "400 / 500"; las 500 miniaturas existen como
  placeholders del tamaño correcto (`toHaveCount(500)`); buscar "Pagina 499"
  encuentra la coincidencia y un `requestAnimationFrame` programado justo
  al lanzar la búsqueda se ejecuta ANTES de que la búsqueda termine
  (aserción estructural — quién gana la carrera entre dos promesas—, nunca
  un umbral de milisegundos, AGENTS.md/E-040).
- `tests/unit/EditSession.test.ts`: abrir un documento de N páginas no llama
  a `getPageText` ni una vez (`vi.spyOn`); `ensureText` cachea (una sola
  llamada al motor en dos lecturas seguidas de la misma página); `ensureText`
  de una página no toca las demás; `invalidateText` fuerza una relectura.
- Regla `texto-perezoso-via-editsession` (`scripts/guards/reglas.mjs`):
  ningún fichero de `src/ui/**`/`src/commands/**` puede llamar a
  `engine.getPageText()` directamente — solo `src/model/EditSession.ts`.

---

### E-044 · `refresh()` tras un comando de una sola página rehacía el documento entero

**Síntoma.** Consecuencia directa de E-043, pero con un disparador distinto:
no solo abrir un documento grande era lento, **cualquier comando** sobre él
también lo era. Rotar la página 1 de un documento de 500 páginas tardaba
más de un segundo — el mismo coste que abrir el documento entero otra vez —
aunque el cambio visible fuera una sola página.

**Causa raíz.** Casi todos los comandos de una sola página (`RotatePageCmd`,
`InsertTextCmd`, `InsertImageCmd`, `HighlightRunCmd`, `SetRunFontCmd`,
`SetFormTextCmd`, `MoveRunCmd`... 20 de los 25 comandos de `src/commands/`)
terminaban su `execute()`/`undo()` con `c.refresh()` — que reconstruye el
modelo de **todas** las páginas del documento (`EditSession.buildPages()`)
— para notificar un cambio que en realidad afectaba a **una sola** página.
Eso disparaba además `model.onReload()`, que en `App.ts` reconstruía las
miniaturas de las 500 páginas otra vez (ver E-043). Antes del arreglo de
E-043 esto significaba releer el texto de las 500 páginas Y repintar las
500 miniaturas por cada rotación/inserción/resaltado — aunque E-043 se
arregle solo, `refresh()` seguiría reconstruyendo el ARRAY de 500
`PageModel` (barato, pero no gratis) y notificando `onReload`
(reconstruir 500 placeholders de miniatura) por cada comando de una sola
página.

**Medido antes del arreglo** (motor real, Node, `grande.pdf`, "rotar la
página 1"): la réplica exacta de lo que hacía `refresh()` — releer
`pageSize`/`pageRotation`/`getPageText` de las 500 páginas — costaba
~70-100 ms en Node (mucho más en el navegador, con el coste real de pintar
500 miniaturas encima: ~1309 ms medidos en Chromium real).

**Arreglo.** `Ctx.refreshPage(pageIndex)` (`src/commands/Command.ts`,
implementado en `EditSession.refreshPage()`) reconstruye **solo** esa
página (tamaño, rotación y texto — eager, porque es casi siempre la que el
usuario tiene delante) y notifica el cambio con el alcance de esa única
página: `DocumentModel.refreshPage()` emite `'change'` (pageIndex) —que
`Viewer` y `App.refreshThumbnail()` ya sabían escuchar para repintar SOLO
esa página/miniatura— y una señal nueva, `onPageRebuilt`, distinta de
`'change'` a propósito: la usa `App.reconcileSelectionAfterReload()` (evita
dejar la selección apuntando a un run que ya no existe tras rotar/insertar/
cambiar fuente…, PR #51) sin dispararse también en cada pulsación al editar
texto (`updateRunText`, que NO reindexa nada y por tanto no necesita
reconciliar). Los 20 comandos de una sola página (`AddNote`, `DeleteObject`,
`DeleteRun`, `DrawRect`, `DrawStroke`, `FiltrarPagina`, `HighlightRun`,
`InsertImage`, `InsertText`, `MoveRun`, `OcrPage`, `ReplaceRunFont`,
`RotatePage`, `SetColor`, `SetFormChecked/Choice/Radio/Text`,
`SetObjectRect`, `SetRunFont`, `SetRunFontSize`, `StrikethroughRun`,
`UnderlineRun`) pasan a `c.refreshPage(this.pageIndex)`. `MoveRunCmd`/
`SetColorCmd` además dejan de llamar a `engine.getPageText()` por su cuenta
(saltándose el caché) y pasan por el mismo `refreshPage()`. Los 4 comandos
que SÍ cambian el CONJUNTO de páginas (`DeletePage`, `MovePage`,
`DuplicatePage`, `InsertPdf`) conservan `c.refresh()`: sus índices
posteriores se desplazan de verdad.

**Medido después del arreglo** (motor real, Node, API real de
`EditSession`): `refreshPage(0)` tras rotar la página 1 de `grande.pdf` —
1 `getPageText`, 1 `pageSize`, 1 `pageRotation`, ~3 ms (antes: 500/500/500,
~70-100 ms en Node). En Chromium real, con `?diagnostico=1`: rotar la
página 1 cuesta 3 `renderPage` y 1 `getPageText` de más (antes: 500/500).

**Cómo se detecta ahora.**
- `tests/unit/EditSession.test.ts`: `refreshPage(i)` recarga solo la
  página `i` (una sola llamada a `getPageText`, espiada) y no toca el
  texto ya cacheado de otras páginas; notifica `'change'` con el
  `pageIndex` correcto y `onPageRebuilt` (sin tocar las demás páginas).
- `tests/e2e/next/documento-grande.spec.ts`: rotar la página 1 de
  `grande.pdf` no aumenta `window.__diagnostico.renderPage`/`getPageText`
  más que un puñado (nunca 500).
- Toda la suite `tests/e2e/next/*.spec.ts` existente sigue en verde
  (miniaturas, marcadores, E-032 de página actual, arrastrar miniaturas,
  deshacer/rehacer de fuente y tamaño — PR #51/E-043 arriba— formularios,
  filtros, OCR…): el cambio de `refresh()` a `refreshPage()` no altera
  ningún comportamiento observable, solo su coste.

---

### E-045 · `Viewer.rendered` solo CRECÍA: recorrer un documento grande dejaba cientos de páginas pintadas a la vez · encontrado en revisión de PR (E-043/E-044)

**Síntoma.** Hallado en la revisión del PR de E-043/E-044, antes de fusionar:
el informe de esa entrada decía que "el visor ya solo mantiene ~2-4 páginas
renderizadas a la vez", pero eso solo era cierto justo AL ABRIR. El visor
(`Viewer.renderVisible()`) ya era perezoso **al pintar** desde E-032 (solo
llama a `engine.renderPage()` para las páginas visibles) — pero nunca
desalojaba una página YA pintada cuando salía de la vista. Si el usuario
recorría un documento de 500 páginas (scroll, miniaturas, búsqueda…),
acababan pintados los 500 `<canvas>` a la vez, con sus `TextLayer`, capas de
notas, formularios e imágenes. A escala de ajuste al ancho, una página A4 es
del orden de 8-9 MB de bitmap RGBA sin comprimir: 500 páginas rondan los
4 GB, suficiente para que la pestaña muera.

**Causa raíz.** `renderVisible()` añadía a `this.rendered` (un `Set` que
solo servía para no repintar una página que ya tenía bitmap) cada página
recién pintada, pero nada la quitaba de ahí cuando dejaba de estar visible
— el único sitio que borraba una entrada era `model.on('change')` (para
FORZAR un repintado tras editar esa página, no para liberarla). "Perezoso
al pintar" (E-043) y "perezoso al liberar" son propiedades DISTINTAS: la
primera evita trabajo que no hace falta AÚN; la segunda evita retener
trabajo que ya no hace falta MÁS. Este repositorio tenía la primera desde
E-032 y le faltaba la segunda.

**Arreglo.** `Viewer.evictFarPages()`, llamado al final de `renderVisible()`
(en cada evento de scroll): calcula un "colchón" de páginas alrededor de lo
visible con `EVICT_OVERSCAN = 6` páginas de margen (más grande que el
`overscan = 1` que usa el propio renderizado, para que un scroll corto no
haga parpadear un repintado) vía la misma función pura `visiblePageIndices`
que ya usaba el renderizado; si ese colchón por sí solo superara
`MAX_PAGINAS_PINTADAS = 12`, se recorta por lejanía a `currentPage` (nunca
se recorta la página actual ni la fijada por una navegación explícita —
`pinnedPage`, E-032). Cualquier página pintada fuera de ese colchón se
desaloja: `wrapper.textContent = ''` descarta el `<canvas>` (bitmap), la
`TextLayer`, las notas, el formulario, las imágenes y la capa de
herramienta — el propio `<div class="page">` wrapper conserva su
`width`/`height` inline (fijados una sola vez en `layout()`), así que el
alto de scroll del panel no se mueve ni un píxel. Al volver a entrar en el
colchón, `renderVisible()` la repinta desde cero, como la primera vez
(`ensureText()` de E-043 sirve el texto del caché, así que solo se repite
el trabajo de `renderPage()`, no el de `getPageText()`).

**Tres estados vivos que NUNCA se desalojan**, aunque su página quede fuera
del colchón:
- Una `.run` en edición (`contentEditable`): el texto a medio escribir se
  perdería sin pasar por `EditTextRunCmd` si se destruyera el nodo.
- Una imagen seleccionada (`Viewer.selectedImage`): sus tiradores quedarían
  huérfanos.
- Un gesto de pluma/rectángulo en curso: `attachToolCapture` (dentro de
  `Viewer`) no pasa por `registrarGesto()` a propósito (ver su propio
  comentario), así que se detecta por la vista previa que deja en el DOM
  mientras dibuja (`.tool-layer > canvas`/`.rect-preview`).

Para el resto de gestos (arrastrar una línea de texto, mover/redimensionar
una imagen, reordenar una miniatura — los tres SÍ pasan por
`registrarGesto()`, `src/ui/gesto.ts`), `evictFarPages()` no desaloja NADA
mientras cualquiera de ellos siga activo en cualquier página: un contador
compartido `gestosActivos` en `gesto.ts` (incrementado al armar el gesto,
decrementado al resolverlo — `onUp`/`onCancel`/el terminador manual, los
tres únicos caminos), consultado con la función exportada
`hayGestoEnCurso()`. Vive en `gesto.ts` porque es el ÚNICO fichero permitido
para enganchar `pointermove`/`pointerup`/`pointercancel` (regla
`gesto-con-cancelacion`) — así que es también el único sitio que sabe de
verdad si hay un gesto en vuelo, sin que `Viewer` tenga que enganchar sus
propios listeners para averiguarlo (lo que violaría esa misma regla).

**Diagnóstico.** `window.__diagnostico.paginasPintadas` (`src/diagnostico.ts`)
es un AFORO (se fija a un valor absoluto en cada `renderVisible()`, no se
acumula como `renderPage`/`getPageText`): cuántas páginas del visor
principal tienen bitmap vivo ahora mismo.

**Medido** (Chromium real, `grande.pdf`, recorriendo el documento de la
página 1 a la 500 en 60 tramos de scroll programático):

| Medida | Antes (sin desalojo) | Después |
|---|---|---|
| `<canvas>` de página pintados a la vez tras recorrer todo el documento | 207 (de 500; se detuvo ahí solo porque la muestra tenía 60 tramos, no 500 — sin tope, sigue creciendo con cada página nueva que se visita) | 3 |
| `window.__diagnostico.paginasPintadas` tras recorrer todo el documento | (no existía el mecanismo) | 3 (tope `MAX_PAGINAS_PINTADAS = 12`) |
| `renderPage`/`getPageText` totales durante el recorrido (mismo trabajo en ambos casos: cada página nueva visitada se pinta y lee una vez) | 215 / 207 | 215 / 207 |
| Memoria aproximada (`performance.memory`, JS heap) | ~54 MB → ~54 MB | ~51 MB → ~51 MB |

**Nota sobre la medida de memoria.** `performance.memory` (`usedJSHeapSize`)
no reflejó una diferencia clara entre antes y después en esta muestra — es
esperable: en Chromium, el bitmap retenido de un `<canvas>` 2D vive
mayormente en memoria de composición/GPU, no en el heap de V8 que mide esta
API, así que no es un proxy fiable para "cuántos bitmaps de página siguen
vivos". El nº de `<canvas>`/`paginasPintadas` (207 → 3, con tope duro de 12
pase lo que pase el tamaño del documento) es la evidencia estructural real
del arreglo — y es lo que assert el test E2E, nunca `performance.memory`
(que además sería cronometraje/medida de entorno, no de trabajo, si se
usara como aserción — AGENTS.md/E-040).

**Cómo se detecta ahora.** `tests/e2e/next/documento-grande.spec.ts`
(`describe` "desalojo de páginas lejanas del visor (E-045)"), tres tests,
los tres comprobados para FALLAR contra el código sin este arreglo (revertí
`Viewer.ts`/`gesto.ts`/`diagnostico.ts` con `git stash` y los corrí antes de
implementar):
- Recorrer las 500 páginas en 20 tramos de scroll programático deja
  `paginasPintadas` ≤ 12 y el nº de `<canvas>` del visor (sin miniaturas)
  ≤ 12 — antes del arreglo: `paginasPintadas` no existe (falla con
  "received value must be a number").
- Volver a la página 1 tras recorrer todo el documento la repinta (su
  `<canvas>` se reconstruyó) y su `TextLayer` sigue funcional: clic en una
  `.run` la pone en edición (`.editing`).
- Empezar a editar una `.run` de la página 1 (sin terminar: sin `blur`),
  recorrer el documento entero con scroll (nunca con clic, que dispararía
  `blur` y confundiría el escenario) y volver: el mismo bloque sigue
  `.editing` con el texto a medias intacto — no se destruyó su DOM mientras
  tenía foco/edición viva.

No hay regla determinista nueva para este defecto: el patrón ("un `Set` que
solo crece") no tiene una firma sintáctica que un grep pueda detectar de
forma fiable sin falsos positivos (hay `Set`s legítimos en el repo que sí
deben solo crecer, p. ej. cachés que nunca hace falta vaciar). La defensa es
el test E2E de arriba.

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

---

### E-046 · Ningún test ejercitaba la app nueva bajo la CSP real de producción

**Síntoma.** No llegó a producir un incidente real: se detectó al preparar el
endurecimiento de la CSP (retirar `'unsafe-eval'`, spec "sec/csp-endurecida").
El proyecto `deploy` de Playwright (`tests/e2e/deploy/`) prueba `dist-deploy/`
— el mismo árbol que publica Vercel — pero lo sirve con `vite preview`, que
**no manda ninguna cabecera de `vercel.json`**. Solo la app vieja, servida por
`server.js` (proyectos `escritorio`/`movil`), se probaba con CSP real. Endurecer
la CSP sin arreglar esto significaba que una rotura del motor WASM en
producción (p. ej. una directiva que de verdad hiciera falta y se quitara)
podía pasar `npm run verify` en verde y solo aparecer para los usuarios reales.

**Causa raíz.** `vite preview` es un servidor estático genérico: sirve
ficheros, no aplica las reglas de `headers` de `vercel.json`. Nadie había
escrito un servidor que las leyera y las aplicara de verdad, así que la única
vía para probar la app nueva bajo CSP real habría sido desplegar a Vercel en
cada iteración.

Riesgo relacionado, mismo origen: `vercel.json` (lo que Vercel aplica) y
`server.js` (lo que la suite prueba para la app vieja) declaran la CSP por
duplicado, a mano, en dos ficheros. Nada impedía que se editara uno sin el
otro — momento en el que "lo que el CI prueba en local" y "lo que se
despliega" dejarían de ser la misma política, silenciosamente.

**Arreglo.**
- `scripts/servir-despliegue.mjs`: servidor Node puro (sin dependencias) que
  sirve `dist-deploy/` aplicando de verdad las reglas `headers`/`rewrites`/
  `cleanUrls` de `vercel.json` — leídas del propio fichero, no reescritas a
  mano —, con los mismos tipos MIME (`.wasm` → `application/wasm`,
  imprescindible para `WebAssembly.instantiateStreaming`) y la misma
  protección anti path-traversal que `server.js`. `playwright.config.js`
  (script `preview:deploy`) lo usa en el `webServer` del proyecto `deploy` en
  vez de `vite preview`, con `reuseExistingServer: false` (mismo motivo que
  E-033: es un `dist-deploy/` congelado en el momento del build).
- `tests/e2e/deploy/csp.spec.ts`, `csp-legacy.spec.ts`, `csp-ocr.spec.ts`:
  abren la app nueva (PDF nativo + edición + guardado, `.md`, `.docx`,
  impresión, OCR real con tesseract.js) y la app vieja (`/legacy/`, pdf.js)
  bajo esa CSP real, con una sonda que acumula tanto el evento
  `securitypolicyviolation` como los mensajes de consola de bloqueo, y exigen
  cero violaciones. El caso de imprimir es el único que depende de si
  `frame-src` permite `blob:` (ver el comentario de ese test): el propio test
  lee la CSP real que manda el servidor para decidir qué exigir, así que
  sigue siendo válido sin editarlo antes y después de retirar `'unsafe-eval'`.
- Regla `csp-coherente`: compara, normalizando espacios y el orden de las
  directivas, el valor de `Content-Security-Policy` de `vercel.json` (entrada
  `headers` con `source: "/(.*)"`) contra la constante `CSP_POLICY` de
  `server.js`, y falla si divergen.

**Cómo se detecta ahora.**
- `tests/e2e/deploy/csp.spec.ts`, `csp-legacy.spec.ts`, `csp-ocr.spec.ts`.
- `scripts/servir-despliegue.test.mjs` (`node --test`): el conversor de
  patrones `source` a RegExp, la resolución de ficheros (`cleanUrls`,
  `rewrites`, índice de directorio) y la protección anti path-traversal
  (`..`, `%2e%2e`, ruta absoluta, directorio hermano con el mismo prefijo),
  más un servidor HTTP real de punta a punta.
- Regla determinista `csp-coherente` (`scripts/guards/reglas.mjs`), con test
  en `scripts/guards/reglas.test.mjs`.

---

### E-047 · Los enlaces salían con un recuadro visible y el subrayado nunca se dibujaba · encontrado en la revisión visual de Word fase 2a

**Síntoma.** En `word-completo.docx` convertido, el hipervínculo aparecía
encerrado en un rectángulo negro/azul, y el "subrayado" que pide el spec no
existía: el texto solo salía azul.

**Causa raíz.** Doble. (1) Una anotación `/Link` creada con
`FPDFPage_CreateAnnot` sin `/Border` propio se pinta con el borde por defecto
de 1 pt (el render usa `FPDF_ANNOT`); Acrobat, Chrome y Word generan siempre
borde invisible. (2) `RunFormato.underline` se leía de `w:u` desde la fase 1
pero ningún código lo convertía en trazo: era un dato huérfano.

**Cómo se detecta ahora.** `PdfiumEngine.addLink` llama a
`FPDFAnnot_SetBorder(annot, 0, 0, 0)`. `Atom/Seg.underline` viaja por
`lineToFlowLine` y `paginar` traza la barra; tests
`lineToFlowLine + paginar: un átomo con underline…` y
`un átomo sin underline no produce ninguna barra`
(`tests/unit/flujo-layout.test.ts`). El recuadro solo se ve a ojo: la defensa
es la revisión visual obligatoria (AGENTS.md §2.8), no un test de píxeles.

**Tercer defecto de la misma revisión.** El texto de las celdas de tabla salía
pegado al borde superior: `renderizarTabla` medía la fracción de línea base
(0,28) desde ARRIBA de la línea, y en `paginar` se mide desde ABAJO (mismo
tipo de mezcla de orígenes que el resto de E-0xx de geometría). Arreglo:
`relYPt = y + alto * (1 - fracción)`. Test:
`la línea base del texto de una celda cae ~13,6pt bajo el borde superior…`
(`tests/unit/ConversorDocxNavegador.test.ts`), rojo antes (8,36 pt).

---

### E-048 · La fase 2a descartaba contenido de Word sin avisar · encontrado al auditar la fase 2a

**Síntoma.** Una celda `vMerge` "continue" se pintaba en blanco sin sombreado;
una fila más alta que una página se salía de ella (contenido perdido bajo el
margen); un `w:hyperlink` con `w:anchor`, un `w:sdt` o `w:fldSimple` dentro de
un párrafo, una ecuación, un `w:sym`, una tabla anidada o una imagen dentro de
una celda desaparecían o se aplanaban SIN ninguna advertencia. En Markdown, un
enlace `javascript:` se pintaba azul como si funcionara.

**Causa raíz.** Los `default: break`/`continue` de `modelo.ts` y `render.ts`
descartaban nodos por ser "ruido", sin distinguir el ruido real (marcadores,
`w:proofErr`) de contenido con texto. La regla del proyecto es que lo no
soportado puede degradarse pero nunca en silencio (§3 del spec de la fila #4).

**Cómo se detecta ahora.** `modelo.ts` cuenta cada descarte con `anotar()` y lo
convierte en aviso (`MENSAJES_PERDIDAS`); cualquier elemento no reconocido que
contenga `w:t` avisa como `desconocido`. Tests en `tests/unit/docx-modelo.test.ts`
(bloque "T1b"), `tests/unit/docx-tabla-render.test.ts` (vMerge, cruce de página,
fila partida, rejilla ampliada, escala) y `tests/unit/markdown-layout.test.ts`.
Regla determinista: no se añade; "descartar sin avisar" no tiene firma
sintáctica única (la defensa es el test de cada categoría al añadir una nueva).

### E-049 · Tests de Vitest lanzaban Chromium dentro de `tests/unit/` y fallaban al azar con "Hook timeout 10000ms" · defecto del TEST, no de la app

**Síntoma.** `npx vitest run` fallaba en 1 de cada 3 corridas: los `beforeAll`
de `ComprimirDocumento.test.ts` y `PdfiumEngine.imagepixels.test.ts` morían
con `Hook timed out in 10000ms` (y `PdfiumEngine.heapgrowth.test.ts` tenía el
mismo patrón). El job de unit es obligatorio en CI: un rojo aleatorio no se
tolera.

**Causa raíz.** Los tres importaban `chromium` de `@playwright/test` y hacían
`chromium.launch()` dentro del hook solo para obtener unos bytes JPEG con
`canvas.toDataURL`. Con varios workers de Vitest en paralelo, arrancar N
navegadores a la vez supera el timeout del hook. Además rompía la separación
del repo: los tests que necesitan navegador van a `tests/e2e/` (Playwright),
los de `tests/unit/` corren en Node.

**Arreglo.** Los tests no necesitaban el navegador, solo los bytes de un JPEG
válido: ahora son constantes base64 fijas (`tests/unit/_jpegsFijos.ts`,
generadas una vez con el codificador de Chromium). Ninguna aserción cambió
(ver `.orquestacion/T-flaky-informe.md`).

**Cómo se detecta ahora.** Regla `sin-playwright-en-unit`: ningún fichero de
`tests/unit/**` puede importar `@playwright/test` ni `playwright`. Test en
`scripts/guards/reglas.test.mjs`.

### E-050 · La app nueva no cumplía WCAG 2.2 AA: teclado, diálogos, avisos, contraste y objetivos táctiles

**Síntoma.** Los `.run` (líneas editables) no eran alcanzables con Tab; `#status`
no se anunciaba a lectores de pantalla; los diálogos «Texto…» y «Comprimir» no
devolvían el foco (el segundo ni siquiera atrapaba Tab); el texto tenue tenía
2.9:1 de contraste; las muestras de color medían 18×18 px; el `<canvas>` de cada
página no tenía nombre.

**Causa raíz.** Se construyó la UI verificando el aspecto y el ratón, no el uso
con teclado ni con tecnologías de apoyo; cada panel modal se escribía a mano.

**Arreglo.** `TextLayer` con «roving tabindex» (un único tabstop por página, ↑/↓/Inicio/Fin,
Enter edita, Escape sale; sin `tabindex=0` en cientos de runs); helper común
`src/ui/dialogo.ts` (`mostrarModal`: `<dialog>` modal, trampa de Tab, Escape,
foco devuelto) usado por `TextPanel` y `CompressPanel`; `role="status"` +
`aria-live="polite"` en `#status` y en el aviso de conversión; tokens de
`estilos.css` con ≥ 4.5:1 en texto y ≥ 3:1 en bordes de control/foco (nuevo
`--ed-control-border`); muestras de 24×24 (cuadro visible de 18 con `background-clip`);
`role="img"` + `aria-label="Página N"` en el canvas.

**Cómo se detecta ahora.**
- `tests/e2e/next/accesibilidad.spec.ts` (Chromium real).
- `tests/unit/contraste.test.ts` calcula las ratios leyendo `estilos.css`.
- Sin regla determinista: no hay un patrón de código que la máquina pueda
  reconocer de forma fiable (a diferencia de un `innerHTML`); lo cubren los tests.

### E-051 · Las tres pestañas del panel lateral no cabían en 168 px y la primera quedaba recortada · encontrado al integrar ramas en paralelo

**Síntoma.** Con las pestañas Páginas, Marcadores y Comentarios, el panel lateral
(`--ed-sidebar-w: 168px`) desbordaba: al enfocar la última, el panel se
desplazaba ~39 px y «Páginas» y los botones de la barra de marcadores salían
recortados por la izquierda. Cada rama por separado (dos pestañas, o tres en la
de comentarios sobre una barra distinta) pasaba su verify.

**Causa raíz.** Dos ramas tocaron la misma zona (`App.ts` sidebar,
`estilos.css`) sin que ninguna viera el resultado conjunto: el ancho del panel
se dimensionó para dos pestañas. Los tests unitarios no calculan maquetación.

**Segunda causa (CI en Ubuntu).** El arreglo a 208 px pasaba en Windows y falló en
CI: `system-ui` resuelve allí a una fuente más ancha (DejaVu Sans o similar) y
«Páginas» seguía recortada. Un ancho fijo en px para texto de UI depende de la
fuente del sistema, que no controlamos.

**Arreglo.** El panel conserva 208 px como valor base pero lleva
`min-width: min-content`: crece hasta el ancho mínimo de sus pestañas (nowrap),
sea cual sea la fuente. Test: `tests/e2e/next/panel-lateral-pestanas.spec.ts`
(cada pestaña dentro del panel, `scrollWidth <= clientWidth`, sin `scrollLeft`),
forzando una fuente ancha para reproducir en local la condición del CI; falla sin
el arreglo y pasa con él.

**Lección.** No fijar anchos en px para texto de UI; medir desbordamiento
(`scrollWidth > clientWidth`) y dejar que el contenedor crezca con el contenido.
Los tests de maquetación deben forzar una fuente ancha, no confiar en la del equipo.

**Cómo se detecta ahora.** Ese test e2e y la revisión visual obligatoria
(AGENTS.md §2.8) tras integrar ramas que añaden controles al mismo contenedor.
No hay regla guard: no existe un patrón de código fiable.

### E-052 · `npm run verify` en local podía fallar en falso: vitest leía fixtures no versionados desactualizados · encontrado al integrar ramas en paralelo

**Síntoma.** Tras cambiar el generador de fixtures (p. ej. al integrar ramas),
`npm run test:unit:src` fallaba en local con PDF/DOCX viejos de
`tests/fixtures/generados/`, y pasaba tras regenerarlos a mano. En un clon
limpio fallaba por ficheros inexistentes.

**Causa raíz.** `tests/fixtures/generados/` no se versiona y solo `test:e2e`
ejecutaba `test:fixtures`. En `verify`, `test:unit:src` corre antes que
`test:e2e`, así que usaba lo que hubiera en disco. El CI lo ocultaba porque el
job `app-nueva` genera los fixtures explícitamente antes.

**Arreglo.** `vitest.config.ts` declara un `globalSetup`
(`tests/unit/_setup/generar-fixtures.ts`) que ejecuta el generador antes de los
unitarios. Es determinista e idempotente; en CI repite un paso barato.

**Cómo se detecta ahora.** Borrar `tests/fixtures/generados/` y ejecutar solo
`npm run test:unit:src` debe pasar. Sin regla guard: no hay patrón de código.

### E-053 · En páginas con `/Rotate` 270 el texto, la inserción y las notas quedaban fuera de su sitio

**Síntoma.** Abrir un PDF con la página girada 270 grados: las líneas editables
(`.run`) salían fuera de la página (p. ej. `left: -291`), y un clic para insertar
texto o una nota guardaba el objeto en otro punto del PDF (a ~250 pt del clic).
Con 90 y 180 todo cuadraba, y por eso nadie lo vio.

**Causa raíz.** `Viewer` construía `PageGeometry` con `engine.pageSize`
(`FPDF_GetPageWidthF/HeightF`), que es el tamaño VISUAL ya girado, pero las
fórmulas de `PageGeometry` para 90/270 trabajan sobre el tamaño SIN girar. Solo
la de 270 usa ambas dimensiones (la de 90 no; la de 180 no intercambia), así que
solo 270 se rompía. `encabezadoPie.ts` lo parcheó en local intercambiando ejes y
el test unitario construía la geometría ya intercambiada: pasaba por tener la
misma suposición que el código. (El análisis estático inicial sospechaba también
de 90; el test e2e demostró que 90 es correcto.)

**Arreglo.** Contrato único: `PageGeometry` guarda el tamaño sin girar y su
constructor es privado; se entra por `PageGeometry.desdeTamanoVisual(anchoVisual,
altoVisual, escala, rotación)`, que hace el intercambio. `Viewer` y
`encabezadoPie` usan la fábrica.

**Cómo se detecta ahora.** `tests/e2e/next/rotacion-geometria.spec.ts` (fixture
`rotada.pdf`, 3 páginas con /Rotate 90/270/180: caja del run contra píxeles del
canvas, inserción y nota contra el punto visual del clic), los tests de 270 en
`PageGeometry.test.ts` y la regla guard `pagegeometry-solo-con-fabrica`.

### E-054 · Resaltar, subrayar y tachar quemaban paths en la página en vez de crear anotaciones (T11)

**Síntoma.** Un resaltado hecho en la app no aparecía en el panel de Comentarios,
no se podía borrar desde allí, otros lectores (Acrobat, el panel de anotaciones
del navegador) no lo trataban como anotación, y modificaba el CONTENIDO de la
página (un rectángulo más en el flujo de dibujo).

**Causa raíz.** `HighlightRunCmd`, `UnderlineRunCmd` y `StrikethroughRunCmd`
usaban `highlightRect`/`fillRect` (objetos de contenido) por ser lo más barato de
reutilizar. Al pasarlas a anotaciones reales aparecieron tres trampas de PDFium
que conviene no volver a pisar: (1) sin `/AP` PDFium NO pinta un `/Highlight`,
`/Underline` ni `/StrikeOut`: hay que llamar SIEMPRE a
`EPDFAnnot_GenerateAppearance`; (2) `FPDFAnnot_AppendAttachmentPoints` no fija
`/Rect`: hay que escribir la envolvente de los quads con `FPDFAnnot_SetRect` o la
anotación mide 0×0; (3) `FPDFAnnot_GetColor` devuelve `false` con la `/AP`
generada, se lee con `EPDFAnnot_GetColor`.

**Arreglo.** `engine.addMarkup(doc, page, tipo, quads, color, contenido?, autor?)`
y `AddMarkupCmd` (deshacer por snapshot). Los quads se calculan UNO POR LÍNEA
VISUAL con `quadsPorLinea` (`src/coords/quads.ts`), que trabaja en el espacio
visual de `PageGeometry.desdeTamanoVisual` (E-053) y vuelve a pt de usuario, de
modo que `/Rotate` queda resuelto en un único sitio. `getComments` lista siempre
el marcado de texto aunque no tenga `/Contents` (como Acrobat). Borrar = el
botón Borrar del panel de Comentarios (`removeNote`, vale para cualquier
anotación); no toca el contenido de la página.

**Comportamiento a conocer.** Los resaltados/subrayados/tachados antiguos (paths
de PDFs ya editados con versiones previas) se quedan como están, son contenido de
la página y no se migran. El borrador de dibujo solo toca objetos de contenido,
así que no borra las anotaciones nuevas: se quitan desde el panel. `/T` (autor)
queda vacío mientras no exista un nombre de usuario configurable; `/M` se
escribe siempre.

**Cómo se detecta ahora.** `tests/unit/PdfiumEngine.markup.test.ts` (persistencia
tras guardar y reabrir de subtipo, QuadPoints, color y Contents; píxeles con la
`/AP`; texto intacto y píxeles idénticos tras borrar), `tests/unit/quads.test.ts`,
`tests/unit/AddMarkup.test.ts` y `tests/e2e/next/markup-anotaciones.spec.ts`
(Comentarios, deshacer, borrar y el quad sobre el texto en `rotada.pdf` con
/Rotate 90, 270 y 180). Sin regla guard: no hay patrón de código textual.

### E-055 · "Comprimir documento" congelaba la interfaz y no se podía cancelar (T9)

**Síntoma.** En un documento con muchas imágenes, `ComprimirDocumentoCmd`
recorría todas las páginas e imágenes de forma síncrona (decodifica, reescala y
codifica JPEG por imagen): la pestaña dejaba de responder hasta el final, sin
avance visible y sin forma de abortar. Era la excepción pendiente que dejó
anotada E-043 ("Comprimir documento no cede el hilo").

**Causa raíz.** Ningún punto del bucle devolvía el control al bucle de eventos
(no había `cederHilo`) ni comprobaba una señal de cancelación; además, abortar
sin más habría dejado el documento a medias (imágenes ya sustituidas en el
motor).

**Arreglo.** El comando recibe ganchos opcionales (`ceder`, `alProgreso`,
`signal`). Cede el hilo tras cada imagen y emite "imagen N/total (página M/total)"
a `#status` y a una barra `role="progressbar"` (`aria-valuenow`) del panel. El
panel tiene "Cancelar" activo mientras comprime y Escape también cancela (antes
solo se vetaba). Al cancelar —o fallar— a mitad, `execute` restaura el snapshot
previo con `reload` y lanza `CompresionCancelada`, así que el bus no registra el
comando. Si no se había tocado ninguna imagen, ni siquiera se reserializa.

**Decisión sobre Worker/OffscreenCanvas.** No se hace en este cambio: la CSP
actual (`worker-src 'self' blob:`) lo permitiría sin tocarla, pero exige empaquetar
un worker, pasar los píxeles por transferibles y reescribir `adaptadorImagenNavegador`
(hoy usa canvas del DOM); es una mejora aparte. Mientras tanto la decodificación y
la codificación de UNA imagen siguen bloqueando el hilo durante lo que cueste esa
imagen; entre imágenes la interfaz responde.

**Cómo se detecta ahora.** `tests/unit/ComprimirDocumento.test.ts` (cede una vez
por imagen, progreso exacto, cancelar a mitad deja los mismos bytes que reabrir el
snapshot, señal ya abortada no toca nada) y
`tests/e2e/next/comprimir-sin-bloquear.spec.ts` (frames de `requestAnimationFrame`
durante la compresión, barra que avanza, Cancelar y Escape con la compresión
retenida de forma determinista en la 3.ª imagen y bytes de `#btn-save` idénticos
a los previos). Sin regla guard: no hay patrón textual fiable.

### E-056 · Word → PDF: títulos huérfanos al pie, encabezados/pies descartados y un solo lado de borde aplicado a toda la tabla · encontrado al planificar la fase 2b (T6)

**Síntoma.** Un `.docx` con un título al final de la página 1 salía con el
título solo al pie y su párrafo en la página 2; los encabezados y pies de página
desaparecían (solo se avisaba); una tabla que declaraba `w:tblBorders` solo en
el lado superior se dibujaba con los cuatro lados y la rejilla interior, y
`w:tcBorders` (bordes por celda) se ignoraba; una imagen flotante (`wp:anchor`)
se omitía en vez de colocarse.

**Causa raíz.** Simplificaciones de la fase 2a que nadie había convertido en
defecto: `leerBordesTabla` tomaba el PRIMER lado visible y lo extendía a toda la
tabla (la precedencia celda > tabla no existía); el maquetador común no tenía
noción de "mantener junto" (`keepNext`/`keepLines`) ni de zonas repetidas por
página; `wp:anchor` se trataba igual que un dibujo no reconocido.

**Cómo se detecta ahora.** `tests/unit/flujo-layout.test.ts` (grupos
`keepStart/keepEnd`, `floatImage`, `colocarZona`), `docx-modelo-2b.test.ts`
(encabezados, campos, keep, `tcBorders`, `wp:anchor`), `docx-render-2b.test.ts`
(PAGE/NUMPAGES por página, first/even, título no huérfano, precedencia de bordes,
bordes por lado, flotante), `ConversorDocxNavegador.test.ts` con el motor real
(`word-encabezados.docx`, `word-flotante.docx`) y `tests/e2e/next/word-a-pdf.spec.ts`.
Dos tests antiguos asumían "un lado = toda la tabla" y se corrigieron (no se
borró cobertura). Regla determinista: no se añade (no hay firma sintáctica única).

### E-057 · El marcado solo podía cubrir líneas enteras; la selección por arrastre exigió tres cuidados (T12)

**Síntoma.** Resaltar/subrayar/tachar solo funcionaban sobre la línea seleccionada
entera (T11): no había forma de marcar un tramo, ni de copiarlo (Ctrl+C), ni de
abarcar varias líneas, como en Acrobat.

**Causa raíz.** El modelo solo conocía runs (`TextRun`: un objeto de texto con una
caja), no caracteres. Al añadir la selección por arrastre aparecieron tres trampas
que conviene no volver a pisar: (1) la caja de un carácter (`FPDFText_GetCharBox`)
es la del GLIFO, no la de la línea: una "a" es más baja que una "l", así que marcar
solo "ea" daba un quad de la mitad de alto; `quadsDeRango` toma la horizontal del
carácter y la vertical de su LÍNEA (envolvente de los caracteres consecutivos que
solapan, en espacio visual, E-053). (2) Tras un arrastre el navegador dispara un
`click` en la línea donde se soltó: sin tragarlo en captura, soltar encima de un run
abría la edición (y en el fondo insertaba texto). (3) Las `.run` tienen texto
transparente pero real: sin `user-select: none` el navegador pinta su propia
selección nativa gris encima mientras se arrastra (y rompe la prueba de oro de reposo
de E-029 si queda algo seleccionado).

**Arreglo.** `engine.getCharBoxes` (perezoso y cacheado por página en
`EditSession.ensureChars`, invalidado como el texto, E-043/E-044); funciones puras en
`src/texto/seleccionTexto.ts` (`indiceCaracterMasCercano`, `quadsDeRango`,
`textoDeRango`); `SeleccionTexto` (UI) con el gesto en `registrarGesto` (E-034), solo
con la herramienta "ninguna" y empezando sobre una `.run` fuera del tirador y de una
línea en edición. La selección solo pinta mientras existe (`.sel-rect`): en reposo no
hay nodos. Ctrl/Cmd+C usa el evento `copy` (no se interpone en un campo editable).

**Cómo se detecta ahora.** `tests/unit/seleccionTexto.test.ts` (punto → carácter;
quads por línea, también con /Rotate 270; altura de línea frente a glifo),
`PdfiumEngine.charBoxes.test.ts` (coincide con `getPageText`), `EditSession.test.ts`
(caché) y `tests/e2e/next/seleccion-texto.spec.ts` (3 quads recortados, copiar, clic
corto sigue editando, tirador, herramienta pluma, páginas /Rotate).
Mayús+flechas desde una línea enfocada: resuelto en E-061 (T16).

**Regla determinista de registro (misma PR).** Esta entrada se escribió como E-055 y
colisionó con la de T9 (ramas paralelas, tercera colisión de números). La regla
`registro-sin-duplicados` (`scripts/guards/reglas.mjs`) exige que cada `### E-0NN`
aparezca una vez y en orden creciente en este fichero; su test cubre duplicado, fuera
de orden y el repo real. El orden se exige a toda entrada nueva; las 13 que ya estaban desordenadas
(E-004, 005, 007, 008, 009, 012, 015-019, 029, 030) se toleran en una lista fija que no crece.

### E-058 · El aviso de conversión decía "omitió algo" también para contenido que sí estaba en el PDF (T13)

**Síntoma.** Al abrir un `.docx` con una imagen flotante (colocada, aunque sin ajuste de
texto), el banner `#conversion-warnings` decía "La conversión omitió algo del documento
original". Una flotante aproximada, una tabla escalada o un enlace sin clic se
presentaban igual que una ecuación o una nota al pie que de verdad no llegan al PDF.

**Causa raíz.** El contrato era `advertencias: string[]`: la clase (omitido frente a
convertido con aproximación) vivía solo en el texto de cada mensaje y la UI no podía
distinguirla, así que usaba un encabezado único y genérico.

**Arreglo.** `Advertencia = { tipo: 'omitido' | 'aproximado', mensaje }`
(`src/convert/advertencia.ts`), tipada EN EL ORIGEN: cada `push` de `modelo.ts`,
`render.ts`, `flujo/layout.ts` y los conversores Word y Markdown elige su clase
(`MENSAJES_PERDIDAS` lleva el tipo en la tupla, así que añadir una pérdida sin clasificar
no compila). La UI muestra dos grupos, "No se pudo incluir:" e "Incluido con diferencias:",
dentro del mismo `role="status"`/`aria-live="polite"`, y oculta el grupo vacío.

**Cómo se detecta ahora.** `tests/unit/advertencia.test.ts` (clasificación por tipo; la
flotante colocada nunca es `omitido`); los tests unitarios existentes de Word/Markdown,
adaptados a `textosAdvertencias`, siguen comprobando que ninguna advertencia se perdió; E2E
`word-a-pdf.spec.ts` (flotante, nota al pie + objeto incrustado, enlace rechazado).

### E-059 · Una anotación de marcado solo se podía quitar desde el panel, y el borrador la ignoraba (T14)

**Síntoma.** Tras resaltar, subrayar o tachar (T11) la única forma de quitar la anotación
era el panel Comentarios: un clic sobre ella no hacía nada (o abría la edición de la
línea de debajo) y el modo borrador solo conocía trazos y rectángulos.

**Causa raíz.** Las anotaciones reales no tienen objeto de contenido ni capa DOM propia: el
clic llegaba a la `.run` de debajo. Acertar una anotación exige sus QuadPoints en pt de
usuario (un subrayado de varias líneas NO responde en el hueco entre ellas, que sí cae
dentro de su `/Rect`) y el clic llega en px CSS de página: mezclar ambos sin la geometría
común es la familia de E-053.

**Arreglo.** `puntoEnQuad`/`marcadoBajoPunto` (`src/coords/quads.ts`: sin suponer el orden de
vértices ni quads alineados con los ejes). `Viewer.alClicMarcado` escucha el `click` de la
página en CAPTURA, convierte el punto con `geom.cssToPt` y selecciona la anotación
(`.marcado-sel[role=option][aria-selected=true]`, un recuadro por quad). Supr/Retroceso
(atajo `suprimir`, solo con el foco en el cuerpo o el visor) la borra con `RemoveNoteCmd`;
Escape la suelta; el borrador la borra si no hay trazo cerca. Precedencia: arrastrar
(>4 px) selecciona texto (T12, su `click` posterior se traga antes); clic corto sobre la
anotación la selecciona; un segundo clic sobre la ya seleccionada la suelta y deja editar
la línea; el primer clic deja además la línea seleccionada (sin editarla) para poder encadenar
Resaltar/Subrayar/Tachar sobre la misma línea (`markup-anotaciones.spec.ts` lo cubrió y falló
cuando no lo hacía). Trampa encontrada al probarlo: tras un clic en una zona sin elemento enfocable el
foco queda en `#viewer` (`tabindex=-1`), no en `<body>`.

**Cómo se detecta ahora.** `tests/unit/quads-impacto.test.ts` (dentro/fuera/borde, orden de
vértices, quad girado 30 grados, degenerado, /Rotate 270) y
`tests/e2e/next/anotaciones-seleccion.spec.ts` (seleccionar+Supr+deshacer con el PDF
guardado, Retroceso, Escape, nota, borrador, arrastre sigue seleccionando texto, precedencia,
quads frente a /Rect, página girada). No se añade regla determinista: no hay patrón de código
repetible, el riesgo ya lo cubre `pagegeometry-solo-con-fabrica` y el test E2E.

### E-060 · Decodificar/codificar UNA imagen grande seguía bloqueando el hilo al comprimir (T15)

**Síntoma.** Tras T9 (E-055) la interfaz respondía entre imágenes, pero una sola imagen grande
(p. ej. 2000×2800 px) congelaba la pestaña durante su reescalado (`drawImage` + `getImageData`)
y su codificación JPEG.

**Causa raíz.** El adaptador de imagen usaba canvas del DOM en el hilo principal. El trabajo de
píxeles no cede en mitad de una operación, por mucho que el comando ceda entre imágenes.

**Arreglo.** `src/ui/compresorWorker.ts` (Worker módulo empaquetado por Vite, mismo origen: la CSP
`worker-src 'self' blob:` no cambia) reescala y codifica con `OffscreenCanvas` +
`convertToBlob`; PDFium sigue en el hilo principal (WASM síncrono con estado del documento) y el
worker solo recibe píxeles RGBA (transferidos) y devuelve bytes. El protocolo (petición con id,
respuesta, error, timeout) y el fallback son lógica pura en `src/image/protocoloCompresor.ts`. Si
no hay Worker/OffscreenCanvas, no se puede crear el worker, responde error o expira, se degrada al
camino del hilo principal de T9 (aviso solo en consola de desarrollo, nunca un fallo visible) y no
se vuelve a intentar en esa compresión. Los píxeles se COPIAN antes de transferirlos: el fallback
y el comando los necesitan intactos tras el envío (un buffer transferido queda detached). Al
cancelar se cierra el worker y lo pendiente se rechaza sin caer al fallback (el comando restaura el
snapshot y lanza `CompresionCancelada`); el comando cierra el adaptador siempre en `finally` (§2.6).

**Cómo se detecta ahora.** `tests/unit/protocoloCompresor.test.ts` (ids, emparejado, timeout,
cierre, fallback, cancelación, sin Worker real) y `tests/e2e/next/comprimir-worker.spec.ts`: medición
ESTRUCTURAL (E-040) sobre `escaneado.pdf` — para cada petición al worker, una tarea de
`MessageChannel` encolada tras el envío se ejecuta antes que la respuesta y, en el reescalado de la
imagen entera, avanzan frames de un `requestAnimationFrame` encadenado; más fallback sin
`OffscreenCanvas` y con `Worker` roto. `tests/e2e/deploy/csp-compresion-worker.spec.ts`: bajo la CSP
real, 0 violaciones y las operaciones se resuelven en el worker. **Límite conocido:** PDFium
decodificando la imagen (`getImagePixels`) y reinsertándola sigue en el hilo principal. Los filtros
(grises, B/N, color mágico) siguen en el hilo principal: moverlos es el siguiente paso.

### E-061 · Seleccionar texto y seleccionar una anotación exigían ratón (WCAG 2.1.1) (T16)

**Síntoma.** La selección de texto (T12) solo nacía de un arrastre y las anotaciones de marcado (T14)
solo se seleccionaban con un clic: quien usa solo teclado o un lector de pantalla no podía copiar un tramo,
marcarlo ni borrar un resaltado. Las anotaciones no son enfocables (no tienen nodo DOM en reposo, E-029).

**Causa raíz.** Los dos modelos de selección se diseñaron desde el puntero: una selección de texto es un
rango de índices de carácter fijado por dos puntos de ratón; una anotación seleccionada, el resultado de
`marcadoBajoPunto(x, y)`. Ninguno tenía una forma de "moverse" sin puntero. Al añadirla aparecieron tres
trampas: (1) el rango por índices INCLUSIVOS no distingue "nada seleccionado" de "un carácter": el foco
que se mueve con Mayús+flecha es una posición ENTRE caracteres (caret), y la conversión (`rangoACarets`/
`caretsARango`) es la única frontera entre ambos modelos; (2) PDFium intercala `\r\n` SIN caja entre líneas:
una pulsación debe atravesarlos y no gastarse en un carácter invisible (`caretSiguiente`); (3) `bandasDeLinea`
devolvía un array NUEVO por carácter, así que "misma línea" no se podía comparar por referencia y Mayús+↓
trataba cada carácter como su propia línea (ahora todos los de una línea comparten el mismo array).

**Arreglo.** Teclas documentadas en `TABLA_ATAJOS` (y, por tanto, en el panel de ayuda `?`), elegidas para no
chocar con el navegador ni con otros atajos: Mayús+→/← (un carácter) y Mayús+↓/↑ (una línea) con una línea
enfocada por el roving tabindex (A-03, que ahora ignora las flechas con modificador); Alt+↓/↑ recorre las
anotaciones de la página enfocada en ORDEN DE LECTURA (`ordenLecturaMarcados`, no el de creación), con el
mismo estado que el clic de T14 (contorno, `aria-selected`, Supr borra con deshacer, Escape suelta). Se
descartó F6 (el navegador lo usa para cambiar de zona) y Alt+←/→ (atrás/adelante). El anuncio sale por
`#status` (`role="status"`, `aria-live="polite"`): «Seleccionado: «…»» y «Resaltado 2 de 5: «extracto»»,
colapsando blancos y truncando a 80 caracteres (`resumirParaAnunciar`). Nada pinta en reposo: la selección
y el contorno solo existen mientras se usa la tecla (prueba de oro de E-029 intacta).

**Cómo se detecta ahora.** `tests/unit/seleccionTeclado.test.ts` (caret por carácter y por línea,
conversión de rangos, orden de lectura, texto de una anotación), `anuncio.test.ts` (una regresión real: el
colapso de blancos escrito sin la barra invertida se comía las "s"), `atajos.test.ts` (teclas nuevas y que
no se interceptan en un campo editable) y `tests/e2e/next/teclado-seleccion.spec.ts`, que no usa el ratón.
Límite conocido: la selección vive en UNA página; Mayús+↓ más allá de la última línea de la página selecciona
hasta el final de su texto.

### E-062 · `npm run e2e:liberar` no conocía el puerto 4174 ni cerraba los procesos huérfanos

**Síntoma.** Un `servir-despliegue.mjs` huérfano en el 4174 (proyecto `deploy`, PR #69) hizo fallar el
proyecto `next` sin ejecutar ni un test: Playwright arranca los `webServer` antes de correr nada, y como
`reuseExistingServer` es `false` en los dos servidores congelados (E-033), un puerto ocupado aborta la
corrida entera. `npm run e2e:liberar` solo liberaba 4173 y 3100, así que el aviso "ejecuta e2e:liberar" no
arreglaba nada. Además, los `node`/`vite`/`chrome-headless-shell` de corridas anteriores se acumulaban
vivos (aunque no escucharan en ningún puerto) y son la causa probable de las dos "muertes por memoria"
de la tanda.

**Causa raíz.** Dos listas de puertos escritas a mano en dos sitios (`playwright.config.js` y
`scripts/liberar-puertos.mjs`) que se desincronizaron al añadir el servidor de despliegue: nadie tenía
por qué acordarse del segundo fichero. Y liberar solo "lo que escucha en un puerto" no cubre a los
procesos que sobreviven sin puerto.

**Arreglo.** Fuente única `scripts/puertos-e2e.mjs` (`PUERTOS_E2E`), importada por el config (`port:
PUERTOS_E2E.x`, mismo comportamiento) y por `liberar-puertos.mjs`. El script, además, lista los procesos
(`Get-CimInstance Win32_Process` vía `powershell -NoProfile` en Windows, `ps -eo pid=,ppid=,args=` en Unix)
y cierra los huérfanos con la lógica pura de `scripts/procesos-e2e.mjs`: solo nombre node/vite/vitest/
chrome(-headless-shell) Y línea de comandos que contiene la ruta de ESTE repo (con límite de ruta: `PDF
Editor 2` no casa); si no puede leer nombre o línea de comandos, avisa y no cierra; nunca el propio
proceso ni sus ancestros (npm, la shell). Límite conocido: un chrome huérfano cuyo padre ya murió no cita
la ruta del repo en su línea de comandos y no se cierra (se cierra si su padre era un node del repo y se
mata el árbol, o a mano).

**Cómo se detecta ahora.** Regla `puertos-e2e-sincronizados` (todo `port:` del config sale de
`PUERTOS_E2E`, y ambos ficheros importan el módulo) con su test en `reglas.test.mjs`, y
`scripts/procesos-e2e.test.mjs` (clasificación repo/ajeno/desconocido, ancestros protegidos y parsers, con
datos falsos).

### E-063 · En una página con `/Rotate` 90/270 las líneas editables se solapaban y un clic editaba OTRA línea

**Síntoma.** Abrir un PDF normal, rotar una página 90° y hacer clic sobre el título: entraba en edición
«Cuarta línea…» y al escribir se reescribía esa otra línea (el usuario no había tocado esa línea: AGENTS.md
§2.3). Las cajas `.run` medían ~156×398, 312×395… en vez de ~16×400, el editor salía horizontal y desbordaba el
visor. Con 180 las cajas no se pisaban, pero el texto de la capa seguía sin la rotación de la página.

**Causa raíz.** E-053 arregló la fábrica de `PageGeometry`, pero `TextLayer` seguía colocando cada `.run` con la
geometría VISUAL (`rectPtToCss` ya girada) y le daba `min-width`/`height`/`line-height` de esa caja visual.
Con 90/270 la caja visual es vertical (estrecha y alta), pero el texto dentro seguía horizontal: la línea de
texto (`white-space: pre`) crecía a lo ancho de su contenido, las cajas vecinas se pisaban y la última en el
DOM ganaba el clic. Los tests de rotación de E-053 medían la caja del run, no el solape ni el clic, y su
fixture contragira el texto (queda horizontal) así que el defecto no aparecía.

**Arreglo.** La capa de texto se dibuja en coordenadas de la página SIN girar (`geom.sinGirar()`, px CSS de
usuario) y UNA transformación CSS sobre el contenedor (`PageGeometry.transformCapaSinGirar`, derivada de
`ptToCss`: 90 `matrix(0,1,-1,0,Hs,0)`, 180 `matrix(-1,0,0,-1,Ws,Hs)`, 270 `matrix(0,-1,1,0,0,Ws)`, origen 0 0)
la lleva al espacio visual, igual que el canvas. Cada `.run` conserva su dirección de texto, su alto de línea
y su editor sin cálculos por run. Lo que se mide en pantalla (arrastre con el tirador) pasa por
`deltaVisualACapaSinGirar`, de la misma geometría. La selección de texto (T12), las anotaciones (T14) y los
clics de fondo ya convertían de cliente a página con `getBoundingClientRect` del `.page` y la geometría
visual, que no cambia, así que no dependen de la capa.

**Cómo se detecta ahora.** `tests/e2e/next/capa-texto-rotada.spec.ts` (fixture `rotada-lineas.pdf`: /Rotate 90,
270 y 180 con 4 líneas de texto normal; cajas sin solape, sobre los píxeles de su línea, clic al centro de la
línea 3 edita la 3 y el PDF guardado conserva las demás), `tests/unit/PageGeometry.test.ts` (la matriz coincide
con `ptToCss`) y la regla guard `capa-texto-sin-rotacion-por-run` (ni aritmética de rotación ni conversiones
visuales por run dentro de `TextLayer.ts`).

**Detalles que importan (E-063).** (1) Mover la rotación a la capa deja el texto girado EN EL ESPACIO DE USUARIO
(p. ej. páginas /Rotate con el texto contragirado para leerse horizontal, o texto girado en una página sin
rotar) con la caja de la línea vertical en la capa: por eso `TextRun.anguloDeg` (atan2(b, a) de la matriz del
objeto de texto) permite editar la línea girada sobre su origen (`rotate(-ángulo)`), y en reposo la caja mide
EXACTAMENTE la línea (`width` fijo + `overflow: clip`): con `min-width` el texto horizontal desbordaba la caja
girada y volvía a taparse con sus vecinas (lo vio `anotaciones-seleccion.spec.ts`, caso /Rotate). (2) Solo se
tratan múltiplos de 90°; otros ángulos se siguen editando como horizontales (limitación previa, E-030).

### E-064 · La segunda línea que se edita en una misma sesión no recibía lo tecleado

**Síntoma.** Editar una línea (clic, teclear, Enter) y a continuación otra: la segunda pasaba a `editing` y
conservaba el foco, pero Ctrl+A seleccionaba la página entera y lo tecleado no llegaba a la línea (el texto
nuevo se perdía sin aviso). Ocurría también en `main`, con Enter, con un clic fuera y con Tab; la primera
edición de cada carga funcionaba, por eso ningún test lo vio.

**Causa raíz.** `empezarEdicion` solo llamaba a `block.focus()`. En un `contenteditable`, `focus()` coloca el
cursor dentro únicamente si el documento no tiene ya una selección; tras la primera edición quedaba una
selección colapsada en otro nodo (`.run` de reposo, `user-select: none`), así que el elemento tenía el foco
pero el cursor seguía fuera de él.

**Arreglo.** Al entrar en edición se fija la selección explícitamente dentro del bloque (rango colapsado al
inicio), después de `focus()`.

**Cómo se detecta ahora.** `tests/e2e/next/edicion-consecutiva.spec.ts`: abre `nativo.pdf`, edita las líneas 2 y 4
seguidas confirmando con Enter, con clic fuera y con Tab, y comprueba con el motor que ambas tienen el texto nuevo
y el resto no cambia (falla en `main` sin el arreglo). Sin regla guard: no hay patrón estático fiable.

### E-065 · Con páginas de tamaños distintos, "Subir página" no seguía a la página movida y el siguiente "Subir" movía OTRA

**Síntoma.** Documento con A4, una página apaisada y otra diminuta: ir a la 3, pulsar "Subir" y el indicador
decía "4 / 4" en vez de "2 / 4"; un segundo "Subir" movía la página equivocada. Duplicar, insertar un PDF y
borrar tampoco dejaban la página actual en la que el usuario espera. Actuar sobre una página distinta de la
elegida es bloqueante (misma familia que E-032).

**Causa raíz.** `moveCurrentPage` asignaba `currentPage = to` a mano (sin `goToPage`, así que sin pin del
`Viewer`) y ejecutaba el comando; el `refresh` reconstruye el visor y el `IntersectionObserver` elegía la página
"más visible", que con tamaños mixtos no es la movida. Duplicar, insertar PDF y borrar no tocaban la página
actual en absoluto.

**Arreglo.** Mover, duplicar, insertar PDF, borrar y rotar esperan a `bus.execute` y llaman a `goToPage`
(que fija `currentPage` y el pin): la movida en su nueva posición, la copia, la primera página insertada, la
siguiente (o la anterior si era la última) y la misma tras rotar. Subir/Bajar reutilizan `commitReorder`, el
camino del arrastre de miniaturas.

**Cómo se detecta ahora.** `tests/e2e/next/pagina-actual-mover.spec.ts` con `tamanos-mixtos.pdf` (falló antes del
arreglo con `Expected: "2 / 4"  Received: "4 / 4"`). Sin regla guard: el patrón ya lo cubre
`navegacion-por-gotopage`. Aparte: `preview:next` y `preview:deploy` pasan por `scripts/servir-preview.mjs` y la
regla `puertos-e2e-sincronizados` rechaza un `--port <n>` escrito a mano en los `preview:*` de package.json.

### E-066 · El tirador de mover de una línea pegada al borde de la página quedaba fuera de la página

**Síntoma.** El tirador (`.run-drag`) sobresale 9 px por la esquina superior izquierda de la línea; en una línea
a menos de 9 px del borde izquierdo o superior de la página caía fuera de ella (recortado o inalcanzable).

**Causa raíz.** Desplazamiento fijo `left/top: -9px` sin tener en cuenta la posición del bloque en la capa.

**Arreglo.** `makeDragHandle` limita el desplazamiento a la distancia real al borde (nunca por fuera de la
página; se solapa con el texto si hace falta).

**Cómo se detecta ahora.** `tests/e2e/next/tirador-en-borde.spec.ts` con `lineas-borde.pdf` (esquina, suelo,
centro): el tirador está dentro de la página y `elementFromPoint` en su centro es el propio tirador. Sin regla
guard: es geometría de maquetación.

### E-067 · La búsqueda contaba coincidencias pero no permitía ir a ellas

**Síntoma.** En `grande.pdf` (500 págs.), «Pagina 4» daba «333 coincidencia(s)» y la vista se quedaba donde
estaba: sin Siguiente/Anterior, sin Enter ni F3. Solo «Reemplazar» recorría coincidencias. Con la búsqueda aún
en marcha no había progreso ni forma de ir a la primera coincidencia.

**Causa raíz.** `search()` solo guardaba un mapa página → cajas para pintar; no existía el concepto de
"coincidencia actual" navegable ni el desplazamiento del visor hasta una caja (solo `scrollToPage`, que alinea
la página, no la caja). Además `setHighlights` borraba la coincidencia actual en cada llamada.

**Arreglo.** `IteradorCoincidencias` (lista con cursor; los resultados se añaden por páginas durante la
búsqueda, "siguiente" da la vuelta con aviso solo con la búsqueda terminada), contador `#search-count`
(`aria-live="polite"`, progreso «Buscando… n/N · k resultados»), botones `#btn-search-prev`/`#btn-search-next`,
Enter/Mayús+Enter en el campo y F3/Mayús+F3 en `TABLA_ATAJOS`. Ir a una coincidencia usa `goToPage` (E-032) y
`Viewer.revelarRect`, que centra la caja con la geometría común (`geom.rectPtToCss`, E-053, válida con
`/Rotate`) aunque la página esté desalojada (E-045); al repintarse la página `drawHighlights` restituye
resaltados y coincidencia actual.

**Cómo se detecta ahora.** `tests/e2e/next/busqueda-navegacion.spec.ts` (grande.pdf y rotada-lineas.pdf) y
`tests/unit/iteradorCoincidencias.test.ts`. Sin regla guard: es una funcionalidad ausente, no un patrón de código.

### E-068 · "Duplicar" (y subir/bajar) con la CPU cargada dejaba la página actual en OTRA: el "flaky" de `pagina-actual-mover` era una carrera real

**Síntoma.** `pagina-actual-mover.spec.ts` fallaba de forma intermitente (esperaba «3 / 4», recibía «4 / 4»;
«4 / 5» → «5 / 5» en Duplicar). Con la CPU normal 0 de 280 ejecuciones; con `Emulation.setCPUThrottlingRate=6`
fallaba ~1 de cada 6 en «Duplicar» (8 de 84). No es un test inestable: es E-065 con otro disparador, y el
usuario real lo sufre en un equipo lento (la acción siguiente, p. ej. «Eliminar página», actúa sobre otra página).

**Causa raíz (orden de eventos medido, ms desde la carga).**
`rebuild 4972 → goToPage 6467 / scrollToPage 6467 → IO best=2 6616 → finishProg 6696 (temporizador de 150 ms,
SIN haber visto ningún scroll) → scroll prog=false 6698 → PIN->null → IO best=4 → currentPage=4`.
`scrollToPage` armaba un temporizador de 150 ms para cerrar la ventana de "scroll programático"; con la CPU
cargada el primer evento `scroll` del `scrollIntoView` suave llegó DESPUÉS (183 ms). Esos eventos se leyeron
como scroll del usuario, liberaron el pin (`pinnedPage`) y el `IntersectionObserver` eligió "la más visible"
(la A4 de al lado, con páginas de tamaños mixtos). Distinguir scroll programático de scroll del usuario por
**tiempo** es una carrera; el `rebuild` y el orden `goToPage`-tras-comando eran correctos (síncronos).

**Arreglo.** `Viewer.scrollToPage` calcula el `scrollTop` de destino (`pinTop`, acotado al máximo). Si ya está
ahí no arma nada (no habrá scroll). Si no, la espera hasta el primer evento es larga (1500 ms) y solo después
se debouncea a 150 ms; el scroll programático se cierra al LLEGAR a `pinTop` (o por `scrollend`). Un evento
de scroll no programático que deja el visor en `pinTop` (p. ej. el del vaciado del DOM en `rebuild`) no libera
el pin; uno que lo deja en otro sitio sí (usuario real). Decisión por posición, no por reloj.

**Cómo se detecta ahora.** `tests/e2e/next/pagina-actual-mover.spec.ts`, bloque «E-068», corre «Duplicar»,
«Subir» y «Bajar» con la CPU ralentizada x6 por CDP (siempre, sin variable de entorno); sin el arreglo falla.
Sin regla guard: no hay patrón estático fiable (un `setTimeout` es legítimo en general).

---

### E-069 · El panel «Más» del móvil (390 px) amontonaba ~45 controles solapados y «Comprimir» salía cortado

**Síntoma.** Con `#btn-more` abierto en 390×844 los botones de las cinco barras contextuales se pisaban
(«Borrador» sobre «Encabezado y marca», «Bajar»/«Insertar PDF»/«Extraer»/«Firmar» apilados, el campo de la firma
sobre el rango de Dividir) y el último, «Comprimir», quedaba cortado por el borde del panel.

**Causa raíz.** El panel móvil reutilizaba las `.context-bar` de escritorio. `.context-bar .icon-btn` lleva
`height: 100%` (para llenar una barra de una sola fila); en la hoja apilada, con `flex-wrap`, ese porcentaje se
resolvía contra la barra entera y los botones de filas distintas medían lo mismo que el grupo, así que se
pisaban. Además no había encabezado por grupo ni alto mínimo táctil para los campos de texto.

**Arreglo.** Cada barra lleva un `.context-titulo` (solo visible en el panel móvil), los botones usan
`height: auto; min-height: 44px` y etiqueta que puede partirse (`overflow-wrap: anywhere`, sin anchos fijos en px,
lección de E-051), los campos `min-height: 40px`, y el panel es una hoja con `max-height: min(70vh, 100dvh - 120px)`,
`overflow-y: auto` y `overflow-x: hidden`.

**Cómo se detecta ahora.** `tests/e2e/next/movil-mas.spec.ts` (390×844, fuente ancha forzada): encabezados en
orden, cajas dos a dos sin solape, `scrollWidth <= clientWidth` en cada control, altos >= 40 px, sin scroll
horizontal, scroll vertical propio, todos los botones alcanzables con scroll y «Comprimir» abre su diálogo. Falla
sin el arreglo (solapaba `btn-rect` con `btn-encabezado`). Sin regla guard: es maquetación, no un patrón de código.

---

### E-070 · La firma recién insertada aparecía fuera de pantalla y (dibujada) sin seleccionar

**Síntoma.** Tras «Insertar firma» el estado decía «Firma insertada.» pero no se veía nada: con zoom alto o en
una página alta la caja caía en y=1460 con el visor de 900 px y scroll 0. La firma dibujada ni siquiera quedaba
seleccionada (solo la de imagen y la guardada), así que no se podía mover sin hacer scroll a mano.

**Causa raíz.** La firma se centraba en la PÁGINA entera (`(ancho - w)/2`, 15 % desde abajo), no en lo que el
usuario está mirando, y la ruta del pad (`openSignature`) tenía su propia copia de la colocación sin el paso de
selección que sí tenía `colocarFirmaSeleccionada`. Dos rutas para lo mismo: una se arregló, otra no.

**Arreglo.** Las tres rutas (dibujada, desde imagen, guardada) pasan por `colocarFirmaSeleccionada`, que centra
la firma en el centro de la parte visible de la página (`Viewer.centroVisiblePt`: intersección página-visor en
px CSS de viewport pasada a pt con la geometría de la página, acotada a la página), la selecciona y, si aun así
queda fuera, desplaza el visor (`revelarRect`).

**Cómo se detecta ahora.** `tests/e2e/next/firma-visible.spec.ts`: con zoom alto sobre `nativo.pdf` (dibujada,
desde imagen y guardada) y a media página de `grande.pdf`, la caja `.image-box.selected` está entera dentro del
visor. Fallaba antes (la dibujada no se seleccionaba; las otras desbordaban el visor). Sin regla guard: es
colocación en pantalla, no un patrón de código.

---

### E-071 · Borrar una página con marcadores dejaba un marcador colgante y bloqueaba la edición de marcadores con un mensaje engañoso

**Síntoma.** `paginas-pequenas-marcadores.pdf` → borrar la página 2: «Marcador 2» seguía en el panel (y navegaba a
otra página) y aparecía «Este documento tiene marcadores con acciones que este editor aún no puede conservar;
la edición está desactivada». El documento no tiene ninguna acción: solo un destino huérfano.

**Causa raíz.** `DeletePageCmd` solo llamaba a `FPDFPage_Delete`. El destino del marcador apunta al OBJETO de la
página borrada; al releer, `FPDFDest_GetDestPageIndex` devuelve -1 y `bookmarkTarget` lo clasifica como acción
`no-soportada` («Destino sin página resoluble»), lo que bloquea la edición (E-031/T4b).

**Arreglo.** El mismo comando lee el outline ANTES de borrar y, si algún marcador apuntaba a esa página, lo
reescribe después con `sinPaginaBorrada` (`src/outline/arbol.ts`) y avisa al panel. Decisión sobre los hijos:
SUBEN un nivel, ocupando el lugar del padre en orden; un hijo que apunta a una página viva no debe perderse
porque su encabezado desaparezca (los que apuntaban a la misma página borrada se quitan también). Los destinos de
páginas posteriores se reindexan (-1). Un outline con acciones `no-soportada` no se toca (no se puede reescribir
sin perderlas); si ningún marcador apuntaba a la página, tampoco se reescribe (PDFium ya mantiene el resto por
referencia). Deshacer sigue siendo por snapshot, así que devuelve el árbol exacto.

**Cómo se detecta ahora.** `tests/e2e/next/marcadores-borrar-pagina.spec.ts` (outline releído con el motor del
PDF guardado: borrar p.2, borrar p.1 con hijo que sube, JavaScript sin tocar, URI conservado, deshacer exacto,
edición habilitada) y `tests/unit/arbolMarcadores.test.ts`. Fallaba antes. Sin regla guard: es lógica de
dominio, no un patrón estático.

---

### E-072 · Tras rotar una página, el "ajustar al ancho" no se recalculaba y la página se salía del visor

**Síntoma.** `nativo.pdf` (ajustado al ancho al abrir) → Rotar: la página pasaba a apaisada con la escala de la
vertical y desbordaba el visor por la derecha (scroll horizontal, texto fuera de vista) hasta pulsar «Ajustar al ancho».

**Causa raíz.** La app no recordaba SI el usuario estaba en «ajustar al ancho» o en un zoom elegido: solo guardaba
`scale`. `rotateCurrentPage` no tenía forma de saber si reajustar o respetar un zoom manual, y no hacía ninguna de las dos.

**Arreglo.** Estado explícito `modoZoom: 'ancho' | 'manual'` en `App`: `fitWidth` (y la apertura) lo ponen en
`'ancho'`; `zoom()` (botones y atajos) en `'manual'`. Tras rotar, solo en modo `'ancho'` se llama a `fitWidth`.

**Cómo se detecta ahora.** `tests/e2e/next/zoom-tras-rotar.spec.ts`: en modo ancho la página apaisada mide el ancho
útil del visor (±4 px) sin scroll horizontal; con zoom manual (+) rotar no cambia el porcentaje. Fallaba antes.
Sin regla guard: es estado de interfaz, no un patrón estático.

---

### E-073 · Nota y Rectángulo solo se podían usar con ratón (WCAG 2.1.1)

**Síntoma.** Con el teclado, `N` activaba «Modo nota» y `R` el rectángulo, pero ninguna tecla colocaba la nota ni
dibujaba nada: Enter/Espacio/flechas no hacían nada. Seleccionar, resaltar, subrayar, recorrer anotaciones y editar
sí tenían teclado (E-061).

**Causa raíz.** Ambas herramientas nacieron como gestos de puntero (`onBackgroundClick`, `pointerdown/move/up` de
`attachToolCapture`) y la accesibilidad por teclado se fue añadiendo herramienta a herramienta (A-03, T16) sin una
lista de «qué acciones de creación siguen dependiendo del ratón». Nadie la comprobó para las herramientas de dibujo.

**Arreglo.** Atajos contextuales (`contextual: true` en `TABLA_ATAJOS`, `resolverAtajoContextual`; solo aplican con
la herramienta activa y el foco en el visor, en fase de captura para adelantarse al Enter que edita una línea):
- Nota: Enter la coloca sobre la línea enfocada o, si no hay, en la esquina superior izquierda de lo visible y abre
  el diálogo de texto.
- Rectángulo: Enter crea un borrador de 120×80 pt centrado en lo visible; flechas lo mueven 5 pt, Mayús+flechas lo
  redimensionan (← → ancho, ↑ ↓ alto); Enter lo confirma (un único `DrawRectCmd`, un solo paso de deshacer) y Esc
  lo cancela. El borrador vive en puntos visuales de página (independiente de zoom y de /Rotate) y cada paso se
  anuncia en `#status`.
- Pluma: EXCEPCIÓN documentada (ayuda `?` y este registro). Un trazo a mano alzada depende del recorrido del
  movimiento, que WCAG 2.1.1 exime de requerir teclado; la alternativa para marcar sin ratón es Rectángulo,
  Resaltar, Subrayar, Tachar o Nota.

**Cómo se detecta ahora.** `tests/e2e/next/herramientas-teclado.spec.ts` (sin `page.mouse` ni clics: nota con y sin
línea enfocada, rectángulo crear/mover/redimensionar/confirmar con el PDF guardado, Esc, Enter sigue editando sin
herramienta, ayuda) y `tests/unit/atajos.test.ts`. Fallaban antes. Sin regla guard: es cobertura funcional.

---

### E-074 · Recargar, cerrar o abrir otro documento con cambios sin guardar perdía el trabajo sin aviso (N8)

**Síntoma.** Tras editar una línea y resaltar, recargar la pestaña (o abrir otro PDF, o «Nuevo») descartaba todo sin
preguntar. No había manejador `beforeunload` ni noción de «documento modificado».

**Causa raíz.** El estado «sucio» no existía: el `CommandBus` solo guardaba pilas de deshacer/rehacer y la UI no sabía
si lo hecho desde el último guardado estaba a salvo. Nadie revisó los caminos que destruyen la sesión (recarga, cierre,
`openFile`, `openImage`, `newBlank`) desde el punto de vista de «qué se pierde».

**Arreglo.** `CommandBus` acepta un `onCambio` que se llama tras ejecutar, registrar (`pushExecuted`), deshacer y rehacer.
`App.marcarSucio()` lo refleja con un «• » en `.doc-name` (y `data-sucio`) y en `document.title`; guardar (`#btn-save`) o
abrir un documento lo dejan limpio. `beforeunload` hace `preventDefault()` SOLO si está sucio. Abrir un fichero o imagen,
o «Nuevo», con cambios pide `window.confirm` y, si se cancela, no toca nada.

**Cómo se detecta ahora.** `tests/e2e/next/cambios-sin-guardar.spec.ts` (limpio al abrir, sucio tras ejecutar y tras
deshacer, limpio al guardar, `beforeunload` solo cuando está sucio —con diálogo real—, confirmación de Nuevo/abrir y
silencio con el documento limpio). Fallaban antes. Sin regla guard: es estado de interfaz, no un patrón estático.

---

### E-075 · Con un diálogo modal abierto, los atajos globales actuaban sobre el documento de detrás (N4)

**Síntoma.** Con Ayuda, Texto…, Comprimir, firma o Encabezado abiertos y el foco en un botón del diálogo, `n`/`t`/`r`
cambiaban la herramienta, `End` saltaba de página, Ctrl+Z/Ctrl+Y deshacían y rehacían el documento sin que se viera y `?`
apilaba la ayuda encima de otro diálogo.

**Causa raíz.** El manejador global de `keydown` solo conocía una regla de exclusión, «el foco está en un campo
editable». Un diálogo modal con el foco en un botón no es un campo editable, y los diálogos declaran `aria-modal` pero
nada en la app lo respetaba al resolver atajos.

**Arreglo.** `EventoAtajo.modalAbierto` (`resolverAtajo` y `resolverAtajoContextual` devuelven `null`) y
`hayModalAbierto()` (`<dialog open>`); `App` sale del manejador global y del de Nota/Rectángulo cuando hay modal. Escape
lo gestiona el propio `<dialog>`.

**Cómo se detecta ahora.** `tests/unit/atajos.test.ts` (regla pura) y `tests/e2e/next/atajos-con-modal.spec.ts` (Ayuda
abierta: Ctrl+Z, n, r, End, Ctrl+Y no tocan el documento ni `#status`; al cerrar, Ctrl+Z vuelve a funcionar). Fallaban
antes. Sin regla guard: es una regla de comportamiento de teclado.

---

### E-076 · En modo Nota o Insertar texto, un clic sobre una línea la editaba en vez de colocar (N7)

**Síntoma.** Con «Nota» activa, un clic en el centro de una línea de texto dejaba el estado en «Modo nota…», ponía la línea en
edición y no creaba ninguna nota. Igual con «Insertar texto». Con un clic en un hueco sí colocaba.

**Causa raíz.** En esos modos `.tool-layer` tiene `pointer-events: none` (el clic debe llegar al fondo de la página) pero los
`.run` capturan el clic: su manejador llama a `stopPropagation()` y empieza a editar, y el manejador del fondo ignoraba además
cualquier clic cuyo objetivo fuera un `.run`. Ninguno de los dos conocía la herramienta activa.

**Arreglo.** `TextLayer` recibe `colocando()` (el visor devuelve `tool !== 'none'`): con una herramienta activa el clic de la
línea no edita ni detiene la propagación, y el manejador del fondo del `Viewer` solo ignora los `.run` cuando no hay
herramienta. Sin herramienta, un clic sigue editando.

**Cómo se detecta ahora.** `tests/e2e/next/colocar-sobre-texto.spec.ts` (Nota e Insertar sobre una línea colocan y no editan;
sin herramienta se edita). Fallaban antes. Sin regla guard: es comportamiento de interacción.

---

### E-077 · En móvil, Rectángulo, Pluma y mover imagen no funcionaban con el dedo: el navegador se quedaba el gesto (N2)

**Síntoma.** A 390 px con pantalla táctil, arrastrar con el dedo con Rectángulo o Pluma activos no dibujaba nada («No hay
nada que deshacer») y arrastrar una firma/imagen desplazaba el visor en vez de moverla. El registro de eventos mostraba
`pointerdown`, un `pointermove` y `pointercancel`. Con ratón todo funcionaba.

**Causa raíz.** Ni `.tool-layer`, ni `.image-box`, ni el tirador de mover texto declaraban `touch-action: none`, así que el
navegador interpretaba el arrastre como scroll y cancelaba el puntero (el gesto termina en `pointercancel`, E-034). Los tests
móviles solo hacían toques, nunca arrastres.

**Arreglo.** `touch-action: none` SOLO donde el dedo debe dibujar o arrastrar, para no romper el scroll normal: `.tool-layer`
mientras la herramienta es pluma/rectángulo/borrador (`Viewer.setTool` y al crear la capa), `.image-box.selected` (estilos) y
el tirador de mover texto. Sin herramienta o con la imagen sin seleccionar el dedo sigue haciendo scroll.

**Cómo se detecta ahora.** `tests/e2e/next/tactil.spec.ts` (390x844, `hasTouch`, toques reales por CDP que sí respetan
`touch-action`): rectángulo con el dedo crea el `DrawRectCmd` y se deshace; con «ninguna» el dedo hace scroll; imagen
seleccionada se mueve sin desplazar el visor. Fallaban antes. Sin regla guard: depende de la interacción táctil real.

---

### E-078 · La página se pintaba a 1 px de bitmap por px CSS: borrosa en pantallas de alta densidad (N3)

**Síntoma.** A 390 px con DPR 2 (móviles, retina) `canvas.width` de la página era igual al ancho CSS (ratio 1,00): el texto
del PDF salía borroso. Solo las miniaturas multiplicaban por `devicePixelRatio`.

**Causa raíz.** `Viewer.renderPage` pedía el bitmap al motor a la escala CSS (`this.scale`) y dejaba que los atributos
`width`/`height` del canvas fijaran también su tamaño CSS: bitmap y CSS eran la misma cosa.

**Arreglo.** `src/ui/nitidez.ts` (`factorNitidez`): el bitmap se pinta a `escala × factor`, con `factor` = DPR acotado a 2,5 y
reducido si la página superara 8 Mpx (32 MB RGBA; con el tope de 12 páginas pintadas de E-045 el peor caso queda en ~384 MB),
nunca por debajo de 1. El canvas fija su tamaño CSS por separado (`style.width/height` = la página a la escala actual), así que
las capas superpuestas (texto, notas, imágenes, formularios) no cambian de geometría. `Viewer.repintarSiCambioDpr()` repinta
las páginas vivas cuando cambia el DPR; `App` lo llama desde `matchMedia('(resolution: …dppx)')` y desde `resize` (el zoom del
navegador dispara ambos; la emulación por CDP solo `resize`).

**Cómo se detecta ahora.** `tests/unit/nitidez.test.ts` (factor, topes, DPR no válido) y
`tests/e2e/next/nitidez-pagina.spec.ts` (DPR 2: bitmap ≈ ancho CSS × 2 con el CSS intacto; cambio de DPR en caliente repinta;
DPR 1 sigue 1:1; DPR 3 acotado y con límite de píxeles a zoom alto; la prueba de oro de reposo, E-029, con DPR 1 y 2).
Fallaban antes. Sin regla guard: es cálculo de maquetación, no un patrón estático.

---

### E-079 · En subconjuntos CID, el texto con un carácter ausente se guardaba como `.notdef` y se perdía (N1)

**Síntoma.** En un PDF de Chrome, Skia o LibreOffice (fuentes incrustadas como subconjunto CID), editar una línea tecleando un
carácter que el subconjunto no trae (`€`, `Q`, `Z`…) «funcionaba»: `editTextRun` devolvía `ok`, el PDF guardado dibujaba cuadros
`.notdef` y al extraer el texto esos caracteres habían desaparecido (`HOLA MUNDO €` → `HOLA MUNDO `, `HOLZ` → `HOL`). Pérdida de
datos silenciosa: el texto escrito no estaba en el documento y la sustitución de fuente (E-047) nunca entraba.

**Causa raíz.** `editTextRun` y `swapTextObject` preguntaban `FPDFFont_GetGlyphPath(fuente, carácter)` antes de escribir. En un
subconjunto CID esa función da falsos positivos: PDFium convierte un Unicode sin entrada en `/ToUnicode` en un código que
Identity-H lleva a un GID cualquiera, así que dice «sí» a glifos que no están. El fixture que cubría E-047 (`subconjunto.pdf`,
ZapfDingbats estándar) no es un subconjunto CID y no lo detectaba.

**Arreglo.** La cobertura ya no se consulta: se **escribe y se relee** (`textoEscritoCoincide`: `FPDFText_LoadPage` sobre la MISMA
página tras `SetText` y comparación con lo pedido, sin los caracteres generados). Si no coincide se devuelve `glyph-missing` sin
llamar a `FPDFPage_GenerateContent` y se cierra la página: el cambio se descarta solo, porque cada llamada del motor reparsea la
página desde el content stream. `editTextRun` y `swapTextObject` (sustitución E-047, `setRunFont`, `setRunFontSize`) usan esa vía.

**Cómo se detecta ahora.** Fixture determinista `cid-subconjunto.pdf` (TrueType sintética incrustada como Type0/CIDFontType2 con 10
glifos, generada a mano en `generar-fixtures.mjs`) y `tests/unit/PdfiumEngine.cobertura.test.ts`: con un carácter ausente
`editTextRun` devuelve `glyph-missing` y el texto no cambia ni en memoria ni tras guardar; con la sustitución de fuente el texto
nuevo se extrae tras guardar y reabrir. Fallaban antes. Regla `no-glyphpath-como-cobertura`: prohíbe `FPDFFont_GetGlyphPath` en
`src/` (código, no comentarios).

---

### E-080 · El editor y el panel de propiedades mostraban el texto un 33 % más grande en PDFs con CTM escalada (N1)

**Síntoma.** En un PDF de Chrome la línea de 11 pt se editaba a 14,66 px × escala y el panel de propiedades mostraba «14.5»; el
cuadro de edición salía un 33 % mayor que el texto pintado. Pedir «11» en el panel dejaba el texto a 8,25 pt.

**Causa raíz.** `TextRun.sizePt` era el `Tf` NOMINAL del objeto, pero Chrome escribe `0.75 0 0 -0.75 0 H cm`: la matriz del objeto
escala 0,75 y el tamaño real es `Tf × hypot(a, b)`. Todos los consumidores usaban el nominal como si fuera lo que se ve.

**Arreglo.** `TextRun` expone `sizeEfectivoPt` (`Tf × hypot(a, b)`, lo que ve el usuario) y conserva `sizePt` (nominal, lo que hay
que pasar a `NewTextObj`/`CreateTextObj`). `TextLayer` (`cssFontFor`, línea base E-030), el panel de propiedades, los cuadros de
marcado y `estructura.ts` (encabezados) usan el efectivo; `setRunFontSize` recibe el efectivo y lo convierte (`Tf = pedido /
escala`, porque la matriz se copia); `replaceRunWithStandardFont` y `setRunFont` siguen con el nominal porque copian la matriz.

**Cómo se detecta ahora.** `tests/unit/PdfiumEngine.size.test.ts` sobre `por-glifo.pdf` (Chrome simulado: 14,66 nominal → 11 pt
efectivos; pedir 22 deja 22 pt efectivos y la matriz intacta; la sustitución de fuente conserva el efectivo) y sobre `nativo.pdf`
(matriz identidad: efectivo = nominal). Fallaban antes. Sin regla guard: depende de la matriz de cada documento.

---

### E-081 · `FPDFText_SetText` con la cadena vacía mata el WASM del motor (N1)

**Síntoma.** Vaciar una línea y confirmar, o insertar un texto vacío, provocaba `RuntimeError: unreachable`: el motor entero
quedaba inservible (todas las páginas abiertas dejaban de responder) hasta recargar la pestaña.

**Causa raíz.** PDFium aborta con `SetText("")`; ningún sitio del motor lo impedía (`editTextRun` pasaba el texto tal cual).

**Arreglo.** Única vía de escritura `PdfiumEngine.escribirTexto`, que lanza un error recuperable con cadena vacía. `editTextRun`
devuelve `{ ok: false, reason: 'empty-text' }` sin tocar el documento (la UI repone el texto y avisa); `insertText` con texto vacío
lanza antes de crear el objeto. Quitar una línea es eliminar el objeto (`deleteRun`), nunca dejarla vacía.

**Cómo se detecta ahora.** `tests/unit/PdfiumEngine.settextvacio.test.ts` (tras `editTextRun('')` el motor sigue vivo y editando;
`insertText('')` lanza; `deleteRun` sí borra). Regla `settext-solo-via-escribirtexto`: `FPDFText_SetText` solo puede aparecer dentro
de `escribirTexto` (comentarios aparte), con su test en `reglas.test.mjs`.

---

### E-082 · Los PDFs «por glifo» (Chrome, Skia) no se podían editar sin romper el documento (N1)

**Síntoma.** En un PDF generado por Chrome, la capa de texto ofrecía un cuadro de edición por GLIFO (781 en una página): un clic
editaba una letra, y reescribirla desplazaba o rompía el resto de la línea. Un arreglo ingenuo (reescribir la línea como un objeto
nuevo) perdía negrita, color y recorte, repintaba la línea entera con otro espaciado y dejaba caracteres como `.notdef`.

**Causa raíz.** Chrome escribe un `Tj` por glifo y PDFium crea un objeto de texto por `Tj`; el editor equiparaba «objeto de texto»
con «línea que ve el usuario». Además, deshacer con `FPDFPageObj_SetIsActive(false)` no sirve como borrado reversible: los objetos
inactivos no se escriben en `GenerateContent` y la siguiente `FPDF_LoadPage` ya no los tiene.

**Arreglo.** Modelo de «línea editable» (`src/texto/lineasEditables.ts`, F1) y edición por diff mínimo (`engine.editLine`, F2): el
prefijo común no se toca, el tramo cambiado se escribe en sitio sobre su primer objeto (verificado al releer, E-079), los objetos
sobrantes se eliminan (nunca `SetText("")`, E-081) y el sufijo se traslada Δ = diferencia de avance, en pt del espacio de usuario
con la matriz aplicada, sobre el eje del texto; todo en una sola carga de página (E-037). Si falta un glifo, solo el tramo cambiado
pasa a la fuente estándar (E-047). `EditarLineaCmd` deshace por snapshot. La `TextLayer` pinta UNA `.run` por línea con la caja de la
línea entera, el tamaño efectivo (E-080) y la línea base del primer objeto (E-030); mover y borrar actúan sobre todos sus objetos.
Una línea de un solo objeto sigue exactamente por `editTextRun`. Relacionado: el espacio final o doble que teclea el usuario ya no
se confunde con un glifo ausente (PDFium lo recorta al releer).

**Cómo se detecta ahora.** `tests/unit/PdfiumEngine.editLine.test.ts` (0 px distintos fuera de la franja de la línea y en el
prefijo, sufijo trasladado Δ, columna adyacente intacta, multiestilo, borrado e inserción, girada, glifo ausente, una sola carga de
página), `tests/unit/EditarLinea.test.ts` (deshacer devuelve los bytes renderizados idénticos) y `tests/e2e/next/editar-linea-n1.spec.ts`
(Chromium real sobre `por-glifo.pdf`). Regla `no-setisactive-como-borrado`.

**Límites conocidos.** (F4, ver E-083: resueltos el editor con tramos de estilo, el panel de propiedades, Reemplazar por línea y el
traslado de marcados; el hueco falso en texto girado no se reproduce.) Queda: en una línea justificada solo el tramo editado pasa a
espaciado natural.

### E-083 · Reemplazar y el panel de propiedades seguían trabajando por objeto en los PDFs «por glifo» (N1 F4)

**Síntoma.** Tras E-082 la línea ya se editaba entera, pero «Buscar y reemplazar» no encontraba casi nada en un PDF de Chrome (una
palabra no cabe en un objeto de un carácter), el panel de fuente/tamaño/color estaba desactivado en esas líneas y un resaltado sobre
una palabra del final de la línea se quedaba donde estaba al editar el principio (apuntaba a un hueco).

**Causa raíz.** Tres piezas más equiparaban «objeto de texto» con «línea»: `buscarEnRuns` + `ReemplazarTextoCmd` (`editTextRun` por
objeto), el panel (`SetRunFont*`/`SetColor` actúan sobre un objeto) y el traslado del sufijo, que solo movía objetos de página y no
las anotaciones de marcado ancladas a ellos. Además, mantener cada glifo en su posición original al cambiar de fuente rompe la
lectura del texto: PDFium parte las palabras en cuanto un glifo nuevo es más ancho que el original («m ixto»).

**Arreglo.** (1) `buscarEnRuns` recibe líneas editables y `CambioTexto.linea` hace que `ReemplazarTextoCmd` escriba con
`engine.editLine` (relocaliza la línea por su texto si los índices se desplazaron; deshacer por snapshot si hubo varios objetos).
(2) `trasladarMarcadosSobre`: en `editLine`, los marcados (resaltado, subrayado, tachado) cuyo quad cae en la caja del sufijo y no
empieza más de 1,5 em antes del final viejo del tramo editado se trasladan el mismo Δ (pt de usuario, sobre el eje del texto: la
rotación de página no interviene porque todo está en espacio de usuario, E-053) y se regenera su `/AP`; un marcado que abarca
también lo editado, los de otras líneas, las notas y los enlaces no se tocan. (3) `TextLayer.pintarTramos`: el editor pinta un
`<span class="run-estilo">` por tramo de estilo (`createElement` + `textContent`, §2.2). (4) `engine.setLineProps` + `PropiedadesLineaCmd`:
color (todos los objetos), tamaño (factor sobre el origen del primer objeto: conserva espaciado y proporciones) y fuente estándar
(los objetos se agrupan por estilo contiguo y se reescriben a continuación unos de otros con el avance natural de la fuente nueva);
una carga de página, un `GenerateContent`, deshacer por snapshot. (5) El hueco falso en texto girado que temía F2/F3 no se
reproduce (≈200 ediciones en la línea girada 90° y en la página con `/Rotate 90`); queda un test de barrido.

**Cómo se detecta ahora.** `tests/unit/ReemplazarLineas.test.ts`, `tests/e2e/next/reemplazar-lineas-n1.spec.ts`,
`tests/unit/PdfiumEngine.editLine.test.ts` (marcados del sufijo, barrido en texto girado), `tests/e2e/next/marcado-sufijo-n1.spec.ts`,
`tests/e2e/next/editar-estilos-n1.spec.ts`, `tests/unit/PdfiumEngine.setLineProps.test.ts`, `tests/unit/PropiedadesLinea.test.ts` y
`tests/e2e/next/propiedades-linea-n1.spec.ts`. Regla `busqueda-por-linea-editable`.

**Límites conocidos.** (a) Justificado: el tramo editado pasa a espaciado natural (como Acrobat al reescribir) y un cambio de fuente
lo hace en toda la línea; no se aproxima la justificación porque rompería la prueba de píxeles fuera de la línea. (b) Cambiar la
fuente de una línea de varios estilos conserva el color de cada tramo pero no la negrita/cursiva (todo pasa a la fuente elegida).
(c) Un marcado ajeno que cubra el sufijo se traslada igual que uno propio: el PDF no distingue quién lo creó (el editor no escribe
`/T`). (d) Un marcado que abarca a la vez lo editado y el sufijo no se estira ni se mueve. (e) Sin tratar aún: RTL, ligaduras,
Type3 y `Tc`.

### E-084 · Con una CropBox/MediaBox de origen distinto de (0,0) la capa de texto, la inserción y las notas quedaban desplazadas

**Síntoma.** Abrir un PDF de Acrobat Distiller (plantillas con CropBox `x=4,02 y=6`, o `x=187,8 y=28,3` con `/Rotate -90`): las
cajas `.run` caían unos 13 px fuera del texto visible, un clic sobre el texto no entraba en edición (`elementFromPoint` daba la capa
de texto) y, con `/Rotate`, las cajas salían en cualquier sitio. Insertar texto, notas, imágenes o un resaltado también caían
desplazados; guardar y reabrir los dejaba donde se pintaron mal.

**Causa raíz.** Tres sistemas de coordenadas (AGENTS.md §1) y un origen olvidado. Las coordenadas del motor (`FPDFText_GetCharBox`,
`FPDFPageObj_GetBounds`, la matriz) están en el espacio de usuario del PDF; el render de PDFium y `FPDF_GetPageWidthF/HeightF` hablan
de la caja VISIBLE (CropBox recortada a la MediaBox), cuya esquina inferior-izquierda puede estar en `(x0, y0) ≠ (0, 0)`.
`PageGeometry` suponía origen (0,0): convertía `y_css = (alto − yPt)·escala` sin restar `y0`. Con origen 0 (casi todos los PDF y todos
los fixtures) cuadra, por eso nadie lo vio. Además, varios consumidores convertían por su cuenta: la imagen insertada se centraba
con `(anchoPagina − w) / 2` en pt de usuario, la firma acotaba a `[0, tamaño]`, el OCR hacía `alto − y/escala` y el encabezado/marca
de agua pasaba el tamaño visual sin origen.

**Arreglo.** `engine.pageBox(doc, i): { origenPt, tamanoPt, rotacion }` (CropBox ∩ MediaBox, o MediaBox; pt de usuario sin girar).
`PageModel.origenPt` lo guarda `EditSession`. `PageGeometry` recibe el origen y lo resta en `ptToCss`, lo suma en `cssToPt`
(`sinGirar()` lo conserva). Desde `src/` se entra solo por `PageGeometry.desdePagina(pagina, escala)`. Corregidos los consumidores
que convertían a mano: `handleInsertImage` (centro por `cssToPt`), `colocarFirmaSeleccionada` (acota a `[origen, origen + tamaño]`),
`mapOcrLines`/`OcrPage` (origen de la caja), encabezado/pie y marca de agua (`PaginaVisual.origenPt`). Texto, notas, formularios, quads
de marcado, selección de texto, búsqueda (E-067), `centroVisiblePt` (E-070) e `ImageLayer` ya pasaban por la geometría y quedan
corregidos con ella.

**Cómo se detecta ahora.** `tests/e2e/next/cropbox-origen.spec.ts` (fixture `cropbox-desplazado.pdf`: CropBox `[36 36 436 336]`,
MediaBox de origen negativo y CropBox con `/Rotate 90`; la `.run` cae sobre los píxeles, un clic edita la línea correcta y al guardar
queda en su sitio, insertar texto, nota, imagen y resaltado caen donde se hace clic), `tests/unit/PageGeometry.test.ts`,
`tests/unit/PdfiumEngine.pageBox.test.ts` y `tests/unit/mapOcrLines.test.ts`. Regla `pagegeometry-con-origen`: prohíbe en `src/`
`desdeTamanoVisual(` sin origen y `.pageSize(` fuera del motor y de `EditSession`.

**Límites conocidos.** `UserUnit` (escala de página) sigue sin tratarse. El OCR sobre una página con `/Rotate` ≠ 0 sigue ignorando la
rotación (anterior a E-084).

### E-085 · En líneas justificadas (InDesign, Word 365) la agrupación partía la línea a mitad de palabra y editar una mitad alteraba la otra

**Síntoma.** En un PDF de InDesign o de Word 365 la línea «…and cooperates with Client…» salía como dos líneas editables
(«coop» y «erates with…»). Reemplazar «Client» en la primera mitad la acortaba, la segunda no se movía y «cooperates» quedaba como
«coop erates»: una palabra que el usuario NO tocó cambiaba (AGENTS.md §2.3). Lo mismo con «disass|embly», «wor|kers»,
«appro|ach»; Reemplazar decía «coincidencia no reemplazada porque abarca varias líneas».

**Causa raíz.** `lineasEditables.ts` medía el hueco entre objetos contra el avance NATURAL de los glifos (`u + avancePt`), que
ignora `Tw` (espaciado entre palabras), `Tc` y los desplazamientos de `TJ`: justamente lo que hace la justificación. Con `Tw` la
caja real es más ancha que el avance natural (salto +0,68 em > `SALTO_MAX_EM`); con `TJ` apretado es más estrecha (−0,71 em <
`SALTO_MIN_EM`). Además, `editLine` trasladaba el sufijo el Δ de avances naturales, así que aun con la línea entera un objeto con
`Tw`/`TJ` dejaba el sufijo con un hueco (o solapado) respecto a lo reescrito.

**Arreglo.** (1) `medir()` toma los extremos `uIni`/`uFin` de la CAJA del objeto (`FPDFPageObj_GetBounds`, incluye `Tw`, `Tc` y `TJ`),
proyectada sobre el eje del texto y corregida con el margen lateral típico de un glifo (`BEARING_EM`, porque la caja es la de la
tinta); con ángulo oblicuo o sin caja cae al avance natural. El hueco, la fusión de segmentos y el orden visual usan esos extremos.
(2) `editarLineaCompuesta`: si el último objeto del tramo editado lleva desplazamientos (su caja acaba a más de 0,15 em del avance
natural), Δ se mide con la caja del objeto viejo y del reescrito, de modo que el sufijo mantiene el hueco que tenía con la palabra
vecina. Medido sobre el corpus real (29 PDF): las palabras partidas por la agrupación pasan de 71 a 0 en el corpus (antes en
InDesign, Word y pdfTeX); las líneas de Chrome/Skia no cambian.

**Cómo se detecta ahora.** Fixture `justificado-tw.pdf` (dos líneas, «cooperativa» partida en dos objetos con `Tw` de 9 pt y con `TJ`
de +250) y `tests/unit/JustificadoTw.test.ts` (una línea, no dos; reemplazar en la primera mitad deja «cooperativa» entera y el
mismo hueco; guardar y reabrir), `tests/e2e/next/justificado-y-espacio-tex.spec.ts` (Chromium). Regla
`agrupacion-sin-avance-natural`: prohíbe `avancePt` en `lineasEditables.ts` salvo como respaldo de `extremosReales()`.

**Límites conocidos.** En una línea justificada el tramo editado sigue pasando a espaciado natural (E-083). La caja es la de la
tinta: el margen `BEARING_EM` (0,05 em por lado) es una estimación, no el avance exacto. Con texto oblicuo (no múltiplo de 90°) se
usa el avance natural, con su defecto. En RTL (árabe) las líneas ahora se unen en una sola (antes salían en tres piezas
desordenadas), pero el orden visual de las letras no se trata (F6 sigue abierto).

### E-086 · En LaTeX (pdfTeX) editar una línea con espacios pasaba TODA la línea a Helvetica

**Síntoma.** En un PDF de pdfTeX (NimbusRomNo9L, Type 1 subconjunto), cambiar «Zakai» por «iakaZ» en «Alon Zakai» y pulsar Enter dejaba
«La fuente original no tiene algún carácter; la línea usa Helvetica.» y la línea pasaba de Times a Helvetica; una línea sin espacio
(«Mozilla») se editaba bien. Además el motor extraía «AlonZakai» mientras el editor mostraba «Alon Zakai».

**Causa raíz.** TeX no escribe el espacio como glifo: separa las palabras con desplazamientos de `TJ` (`[(Alon)-333(Zakai)] TJ`) y el
subconjunto no trae glifo de espacio. Al teclear un espacio, `FPDFText_SetText` lo escribe como un código inexistente (PDFium lo
lee de vuelta como `ÿ`), así que la verificación de E-079 (releer lo escrito) lo tomaba por glifo ausente y la edición caía al camino
de la fuente estándar (E-047) para toda la línea. Y `textoReal` descartaba los espacios que PDFium genera DENTRO de un objeto (los
huecos de `TJ`), que en TeX son las separaciones de palabras reales.

**Arreglo.** (1) `textoRealPorObjeto`/`textoRealDeObjeto` incluyen el espacio generado entre dos caracteres del MISMO objeto: la
línea extrae «Alon Zakai». (2) Si la escritura falla, el texto tiene espacios y la fuente no tiene glifo de espacio
(`fuenteSinEspacio`: ancho 0), `editLine` escribe PALABRA A PALABRA (`escribirPorPalabras`): la primera en sitio sobre el objeto
original y cada una de las siguientes en un objeto nuevo con la MISMA fuente (`CreateTextObj` con el handle prestado), color, modo
de render y matriz, desplazado por el avance natural de las anteriores más el ancho del espacio, medido de la propia línea
(`medirEspacioPt`: hueco entre objetos vecinos y caja menos avance en objetos con `TJ`; sin muestras, 0,25 em como TeX). Cada
palabra se relee (E-079). Un glifo VISIBLE ausente sigue siendo `glyph-missing` y entra la fuente estándar (E-047). Las líneas de un
objeto con espacios tecleados pasan al camino compuesto (`EditarLineaCmd`, deshacer por snapshot); `editLine` devuelve
`objetosAnadidos` y `ReemplazarTextoCmd` deshace por snapshot en ese caso.

**Cómo se detecta ahora.** Fixture `sin-espacio-tex.pdf` (Type 1 incrustado escrito a mano, sin glifo de espacio, `/Widths` desde `A`,
`Differences`, líneas con `TJ`: reproduce el `ÿ`), `tests/unit/EspacioTex.test.ts` (fuente original conservada en la línea editada y
tras guardar y reabrir, palabras separadas por espacio, sin `.notdef`, espacio de ≈ 8 pt, 0 px distintos fuera de la franja, glifo
visible ausente → Helvetica) y `tests/e2e/next/justificado-y-espacio-tex.spec.ts` (Chromium: estado «Editado.», fuente conservada,
deshacer).

**Límites conocidos.** La línea editada pasa a espaciado natural más un hueco medio entre palabras (la justificación original de TeX
se pierde, como en E-083). Las palabras nuevas no heredan el recorte (`clip`) del objeto original. Cambiar tamaño o fuente
(`setRunFontSize`, `setLineProps`) de una línea de TeX con espacios sigue sin tratarse: con la fuente sin espacio devuelve
`glyph-missing` en vez de perder los espacios.

### E-087 · Guardar, Imprimir y Deshacer seguían activos durante una operación larga (Reemplazar todo en un documento grande)

**Síntoma.** En un documento de 1256 páginas, con «Reemplazando… 260/810» en curso, Guardar seguía habilitado y descargaba un PDF mezcla
(1108 «oracle» y 1022 «elcaro»); la operación terminaba después sin aviso. Lo mismo era posible con comprimir, OCR, filtros,
encabezado y marca de agua y Texto…/Markdown (todas ceden el hilo), y con Deshacer/Rehacer o ediciones a mitad de operación.

**Causa raíz.** Cada operación larga solo deshabilitaba su propio botón; no existía el concepto de «operación en curso» del documento, así
que cualquier otra acción (que lee o muta el mismo documento) podía intercalarse en los cedidos de hilo.

**Arreglo.** Candado único en `App.conOperacion` + `CommandBus.bloquear`: una sola operación larga a la vez. Mientras dura, el bus
descarta `execute`/`undo`/`redo` ajenos (la operación dueña pasa `propia = true`), Guardar, Imprimir, Deshacer, Rehacer, las ediciones,
inserciones, borrados, rotar/duplicar/eliminar/reordenar páginas y abrir/nuevo avisan en `#status` y en el `title` del botón
(«Espera a que termine «X»…», con «o cancélalo» si se puede cancelar) y los botones quedan en `aria-disabled`. Navegación y zoom no se
tocan. Se libera siempre en `finally` (terminar, cancelar o fallar).

**Cómo se detecta ahora.** `tests/e2e/next/candado-operacion.spec.ts` (grande.pdf: botones `aria-disabled`, Ctrl+S sin descarga,
zoom libre, y tras terminar Guardar descarga el resultado completo) y `tests/unit/CandadoOperacion.test.ts`.

**Límite.** La búsqueda sigue siendo libre durante una operación (solo lee y se invalida sola, y «Reemplazar» la repite al terminar).

### E-088 · Al editar una palabra seguida de una ligadura (fi, ffi de Calibri/Chrome) la palabra de al lado salía deformada

**Síntoma.** En un PDF de Chrome con Calibri («Una oficina eficiente: official fine find…») cambiar «fine» por «enif» dejaba «enif ƒind»:
la «fi» de «find», que el usuario no había tocado, pasaba a la fuente de reserva con la «f» y la «i» sueltas (el subconjunto no tiene una
«f» suelta), y el sufijo se movía con un avance equivocado (la ligadura mide 5,4 pt de caja y 8,8 pt de avance natural por caracteres).

**Causa raíz.** Un objeto de texto que acaba en espacio («ne ») pierde ese espacio al releerlo (PDFium lo recorta), así que `editarLineaCompuesta`
alargaba el tramo escrito con el objeto SIGUIENTE. En Chrome el siguiente objeto es el comienzo de la palabra de al lado, y con Calibri es
una ligadura («fi»): se reescribía fuera de su fuente y el final «viejo» se medía con su avance natural (que sobrestima una ligadura).
El solape de glifos del informe (F5) lo corrigió ya E-085 (final real medido con la caja); quedaba esta arrastrada.

**Arreglo.** El espacio final del tramo escrito ya no se escribe ni arrastra al objeto siguiente: se escribe sin él y su avance natural se suma
al final nuevo (`espacioFinal`), de modo que el sufijo conserva su hueco y los objetos vecinos no se tocan.

**Cómo se detecta ahora.** Fixture `ligaduras.pdf` (TrueType sintética CID con «fi» como UN glifo de ToUnicode «fi», avance 15,84 pt por
caracteres y caja 7,92 pt) y `tests/unit/Ligaduras.test.ts`: las ligaduras vecinas siguen siendo un objeto «fi» con la misma caja, sin
solapes y con el hueco conservado.

**Límite.** Una palabra con «f» o «i» que el subconjunto no trae sueltas (ligadura sin glifos separados) sigue usando la fuente de reserva
con aviso (E-047) solo en el tramo editado.

### E-089 · El OCR ignoraba `/Rotate`: el texto invisible quedaba mal colocado o girado en una página girada

**Síntoma.** Con OCR en una página con `/Rotate` 90, 180 o 270 (un escaneo girado es lo normal), el texto reconocido se insertaba lejos de
las palabras: seleccionar o buscar caía en otro sitio de la página (E-084 solo había corregido el origen de la caja visible).

**Causa raíz.** `OcrPageCmd` reconoce sobre el render YA girado (px del bitmap visual, origen arriba-izquierda), pero `mapOcrLines` los pasaba
a pt con la fórmula de una página sin girar (`y = alto − y1/escala`) y sin giro del texto. Con 90/270 además el alto de usuario es el ancho visual.

**Arreglo.** `mapOcrLines(lines, scale, pagina)` recibe la página visual (`anchoVisualPt`, `altoVisualPt`, `rotacion`, `origenPt`) y usa la
geometría común (`PageGeometry.desdeTamanoVisual` a escala 1, E-053/E-084) para pasar la esquina inferior-izquierda de cada caja al espacio de
usuario; el texto se inserta con `giroGrados = rotacion` para quedar horizontal en la página girada. `OcrPageCmd` da el tamaño visual
intercambiando ancho y alto de `pageBox` con 90/270.

**Cómo se detecta ahora.** `tests/unit/OcrRotada.test.ts`: proveedor OCR falso con cajas conocidas sobre páginas `/Rotate` 0/90/180/270,
con y sin CropBox desplazada; `findText` + `PageGeometry.rectPtToCss` deben caer sobre cada caja (izquierda ±2 pt, dentro de su franja
vertical, horizontal).

### E-090 · Deshacer una edición de texto no devolvía la página idéntica en PDF con límite de inglete o planitud

**Síntoma.** En un PDF cuyo content stream lleva estado gráfico `M` (límite de inglete) o `i` (planitud), p. ej. el sello de
`acrobat-enu-template2.pdf` (`1.5 i … 4 M`), editar una línea y deshacer dejaba la página distinta de la original: 39 px cambiados (máx.
64/765 por canal) en las esquinas agudas de los trazos, lejos del texto editado. «Guardar sin editar» es exacto (0 px en 29/29 PDF).

**Causa raíz.** `FPDFPage_GenerateContent` de PDFium regenera el content stream de la página pero NO escribe `M` ni `i`: el límite de
inglete vuelve al valor por defecto (10) y las esquinas agudas pasan de bisel a punta. Deshacer re-editaba en sitio (`editTextRun` con el
texto viejo, o la operación inversa en color/mover), que vuelve a regenerar la página: nunca restauraba los bytes originales.

**Arreglo.** Deshacer por SNAPSHOT (`c.reload(before)`, con `before` = bytes antes de ejecutar) en `EditTextRunCmd`, `ReemplazarTextoCmd`
(siempre, no solo con sustitución de fuente), `SetColorCmd` y `MoveRunCmd`; el resto de comandos de texto (`EditarLineaCmd`,
`PropiedadesLineaCmd`, `SetRunFont`, `SetRunFontSize`, `ReplaceRunFont`, `DeleteRun`) ya lo hacían. La UI toma el snapshot antes de
`editTextRun` y lo pasa a `EditTextRunCmd`; la coalescencia conserva el del PRIMER comando. La recarga sigue siendo perezosa (E-043/E-044):
medido en `grande.pdf` (500 páginas), deshacer una edición tarda ~340 ms hasta ver el texto (139 ms re-editando en sitio) con
`getPageText` +2 y `renderPage` +7, nunca las 500 páginas.

**Cómo se detecta ahora.** Fixture `inglete.pdf` (texto + trazo de ~20° con `4 M` y `1.5 i` escritos a mano),
`tests/unit/Inglete.test.ts` (editar, color y mover → deshacer = 0 px y mismos bytes; coalescencia; camino `pushExecuted` de la UI) y
`tests/e2e/next/deshacer-snapshot.spec.ts` (canvas idéntico tras Ctrl+Z en Chromium; coste acotado en `grande.pdf`).

**Límite (sin API en PDFium).** Tras EDITAR (sin deshacer) una página con estos operadores, sus esquinas agudas cambian sutilmente al
regenerarse el contenido (medido: 39 px, máx. 64/765). PDFium ni `@embedpdf/pdfium` exponen el límite de inglete ni la planitud, y no hay
forma de regenerar la página sin `GenerateContent`. Lo documenta el test «E-090 limitación conocida» de `Inglete.test.ts`: si falla,
PDFium ya conserva `M`/`i` y hay que quitar esta limitación. Quedan fuera del arreglo (no son edición de texto): `SetObjectRectCmd`,
`InsertTextCmd` y similares, que deshacen con la operación inversa.

### E-091 · `busqueda-navegacion.spec.ts` medía la caja de la coincidencia con lecturas únicas · defecto del TEST, no de la app

**Síntoma.** En la verificación de E-090, una vez dentro de un lote de 342 tests, `busqueda-navegacion.spec.ts` falló; en aislado pasó
5/5. Sin mensaje conservado. Se trató como carrera de la app hasta demostrar lo contrario: 200 ejecuciones aisladas, 30 con la CPU
ralentizada x4 (x6 hunde el proceso del navegador con las 500 páginas, no son aserciones) y un lote completo de `next` = 0 fallos, y un
test determinista que retrasaba el evento de scroll (hilo principal bloqueado 400 ms tras pedir la coincidencia, de modo que el respaldo
de 150 ms de E-068 vence antes) tampoco movió el indicador de página. No hay evidencia de defecto en `goToPage`, el pin (E-068), el
centrado (E-067) ni el repintado tras desalojo (E-045).

**Causa raíz (del test).** El helper `actualDentroDelVisor` hacía `toHaveCount(1)` y luego leía `boundingBox()` una sola vez: ese
instante puede caer a medias del desplazamiento del salto o sobre una capa `.hl-layer` recién sustituida (E-045); lo mismo con la
lectura puntual del indicador de página y con el recuento de píxeles oscuros del canvas (que se pinta de forma perezosa). Mismo patrón
que E-039: medir una sola vez algo que se asienta con el tiempo.

**Arreglo.** Las comprobaciones esperan con `expect.poll` (caja dentro del visor, página destino, número actual, píxeles bajo la caja),
sin relajar lo que se comprueba y sin reintentos ni `waitForTimeout`. Se añade un test siempre activo con la CPU ralentizada x4
(`Emulation.setCPUThrottlingRate`) con el salto cercano, el lejano con desalojo y la vuelta.

**Cómo se detecta ahora.** `tests/e2e/next/busqueda-navegacion.spec.ts` (6 tests, uno con CPU x4).

---

### E-092 · Crear y editar una nota usaba el cuadro nativo del navegador (B4)

**Síntoma.** Al colocar una nota (clic o Enter, E-073) salía un `window.prompt`: una sola línea, sin estilo, que bloquea la
página, y el panel Comentarios editaba con otro editor distinto (un textarea en línea). No había forma de escribir una nota de
varias líneas ni de editarla con doble clic sobre su marcador.

**Causa raíz.** La nota nació como el camino más corto (`prompt`) y nunca se sustituyó cuando el resto de paneles pasaron a
`<dialog>` con `mostrarModal` (A-04/A-05): quedó fuera del contrato de diálogos y duplicada con el editor del panel.

**Arreglo.** `src/ui/NotaDialogo.ts` (`pedirTextoNota`) abre un `<dialog>` modal con un textarea «Texto de la nota», Guardar y
Cancelar. Ctrl/Cmd+Enter guarda, Escape cancela, el foco entra en el textarea y `mostrarModal` lo devuelve al disparador. Lo usan
crear (clic o Enter), el botón Editar del panel Comentarios (el editor en línea desaparece) y el doble clic sobre el marcador.
`normalizarTextoNota` (CRLF a LF, recorte) deja el texto con sus saltos de línea en `/Contents`; un texto en blanco o Cancelar no
crean nota. El panel muestra los saltos (`white-space: pre-line`) y el `title` del marcador también.

**Cómo se detecta ahora.** Regla `sin-prompt-nativo` (`scripts/guards/reglas.mjs`, test en `reglas.test.mjs`): ningún `.ts` de
`src/` llama a `prompt(`. `tests/e2e/next/nota-dialogo.spec.ts` (nota de 2 líneas solo con teclado que persiste tras guardar y
reabrir, Escape y Cancelar no crean nada, doble clic, panel con foco devuelto) y `tests/unit/notaTexto.test.ts`.

---

### E-093 · El texto de un marcado multilínea perdía el espacio entre líneas (B3)

**Síntoma.** Al recorrer anotaciones con Alt+↓ un resaltado de dos líneas se anunciaba «…ABCDEF» en lugar de «…ABC DEF»: las
palabras de fin y de inicio de línea se leían como una sola.

**Causa raíz.** `textoDeMarcado` salta los caracteres sin caja (los `\r\n` que PDFium mete entre líneas) y no ponía nada en su lugar;
en PDF sin esos saltos, tampoco detectaba el cambio de línea. El panel Comentarios muestra el `/Contents` de cada anotación, no el
texto marcado (un resaltado propio no lo trae: «(sin texto)»), así que el defecto afectaba al anuncio y a su extracto.

**Arreglo.** Se separa con un espacio cuando se saltó un blanco sin caja o cuando el salto vertical entre dos caracteres supera una
línea, y se normalizan los blancos (`\s+` a un espacio). Unidades: pt de usuario PDF.

**Cómo se detecta ahora.** `tests/unit/seleccionTeclado.test.ts` («B3: …», dos casos). Sin regla guard: es una función pura con test.
