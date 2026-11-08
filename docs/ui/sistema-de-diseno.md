# Sistema de diseño de la app nueva

Fuente única: [`src/ui/tema.css`](../../src/ui/tema.css), importado en `src/main.ts` **antes** que
`src/ui/estilos.css`. Origen y pruebas: **E-130** en `docs/ERRORES-CONOCIDOS.md`.

Este documento es el contrato de la fase 2: cada agente que migre una pantalla lo sigue al pie de la letra.

---

## 1. Dirección visual: "mesa de luz"

El documento es **papel apoyado en una mesa iluminada**. La interfaz es **vidrio claro** encima.

- **El papel manda.** La hoja es siempre blanca (`--ed-papel`) con una sombra de papel en tres capas
  (`--ed-sombra-papel`: contacto, borde y luz ambiente). El lienzo (`#viewer`) es la mesa: un gris frío con un
  foco de luz arriba (`--ed-stage` + `--ed-stage-luz`). Nada de la interfaz compite con la hoja.
- **Vidrio solo en lo que flota.** Diálogos, menús, toasts y hojas móviles usan `--ed-glass` + `backdrop-filter`
  + un canto de luz de 1 px (`inset 0 1px 0 var(--ed-glass-borde)`). Las barras fijas son superficies sólidas.
- **Un solo acento, con significado.** Cobalto (`--ed-accent`) = "esto está activo / esta es la acción principal /
  aquí está el foco". No se usa como decoración.
- **Movimiento que responde.** 120–200 ms, curva de salida suave, solo cuando la persona hace algo (hover, abrir,
  cambiar de pestaña). Nada se mueve solo. Con `prefers-reduced-motion` la duración computada es 0.
- **Jerarquía por peso y nivel, no por cajas.** Tres niveles de texto, cuatro de superficie, radios distintos según
  el tamaño del objeto (control 6, grupo 8, menú 12, diálogo 16).

## 2. Tokens

Todos en `:root`, prefijo `--ed-`. Claro por defecto; oscuro con `prefers-color-scheme: dark` o
`<html data-theme="dark">` (conmutador `#btn-tema`, `src/ui/tema.ts`). `data-theme="light"` fuerza claro.

### 2.1 Color (contraste calculado, WCAG 2.x)

| Token | Claro | Oscuro | Uso |
|---|---|---|---|
| `--ed-bg` | `#e3e7ed` | `#101216` | fondo de la app tras la carcasa |
| `--ed-stage` / `--ed-stage-luz` | `#dde2e9` / `#eef1f5` | `#0e1014` / `#1a1e25` | lienzo (mesa) |
| `--ed-surface` | `#f6f7f9` | `#181b21` | nivel 1: barras, panel lateral, estado |
| `--ed-surface-2` | `#ffffff` | `#21252d` | nivel 2: campos, cinta, botones secundarios |
| `--ed-surface-3` | `#eceef2` | `#14171c` | hundido: pistas, grupos segmentados, código |
| `--ed-glass` | blanco 90 % | grafito 90 % | diálogos, menús, toasts (vidrio) |
| `--ed-papel` | `#ffffff` | `#ffffff` | la hoja y lo que la tapa (máscaras, edición) |
| `--ed-text` | `#161b26` (16,1) | `#e9ecf2` (14,6) | texto principal |
| `--ed-text-muted` | `#4a5263` (7,3) | `#aeb5c2` (8,4) | etiquetas, texto secundario |
| `--ed-text-faint` | `#5a6274` (5,7) | `#949cab` (6,2) | terciario. **No sobre vidrio**: ahí usa `muted` |
| `--ed-text-placeholder` | = faint (6,1 sobre campo) | = faint (5,6) | placeholders |
| `--ed-accent` | `#2b55d0` | `#86a3ff` | acento; fondo del botón primario |
| `--ed-text-on-accent` | `#ffffff` (6,3) | `#0c1428` (7,6) | texto sobre acento |
| `--ed-accent-strong` / `-soft` | `#1f43b0` / `#e4ebfd` (7,1) | `#b3c6ff` / `#24305a` (7,6) | activo: texto / fondo |
| `--ed-hover` / `--ed-active` | negro 5,5 % / 10 % | blanco 7 % / 13 % | capas de estado |
| `--ed-focus-ring` | = acento | = acento | anillo de foco 2 px |
| `--ed-danger` (+`-hover`, `-soft`) | `#b42318` (6,6) | `#ff8a80` (7,6) | destructivo |
| `--ed-success` (+`-soft`) | `#1a7340` (5,9) | `#6fd39a` (9,4) | confirmación |
| `--ed-warning-text` / `-bg` / `-border` | `#6b4a00` / `#fff4d6` (7,4) | `#ffd27a` / `#2b2410` (10,8) | avisos |
| `--ed-border` / `-strong` | `#dadee5` / `#b9bfc9` | `#2c3039` / `#3d424d` | separadores (decorativos) |
| `--ed-control-border` | `#7b8290` | `#6f7684` | borde de campo (≥ 3:1, WCAG 1.4.11) |
| `--ed-velo` | tinta 28 % | negro 45 % | `::backdrop` |
| `--ed-sel`, `--ed-anotacion-activa` | | | selección de texto, nota activa |

