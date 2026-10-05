# Panel "Comentarios"

Tercera pestaña del panel lateral (`#tab-comments`, junto a Páginas y Marcadores).
Código: `src/ui/ComentariosPanel.ts`; motor: `getComments` / `setNoteText`
(`src/engine/pdfium/PdfiumEngine.ts`); comandos: `SetNoteTextCmd`, `RemoveNoteCmd`.

## Alcance

- Lista **anotaciones reales del PDF**: todas las notas (`/Text`, aunque estén
  vacías) y cualquier otra de marcado (resaltado, subrayado, tachado, texto
  libre, sello...) que tenga `/Contents` no vacío. Excluye enlaces, popups y
  widgets de formulario.
- Los resaltados, subrayados y tachados que crea ESTE editor son paths de
  contenido, no anotaciones: no aparecen en el panel.
- Por elemento: página, tipo, extracto (140 car.) y autor (`/T`) si existe.
- Clic: `goToPage` + resalta la nota en el visor (clase `.note-marker.activa`).
- Editar (`/Contents` vía `FPDFAnnot_SetStringValue`, deshacer restaura el texto
  anterior) y borrar (deshacer por snapshot). Filtro por texto, tipo y autor.
- Lectura perezosa (E-043/E-044): nada se lee hasta mostrar la pestaña; se leen
  20 páginas por tanda cediendo el hilo; un cambio de una página solo relee esa.
- Límite conocido: el visor solo repinta las páginas visibles, así que el
  marcador de una nota editada/borrada en una página fuera de pantalla se
  actualiza al volver a verla.
