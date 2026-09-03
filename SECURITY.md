# 🛡️ Política de Seguridad

La seguridad y la privacidad de los documentos procesados por nuestros usuarios son la máxima prioridad de **PDF Editor**.

## 🔐 Filosofía Zero-Knowledge & Zero-Data Storage
- La aplicación opera 100% en el navegador web del usuario (Client-Side).
- Los documentos PDF, imágenes o textos cargados jamás se almacenan en servidores externos ni bases de datos.
- La memoria RAM utilizada se libera en cuanto se cierra la pestaña o el documento.

## ⚠️ Reporte de Vulnerabilidades
Si descubres una vulnerabilidad de seguridad o sospechas de una posible fuga de datos o código malicioso, por favor **no abras un issue público**.

En su lugar:
1. Contacta de forma confidencial al propietario del repositorio a través de GitHub Security Advisories.
2. Incluye una descripción detallada del problema, pasos para reproducirlo y el impacto potencial.
3. Se te responderá a la brevedad con una evaluación y un parche de seguridad coordinado.

## 🛡️ Políticas de Aprobación de Código
- Ninguna persona ajena al mantenedor del proyecto puede integrar cambios directamente a la rama de producción (`main`).
- Cada Pull Request es auditado estáticamente para descartar inyecciones XSS, robo de tokens de sesión o exfiltración de buffers.
