# 🤝 Guía de Contribución a PDF Editor

¡Gracias por tu interés en colaborar con **PDF Editor**!

Este proyecto tiene como principio fundamental la **privacidad total del usuario (Zero-Data Storage)** y la **seguridad del código fuente**. Para proteger a los usuarios de código malicioso o vulnerabilidades, todas las contribuciones se gestionan bajo políticas estrictas.

---

## 🔒 Reglas de Oro de Seguridad

1. **Obligatoriedad de Pull Request (PR)**:
   - Nadie tiene permisos para realizar `git push` directo a la rama principal `main`.
   - Todas las propuestas de cambios deben pasar mediante un Pull Request.
   - Solo el propietario del repositorio tiene privilegios para autorizar, aprobar y fusionar (merge) cambios a `main`.

2. **Cero Almacenamiento en Servidores (Zero-Data Storage)**:
   - Todo procesamiento de PDFs, renderizado, firmas y anotaciones debe ejecutarse 100% en la memoria RAM del navegador del cliente (Client-Side con WebAssembly y HTML5 Canvas).
   - Queda terminantemente prohibido incorporar llamadas de red que transmitan archivos o metadatos de los usuarios a servidores externos, APIs de terceros o servicios de analítica no autorizados.

3. **Sin Código Ofuscado**:
   - Todo el código debe ser legible, transparente y documentado. Se rechazarán de inmediato PRs con scripts minificados sin fuente, código empaquetado opaco o URLs dinámicas sospechosas.

4. **Auditoría de Dependencias**:
   - No se deben agregar librerías de npm a menos que sean estrictamente necesarias y aprobadas previamente por el mantenedor.

---

## 🚀 Flujo de Trabajo para Contribuir

1. **Haz un Fork**:
   Haz un fork del repositorio en tu propia cuenta de GitHub.

2. **Crea una Rama Temática**:
   ```bash
   git checkout -b feature/mi-mejora
   # o
   git checkout -b fix/mi-correccion
   ```

3. **Desarrolla y Prueba Localmente**:
   - Asegúrate de que los estilos compilen correctamente:
     ```bash
     npm run build
     ```
   - Inicia el servidor local para probar tu cambio:
     ```bash
     npm start
     ```

4. **Realiza tu Commit con Mensajes Claros**:
   ```bash
   git commit -m "feat: añade soporte para exportación SVG"
   ```

5. **Abre un Pull Request**:
   - Abre el PR apuntando a la rama `main` del repositorio oficial.
   - Rellena todos los campos de la plantilla de PR obligatoria confirmando que el código cumple con las reglas de privacidad y seguridad.

6. **Revisión y Aprobación**:
   - El propietario del repositorio revisará manualmente el diff de código línea por línea.
   - Si todo es seguro y aporta valor, el PR será aprobado e integrado.