Cifras entre paréntesis = contraste contra `--ed-surface` (o contra su fondo natural). El test
`tests/e2e/next/sistema-diseno.spec.ts` lo verifica con los colores **computados** en los dos temas.

### 2.2 Resto de tokens

| Grupo | Tokens |
|---|---|
| Radios | `--ed-radius-xs` 3 · `-sm` 6 (controles) · `-md` 8 (grupos) · `-lg` 12 (menús, toasts) · `-xl` 16 (diálogos) · `-pill` |
| Sombras | `--ed-sombra-1` (elevado) · `-2` (flotante) · `-3` (modal) · `--ed-sombra-papel` |
| Espaciado (4 px) | `--ed-sp-05` 2 · `-1` 4 · `-2` 8 · `-3` 12 · `-4` 16 · `-5` 20 · `-6` 24 · `-8` 32 |
| Tipografía | `--ed-fuente` (Segoe UI Variable, system-ui, SF Pro, Inter si está instalada; **sin descargas**) · `--ed-font-xs` 11,5 · `-sm` 12,5 · `-md` 13,5 · `-lg` 15 · `-xl` 17 · `--ed-peso-normal/medio/fuerte` 400/500/600 |
| Controles | `--ed-control-h-sm` 28 · `--ed-control-h` 32 · `--ed-control-h-lg` 36 |
| Movimiento | `--ed-dur-1` 120 ms (hover) · `-2` 160 ms (pestañas) · `-3` 200 ms (diálogos, paneles) · `--ed-curva` · `--ed-curva-entrada` |
| Vidrio | `--ed-blur`, `--ed-glass-borde` |
| Carcasa | `--ed-topbar-h` 48 · `--ed-tablist-h` 36 · `--ed-contextbar-h` 44 · `--ed-statusbar-h` 28 · `--ed-sidebar-w` 208 |

## 3. Componentes

| Componente | Marcado | Notas |
|---|---|---|
| Botón | `button.btn.btn--primario` · `--secundario` · `--fantasma` · `--peligro` · `+ .btn--icono` · `+ .btn--lg` | Un **solo** primario por vista. Peligro = texto rojo sin relleno. Icono solo: `aria-label` obligatorio |
| Botón de barra | `button.icon-btn` > `svg.icono` [+ `span.etiqueta`] | Construir con `App.iconBoton`. `aria-pressed="true"` = herramienta activa. En la cinta la etiqueta va debajo |
| Campo base | `input`, `select`, `textarea`, `input[type=color]` dentro de `#app` o de un `<dialog>` | Estilo automático (especificidad 0). No pongas bordes ni fondos inline |
| Rejilla de campos | `div.campos` > `div.campo` > `label.campo-etiqueta[for]` + `div.campo-control` > control [+ `span.campo-extra`] | Dos columnas alineadas. `p.campo-ayuda` ocupa las dos |
| Grupo | `fieldset.grupo` > `legend.grupo-titulo` | Para agrupar campos relacionados |
| Casilla | `label.casilla` > `input[type=checkbox]` + texto | |
| Diálogo | `<dialog>` abierto **siempre** con `mostrarModal` (añade `.dlg`) > `div.dlg-cabecera` (`h2.dlg-titulo[id]` + `button.btn.btn--fantasma.btn--icono.dlg-cerrar`) + `div.dlg-cuerpo` + `div.dlg-pie` | Pie: acción destructiva con `.dlg-pie-izq` a la izquierda; Cancelar (secundario) y la primaria **la última**. Mensajes en `p.dlg-mensaje[role=status]`. Foco inicial: `autofocus` en el primer campo |
| Pestañas de diálogo | `div.pestanas[role=tablist]` > `button.pestana[role=tab][aria-selected]` | Segmentadas. Paneles con `role=tabpanel` y `aria-labelledby` |
| Pestañas de carcasa | `.tablist` > `.tab` | Subrayado de acento animado (`::after`) |
| Tooltip | `[data-tooltip="Texto"]` | Aparece a los 400 ms al pasar o enfocar. No sustituye al nombre accesible |
| Toast / aviso | `div.toast` [+ `--exito` / `--peligro` / `--aviso`] con `role="status"` | Vidrio. El texto dice qué pasó y qué hacer |
| Panel lateral | `.panel-lateral` | Superficie nivel 1 con borde derecho |
| Flotante genérico | `.vidrio` | Menús, popovers, hojas |
| Código / tecla | `code.codigo`, `kbd` | |

