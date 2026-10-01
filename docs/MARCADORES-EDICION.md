# Edición de marcadores (outline)

Panel "Marcadores" editable como el de Acrobat. Diseño y límites.

## API de PDFium usada

El build de `@embedpdf/pdfium` exporta `EPDFBookmark_*` (`AppendChild`, `InsertAfter`,
`Delete`, `SetDest`, `SetTitle`…) y `EPDFDest_CreateView`. `PdfiumEngine.setOutline(doc, items)`
(`src/engine/pdfium/PdfiumEngine.ts`) reescribe el árbol COMPLETO: valida con las cotas
de E-031, borra los marcadores raíz vigentes (`EPDFBookmark_Delete` arrastra hijos y
reengancha `/First /Last /Next /Prev /Count /Parent`) y reconstruye con `AppendChild`.
Cada destino es `[página /Fit]` (`EPDFDest_CreateView`, modo 2, 0 parámetros; los modos 0 y 1
devuelven 0 en este build). PDFium codifica el título (UTF-16BE con BOM).

## Cotas (E-031)

`src/engine/cotasOutline.ts`: `OUTLINE_MAX_DEPTH = 32`, `OUTLINE_MAX_NODES = 10000`,
compartidas por `getOutline`, `setOutline` y la UI. `setOutline` lanza `RangeError` antes
de tocar el documento si el árbol las supera; el borrado del outline previo también está
acotado (un outline hostil con ciclo A→B→A no cuelga). La UI no ofrece sangrar/crear si
el motor lo rechazaría.

## Deshacer

`SetOutlineCmd(antes, despues, etiqueta)`: el outline es pequeño, así que se guardan ambos
árboles enteros; deshacer = `setOutline(antes)`. Notifica a la UI con
`DocumentModel.onOutlineChange` (no reconstruye páginas ni miniaturas).

## Límite conocido

Un marcador cuyo destino no es una página del documento (acción URI, Launch, destino con
nombre sin resolver…) se lee como `pageIndex: null` y, al reescribir el árbol (cualquier
edición del outline), se escribe SIN destino: pierde esa acción. `OutlineItem` no la
transporta. Si importa, el siguiente paso es añadir al tipo un campo opaco de acción.

## UI y teclado

`src/ui/PanelMarcadores.ts` + funciones puras en `src/outline/arbol.ts`.
`role="tree"`/`treeitem`, `aria-level`, `aria-expanded`, tabindex "roving".
Flechas (arriba/abajo/izquierda/derecha), Inicio/Fin, Intro = ir a la página, F2 = renombrar
(también doble clic), Supr = borrar (confirma si tiene hijos), Insert = nuevo
(Ctrl+Insert = hijo), Alt+Flecha arriba/abajo = mover, Tab/Mayús+Tab = sangrar/desangrar
(solo cuando la operación es posible, para no atrapar el foco). Desangrar adopta como hijos
a los hermanos posteriores, de modo que el orden global no cambia. "Nuevo marcador" no escribe
nada en el documento hasta confirmar el título con Intro (Escape o vacío cancelan).
