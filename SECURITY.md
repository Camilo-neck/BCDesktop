# Política de seguridad

## Versiones con soporte

Solo la última versión publicada en [Releases](https://github.com/Camilo-neck/BCDesktop/releases) recibe correcciones de seguridad.

## Reportar una vulnerabilidad

**No abras un issue público.** Usa el [reporte privado de vulnerabilidades de GitHub](https://github.com/Camilo-neck/BCDesktop/security/advisories/new) e incluye:

- Qué componente está afectado (núcleo Rust, comandos Tauri, interfaz, instaladores).
- Pasos para reproducirlo y el impacto que esperas.
- Versión y sistema operativo.

Respondemos en un máximo de 7 días. Coordinaremos contigo la fecha de publicación de la corrección y te daremos crédito si lo deseas.

## Qué nos importa especialmente

- **Datos del estudiante**: la historia académica, los horarios y los ajustes viven en SQLite local. Nada debería salir del equipo sin una acción explícita del usuario.
- **Tokens de Google**: el refresh token se guarda en el llavero del sistema. Solo si no hay llavero se usa la base local como respaldo.
- **Superficie de la ventana**: los permisos de la webview están en `src-tauri/capabilities/default.json`, con una CSP restrictiva en `tauri.conf.json`. Cualquier cambio que los amplíe debe justificarse en el PR.
- **Secretos**: nunca se suben al repositorio. Los valores de compilación (`BC_GOOGLE_CLIENT_ID`, etc.) se configuran como variables o secrets de GitHub Actions.