## 4. Reglas de uso

1. **Ningún color literal** en `src/ui/**/*.ts` ni en CSS fuera de `tema.css` (regla `sin-color-literal-en-ui`;
   los ficheros antiguos tienen un tope que solo baja: al migrar uno, **baja su tope** en
   `scripts/guards/reglas.mjs` → `TOPE_COLORES_LITERALES`, o bórralo si llega a 0). Si un color es un **dato**
   (paleta de anotación, valor por defecto de un `type=color`), escape con razón.
2. ¿Falta un token? Se añade en `tema.css` **en los dos temas**, con su contraste calculado en la tabla de §2.1.
3. Estilos en clases, no en `style` inline. Inline solo para geometría calculada (posición/tamaño en px).
4. Construcción con `createElement` + `textContent` (AGENTS.md §2.2). Nunca `innerHTML` con datos.
5. Todo `<dialog>` se abre con `mostrarModal` (regla `sin-dialogo-casero`, E-127).
6. Todo campo tiene **etiqueta visible** asociada (`<label for>`). El placeholder es un ejemplo, nunca la etiqueta.
   Si además lleva `aria-label`, debe **contener** el texto visible (WCAG 2.5.3).
7. Texto en sentence case, verbos claros ("Aplicar", "Quitar los añadidos"), sin MAYÚSCULAS en etiquetas.
8. **No toques** la geometría de `.acrobat-page-canvas`, `.acrobat-overlay-canvas`, `.acrobat-text-layer`, `.page`,
   `.run`, `.run-mask` ni sus coordenadas: el sistema de diseño es solo presentación.

## 5. Qué no hacer

- Un `background: #fff` / `color: #000` "para que se vea": se rompe en oscuro (así nació E-130).
- Botones sin clase en la carcasa (dentro de un `<dialog>` toman el aspecto secundario, pero declara la variante).
- Dos botones primarios, o el primario a la izquierda.
- `opacity` para atenuar texto (baja el contraste sin control): usa `--ed-text-muted`.
- `--ed-text-faint` sobre vidrio, o texto sobre `--ed-accent-soft` que no sea `--ed-accent-strong`.
- Transiciones de más de 200 ms, animaciones en bucle o que arranquen solas; `transition: all`.
- Vidrio en superficies fijas grandes (barras): solo en lo que flota.
- Fuentes descargadas, iconos de terceros, dependencias nuevas, tocar la CSP.
- Un radio único para todo, sombras grises genéricas (`rgba(0,0,0,.1)`) o degradados decorativos.

## 6. Checklist de la fase 2 (por pantalla)

- [ ] Rama propia desde `main`; leído este documento y E-130.
- [ ] Captura **antes** en claro y oscuro (fuera de git, `.orquestacion/ui/`).
- [ ] Sin colores literales: tope del fichero bajado (o eliminado) en `TOPE_COLORES_LITERALES`.
- [ ] Anatomía `.dlg-cabecera` / `.dlg-cuerpo` / `.dlg-pie`, campos en `.campos`, botones `.btn` con jerarquía.
- [ ] Cada campo con etiqueta visible; foco inicial en el primer campo; Esc, trampa de Tab y foco devuelto (los da `mostrarModal`).
- [ ] Test E2E de la pantalla que añade su vista a la auditoría de contraste de `sistema-diseno.spec.ts`
      (reutiliza `auditarContraste`) en claro y oscuro, y comprueba que no hay campos huérfanos.
- [ ] Con `reducedMotion: 'reduce'` sigue sin transiciones (el test global lo cubre si la pantalla está abierta).
- [ ] `forced-colors`: bordes y foco visibles.
- [ ] Ids existentes intactos (los tests y el cableado dependen de ellos).
- [ ] Captura **después** en claro y oscuro, revisada a ojo; `npm run verify` en verde.

## 7. Pantallas y diálogos pendientes (orden de reparto)

Ordenadas por impacto visible (lo que más se usa y peor se ve primero). Cada línea es un lote independiente.

