# Changelog

Todos los cambios relevantes del proyecto. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y el versionado, [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- El indicador de progreso de las tareas largas se puede minimizar a un círculo en la esquina, con el porcentaje, y al terminar muestra «Listo» por un momento.

### Corregido

- Con «Fijar elegidos», el generador ya no deja fuera una materia fijada cuando no caben todas. Si dos materias fijadas se cruzan o el grupo fijado ya no se ofrece, lo indica con el motivo.
- La ventana ya no se congela mientras se procesa la historia académica, se dibuja el plan de estudios, se exporta el calendario o se guardan datos.
- En el plan de estudios, al seleccionar una materia, las demás y sus flechas se atenúan juntas en lugar de desaparecer las materias y quedar flechas sueltas.
- Exportar con una fecha de fin del semestre anterior a la de inicio ya no crea un calendario vacío: la app avisa del error. También avisa si ninguna clase cae entre las fechas.
- Exportar a Google Calendar ya no espera varios segundos para reintentar cuando Google niega el acceso; solo reintenta cuando el error es temporal.
- El tutorial de «Agregar asignaturas» ya se puede avanzar y cerrar, y los clics ya no atraviesan su fondo hacia la ventana de atrás.
- Un clic fuera de la tarjeta ya no salta el tutorial. Al omitirlo, la app indica dónde repetirlo.
- La app ya no parpadea al cambiar de sección, y los datos y gráficos de «Mi avance» ya no parpadean al abrirla.
- El generador de horarios responde casi al instante y muestra las mejores combinaciones posibles. Antes podía tardar minutos con asignaturas de muchos grupos y solo revisaba una parte de las combinaciones. Si el cálculo supera el tiempo límite, muestra las mejores opciones encontradas y lo avisa.
- El indicador de progreso ya no queda escondido detrás de las ventanas (descargar el plan, agregar asignaturas, exportar), y su botón de cancelar funciona aunque haya una ventana abierta.
- Descargar un plan de estudios ya no bloquea la ventana durante la descarga: se cierra al empezar y el progreso sigue en el indicador.
- Si una tarea larga falla a mitad de camino, el indicador de progreso ya no queda pegado en pantalla.
- En «Mi avance», los créditos vistos de más en una tipología (por ejemplo 36 de 33 en libre elección) se siguen mostrando, pero ya no inflan el porcentaje de esa tipología ni la gráfica de avance acumulado.

### Cambiado

- **Cambio de licencia:** el proyecto pasa de MIT a [PolyForm Noncommercial 1.0.0](LICENSE). El código sigue siendo público, pero cualquier uso comercial requiere autorización previa y por escrito de los mantenedores. Las versiones hasta la 0.1.0 siguen bajo MIT.

## [0.1.0] - 2026-10-11

Primera versión de escritorio, construida sobre Tauri 2, React y un núcleo en Rust.

### Agregado

- Planeador de horarios:
  - Catálogo del SIA consultado en cascada (nivel → sede → facultad → plan), incluida la libre elección.
  - Choques visibles antes de agregar y vista previa en la grilla.
  - Varios horarios, bloques personales, favoritos, colores y deshacer/rehacer.
- Generador de horarios con máscaras de bits semanales, filtros (días, franja, créditos, cupos) y orden por huecos, días y jornada. Si no caben todas las materias, maximiza cuántas entran.
- Mi avance: análisis local de la historia académica, avance por tipología, evolución por semestre y calculadoras de P.A.P.A.
- Plan de estudios: grafo de prerrequisitos por capas con búsqueda, zoom y estado según la historia académica.
- Exportación a `.ics` y a Google Calendar (OAuth con PKCE y loopback).
- Reseñas de profesores de LosEstudiantes e histórico de cupos desde la API de BetterCampus.
- Tutoriales guiados por función, paleta de comandos, tema claro/oscuro e instancia única.
- Persistencia local en SQLite con migraciones.
- CI en Linux y Windows; releases para Linux, Windows (NSIS y MSI) y macOS.

[Sin publicar]: https://github.com/Camilo-neck/BCDesktop/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Camilo-neck/BCDesktop/releases/tag/v0.1.0
