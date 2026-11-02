# Spike (propuesta, NO implementada): cobertura Unicode real en Word/Markdown → PDF

Contexto: E-120 deja los caracteres sin glifo en las fuentes estándar como `?` con aviso y `/ActualText`. Para dibujarlos de verdad hay que incrustar una fuente con `FPDFText_LoadFont` (bytes TrueType/OpenType; PDFium crea el subconjunto CID al guardar).

## Vía A: Local Font Access API (`window.queryLocalFonts()`)
- Cobertura: la de las fuentes instaladas del usuario (Segoe UI, Arial Unicode, Noto, Yu Gothic, Malgun...). Normalmente cubre latín extendido, cirílico, griego con tilde y CJK; los emoji en color no (PDFium no pinta fuentes de color).
- Tamaño: cero en el bundle; el PDF crece con el subconjunto usado (decenas de KB para texto latino/cirílico; CJK cientos de KB).
- Privacidad: los bytes nunca salen del equipo. Pero exige un permiso explícito del usuario (`local-fonts`) y expone la lista de fuentes instaladas (vector de huella digital), por eso se pide solo al convertir un documento con caracteres sin glifo, nunca al cargar la app.
- Compatibilidad: solo Chromium de escritorio (Chrome/Edge); no Firefox ni Safari. Sin permiso o sin API, se mantiene el comportamiento actual (`?` + aviso).
- Riesgo: resultado dependiente de la máquina (el mismo `.docx` da PDFs distintos); licencias de fuentes de sistema que no permiten incrustación (comprobar `fsType` de la tabla OS/2 y avisar).

## Vía B: empaquetar una fuente OFL (p. ej. Noto Sans / Noto Sans CJK subconjuntos)
- Cobertura: la que se elija; determinista y la misma en todas las máquinas. Noto Sans (latín, griego, cirílico) ≈ 500 KB por estilo; CJK 8-16 MB (imposible en bundle, habría que trocear por idioma o no incluirlo). Emoji en color: no.
- Tamaño: crece el bundle, la caché del service worker y el tiempo de carga; se carga bajo demanda (import dinámico) solo al detectar caracteres sin glifo.
- Privacidad: sin permisos ni huella; todo local y sin descargas en tiempo de ejecución si va dentro del despliegue.
- Compatibilidad: todos los navegadores.
- Requiere el permiso explícito del dueño (añade un activo de terceros con licencia OFL y puede afectar a `vercel.json`/CSP si se sirve como fichero aparte).

## Recomendación
Combinar: B para latín extendido + griego + cirílico (un único `Noto Sans` Regular/Bold, carga diferida, el 95 % de los casos reales) y A, opcional y con permiso, para CJK donde B no es viable. Ambas se apoyan en el mismo punto: `CodificadorTexto` ya parte el trazo por repertorio, solo habría que añadir un repertorio `incrustada(fuente)` entre «Dingbats» y «sin glifo», medir con `FPDFFont_GetGlyphWidth` de la fuente cargada y mantener `?`+aviso como último recurso.