1. ~~**CompressPanel**~~ — migrado (fase 2): anatomía `.dlg-*`, `.campos`, barra `.progreso-*`; tope eliminado.
2. ~~**TextPanel**~~ — migrado (fase 2): cabecera con cierre, `textarea.texto-salida`, pie con Copiar como primaria; tope eliminado.
3. **NotaDialogo** (`src/ui/NotaDialogo.ts`): título y barra con estilos inline, ayuda con `opacity: 0.7`. Anatomía `.dlg-*`.
4. **SignaturePad** (`src/ui/SignaturePad.ts`, Rellenar y firmar › Firmar): lienzo con borde literal, aviso de privacidad `#475569`. El trazo `#000` es dato (escape). Tope 3.
5. **MisFirmasPanel** (`src/ui/MisFirmasPanel.ts`): lista de firmas, fondo `#fff` de miniatura. Tope 2.
6. **enlaceExterno** (`src/ui/enlaceExterno.ts`): confirmación de enlace externo; URL en caja `#f3f4f6`, aviso `#b91c1c`. Tope 4.
7. ~~**AtajosPanel**~~ — migrado (fase 2): tabla `.atajos-tabla` con `<kbd>`, una alternativa por línea, `.enlace` a `/legacy`; tope eliminado.
8. **Barra de buscar y reemplazar** (`.replace-bar` en `App.ts`/`estilos.css`): pasar `.replace-btn` a `.btn`, casillas a `.casilla`. **HECHO** (`ui-busqueda-avisos.spec.ts`).
9. ~~**Panel de propiedades de línea** y **paleta**~~ — migrados (fase 2): `#props-panel` y `#swatches` son grupos compactos de cinta (borde `--ed-border`, radio 8); tamaño de muestra en CSS, solo el color queda inline (dato).
10. **Panel de comentarios** (`ComentariosPanel.ts`): filas como tarjetas `.vidrio` ligeras, filtro con etiqueta visible. **HECHO** (sin fecha: `CommentInfo` no la trae).
11. **Panel de marcadores** (`PanelMarcadores.ts`, `#outline-toolbar`): acciones como `.btn--fantasma`, árbol con estados de `--ed-hover`/`--ed-accent-soft`. **HECHO**.
12. **Aviso de conversión** (`.conversion-warnings`): convertir en `.toast--aviso` anclado bajo la barra. **HECHO** (franja con grupos y recuento, no toast).
13. *(hecho, E-134)* **Hoja «Más» móvil** (`#toolbar-more.open`, ≤ 768 px) y **cajón lateral**: `.vidrio`, títulos de grupo sin mayúsculas.
14. *(hecho, E-134)* **Campos de formulario sobre la página** (`Viewer.ts`, ~l. 990–1050): borde `#94a3b8` y fondo casi opaco son literales; tokens nuevos de "campo sobre papel" (los dos temas iguales: la hoja es blanca).
15. **Avisos sobre la página** (`Viewer.ts`: `.pagina-invalida`, `.aviso-resolucion`, resaltados de búsqueda): pasar a clases con `--ed-danger-soft` / `--ed-warning-*`. El amarillo/naranja de búsqueda es dato de anotación (escape). Tope de Viewer 14. **HECHO** (tope de Viewer 8).
16. *(hecho, E-134)* **Botones de herramienta y paleta en `App.ts`**: la paleta `PALETTE` es dato (8 escapes con razón); quitar los `style.*` restantes de miniatura activa y muestras pasando a clases.
17. **Diálogos de apertura/errores del motor** que lleguen desde `main` después de E-130 (p. ej. `AperturaDialogos.ts`): aplicar la anatomía `.dlg-*` al integrarlos.

### Hoja «Más» móvil, cajón y campos de formulario (E-134)

- **Hoja inferior** (`#toolbar-more.open`, ≤ 768 px): `position: fixed` abajo, vidrio, esquinas superiores de 16 px, asa de 44 px
  (`.hoja-asa`, cierra y recibe el foco) y velo (`.hoja-velo`, toca fuera para cerrar). Cerrada está fuera de pantalla con
  `visibility: hidden` (no tabulable); la entrada y la salida usan `--ed-dur-3`, y con `prefers-reduced-motion` duran 0. Todo control
  mide ≥ 44 × 44 px (la muestra de color visible queda en 28 px dentro de su destino de 44).
- **Cajón** (`#sidebar`): vidrio, esquinas redondeadas, pestañas de 44 px y velo con fundido.
- **Campos sobre la página** (`.form-field`): tokens `--ed-campo-papel-*` (`tema.css`), iguales en los dos temas porque la hoja es blanca,
  y `color-scheme: light`. La posición y el tamaño (px CSS de página) siguen en línea: son geometría.
- **Utilidades**: `.oculto` (display none que no pisa un componente), `#props-panel.visible`. El color de cada muestra de la paleta es un
  dato y viaja como `--muestra`. `App.ts` ya no tiene estilos en línea de aspecto ni colores literales fuera de los datos de la paleta.

**Hecho en la fase 2 (dialogos):** NotaDialogo, SignaturePad (con Deshacer), MisFirmasPanel, enlaceExterno y AperturaDialogos (error y contrasena) usan la anatomia .dlg-* con las piezas de src/ui/dlgPartes.ts y los estilos de src/ui/dialogos.css; spec en tests/e2e/next/dialogos-fase2.spec.ts. Un diálogo nuevo reutiliza dlgPartes.ts y .dlg-aviso (peligro/aviso) en lugar de estilos en linea.
