# Arquitectura

BetterCampus Desktop tiene tres capas. La interfaz React nunca habla con la red: todo pasa por comandos Tauri, que son adaptadores finos sobre el crate `bc-core`, donde vive la lógica.

```
┌──────────────────────────────────────────────────────────────┐
│ Interfaz React (src/)                                        │
│   pages/ · components/ · lib/api.ts (invoke tipado)          │
│   TanStack Query (datos) · Zustand (estado de UI)            │
└───────────────▲──────────────────────────────┬───────────────┘
                │ eventos bc://progress        │ invoke(cmd, args)
┌───────────────┴──────────────────────────────▼───────────────┐
│ Shell Tauri (src-tauri/)                                     │
│   commands/* · state.rs (Db, SiaService, cliente HTTP, OAuth)│
└──────────────────────────────┬───────────────────────────────┘
                               │ llamadas directas
┌──────────────────────────────▼───────────────────────────────┐
│ bc-core (crates/bc-core/)                                    │
│   sia · scheduler · academic · curriculum · integrations     │
│   storage (SQLite) · model · week                            │
└──────────────────────────────┬───────────────────────────────┘
                               │ HTTPS (reqwest + rustls)
        SIA · LosEstudiantes · API de cupos · Google Calendar
```

## bc-core

| Módulo | Responsabilidad |
| --- | --- |
| `model` | Tipos de dominio: `Course`, `Group`, `Session`, `CareerRef`, `Typology`, `CoursePrereqs` |
| `week` | `WeekMask`: la semana como bitset de franjas de 10 minutos (7 × 144 bits) |
| `sia` | Sesión ADF con el catálogo público del SIA, parsers HTML y operaciones masivas |
| `scheduler` | Modelo `Schedule`/`Selection` y el generador de horarios |
| `academic` | Parser de la historia académica y calculadoras de promedio |
| `curriculum` | Grafo de prerrequisitos, estados según la historia y layout por capas |
| `integrations` | LosEstudiantes, API de cupos, iCalendar y Google Calendar |
| `storage` | SQLite: ajustes, biblioteca, horarios, historias, planes y caché |
| `error` | `Error` con un `kind` para la interfaz y mensajes ya redactados en español |

### SIA

El buscador público es una página Oracle ADF. Cada clic es un POST de formulario que debe llevar el `javax.faces.ViewState` vigente, y el servidor recuerda en la sesión la carrera y la fila seleccionadas. `SiaSession` vuelve explícito ese estado (`Fresh → OnCareer → OnCourse`):

1. `open`: GET de la página con `taskflowId`, que entrega el ViewState y el `Adf-Window-Id`.
2. Desplegables en cascada: un POST por nivel. El SIA responde con XML parcial cuyo HTML va en bloques CDATA (`parser::html_of`).
3. `set_career`: recarga el formulario, envía nivel, sede, facultad, plan y tipología (más dos pasos extra para libre elección) y pulsa "Mostrar".
4. `course_page`: selecciona y abre una fila, lee la página y vuelve a la tabla. ADF intercambia las filas 0 y 1 tras la primera navegación, así que el código verifica el código del curso en el título y prueba la fila vecina si no coincide.

Detalles a tener en cuenta:
- El SIA entrega una página de "loopback" JavaScript a navegadores reales, así que el cliente se identifica como `BetterCampus-Desktop/<versión>`.
- La sesión expira tras unos minutos sin uso. `SiaService` la reabre y reintenta una vez (macro `with_session!`).
- La descarga de prerrequisitos de un plan completo usa hasta 3 sesiones en paralelo.
- Todos los ids ADF están en `sia/constants.rs`.

### Generador

1. Cada grupo candidato se reduce una vez a un `WeekMask`; dos grupos chocan si sus máscaras se intersectan.
2. Los filtros (días, franja, bloques personales, cupos, excluidos) se aplican como una máscara de "prohibido". Los grupos fijados ignoran los filtros.
3. Las materias se ordenan por cantidad de candidatos, de menor a mayor (fail-first).
4. Búsqueda en profundidad con la unión de máscaras acumulada, poda por créditos y un tope de 4 millones de nodos.
5. Se conserva un heap acotado con los `limit` mejores según el puntaje: huecos, días con clase, horas fuera de la jornada preferida, favoritos y cupos escasos.
6. Si ninguna combinación incluye todas las materias, se repite permitiendo omitir materias y se maximiza cuántas entran.

### Almacenamiento

Un archivo `bettercampus.db` en el directorio de datos de la app, con migraciones versionadas por `PRAGMA user_version`. Los objetos de dominio se guardan como JSON; las columnas restantes sirven para ordenar y expirar.

| Tabla | Contenido |
| --- | --- |
| `settings` | Ajustes clave → JSON (tema, carrera por defecto, tutoriales vistos…) |
| `courses` | Biblioteca del estudiante: curso, color, fecha de agregado |
| `favorites` | Grupos marcados con corazón |
| `schedules` | Horarios con su posición |
| `histories` | Texto original y resultado del parser de cada historia cargada |
| `prereqs` | Prerrequisitos descargados por plan |
| `cache` | Respuestas del SIA y de servicios externos con fecha de expiración |

Vigencia de la caché: desplegables 7 días, oferta de una carrera 6 horas, reseñas de profesores 7 días, cupos históricos 12 horas.

## Comandos Tauri

| Área | Comandos |
| --- | --- |
| Sistema | `app_info`, `settings_get`, `settings_set`, `cache_clear`, `data_reset` |
| Catálogo | `catalog_levels`, `catalog_campuses`, `catalog_faculties`, `catalog_plans`, `catalog_courses`, `sia_cancel` |
| Biblioteca | `library_list`, `library_fetch`, `library_refresh`, `library_save_manual`, `library_remove`, `library_set_color`, `favorites_toggle` |
| Horarios | `schedules_list`, `schedule_create`, `schedule_save`, `schedule_duplicate`, `schedule_delete`, `schedules_reorder`, `schedules_generate` |
| Historia | `history_parse`, `history_latest`, `history_clear`, `calc_papa_after`, `calc_papi_for`, `calc_max_papa` |
| Plan | `plans_list`, `plan_fetch`, `plan_delete`, `plan_graph` |
| Integraciones | `professor_lookup`, `stats_inscriptions`, `export_ics`, `google_status`, `google_connect`, `google_disconnect`, `google_export` |

Las tareas largas emiten el evento `bc://progress` con `{ task, done, total, current }`. La interfaz lo muestra en el indicador flotante, y `sia_cancel` lo detiene entre peticiones.

`settings_get` y `settings_set` solo aceptan las claves públicas listadas en `commands/system.rs`; los tokens y los datos internos no son accesibles desde la interfaz.

## Interfaz

- **Rutas** (`App.tsx`, router con hash): `/`, `/planner`, `/progress`, `/curriculum`, `/settings`, `/about`.
- **Datos**: `lib/data.ts` concentra la lógica del editor de horarios (actualización optimista, deshacer, choques). Las páginas no llaman a `api` para mutar horarios directamente.
- **Tema**: los colores son variables CSS (`styles/globals.css`) expuestas como tokens de Tailwind. En SVG y Recharts se usan resueltos con `useThemeColor()`.
- **Tutoriales**: `components/tour/tours.tsx` define los pasos; cada paso apunta a un elemento con `data-tour="…"`. `useAutoTour(id)` lo lanza la primera vez y el estado se guarda en `settings.tours`.
- **Modo navegador**: con `npm run dev` fuera de Tauri, `lib/api.ts` redirige las llamadas a `dev/mock.ts`.
