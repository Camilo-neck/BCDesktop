# BetterCampus Desktop

App de escritorio de BetterCampus para estudiantes de la Universidad Nacional de Colombia. Arma tu horario con la oferta del SIA, genera combinaciones sin choques, analiza tu historia académica y muestra el mapa de prerrequisitos de tu plan. **Todo se calcula en tu equipo**: no hay cuenta ni servidor intermedio.

- **Planeador**: catálogo del SIA en cascada (nivel → sede → facultad → plan), grupos con cupos y profesores, choques visibles antes de agregar, vista previa al pasar el cursor, varios horarios, bloques personales, favoritos, colores y deshacer/rehacer.
- **Generador**: backtracking sobre máscaras de bits semanales; filtra por días, franja, créditos y cupos, y ordena por huecos, días en el campus y jornada.
- **Mi avance**: pega el texto de tu historia académica; P.A.P.A., P.A., avance por tipología, evolución por semestre y calculadoras.
- **Plan de estudios**: grafo de prerrequisitos por capas, con zoom, búsqueda y resaltado de cadenas. Con tu historia muestra qué materias ya puedes inscribir.
- **Exportar**: archivo `.ics` o Google Calendar (OAuth para apps instaladas con PKCE).
- **Profesores**: reseñas de LosEstudiantes. **Cupos históricos**: API pública de BetterCampus.
- Tutorial guiado la primera vez que abres cada función, paleta de comandos (`Ctrl K`), tema claro/oscuro e instancia única.

## Stack

| Capa | Tecnología |
| --- | --- |
| Shell | Tauri 2 (webview del sistema, instancia única, estado de ventana) |
| UI | React 19 + Vite, Tailwind 3, Radix UI, Recharts, motion |
| Estado | TanStack Query (datos del núcleo) + Zustand (estado de UI) |
| Núcleo | Rust: crate `bc-core`, independiente de Tauri |
| Datos | SQLite local (`rusqlite`, incluido en el binario) |

```
BCDesktop/
├── crates/bc-core/         Núcleo: sia, scheduler, academic, curriculum, integrations, storage
│   ├── examples/           Pruebas manuales contra el SIA real y exportación de fixtures
│   └── tests/fixtures/     Respuestas reales del SIA usadas por las pruebas del parser
├── src-tauri/              App Tauri: comandos (adaptadores finos sobre bc-core) y estado
├── src/                    Frontend React
│   ├── pages/              Inicio, Planeador, Mi avance, Plan de estudios, Ajustes, Acerca de
│   ├── components/         planner/, curriculum/, tour/, shell/, ui/
│   ├── lib/                api (invoke tipado), data (hooks), settings, store, types
│   └── dev/                Mock de comandos para desarrollar la UI en el navegador
└── .github/workflows/      CI y releases para Linux, Windows y macOS
```

## Requisitos

- Rust estable (`rustup`), Node 20+ y npm.
- **Linux**: WebKitGTK 4.1 y librerías de Tauri.
  - Arch: `sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg`
  - Debian/Ubuntu: `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev libdbus-1-dev`
- **Windows**: Microsoft C++ Build Tools y WebView2 (ya viene en Windows 10/11).
- **macOS**: Xcode Command Line Tools.

## Desarrollo

```bash
npm install
npm run app:dev        # abre la app con recarga en caliente
```

Solo la interfaz, en el navegador y sin compilar Rust (usa datos reales guardados en `src/dev/fixtures`):

```bash
npm run dev            # http://localhost:1420
# Parámetros útiles: ?tours=on (muestra los tutoriales), ?empty, ?nohistory, ?open=gen|add|export|palette
```

Pruebas y verificación:

```bash
cargo test -p bc-core                                   # parser del SIA, generador, historia, grafo, ics, SQLite
cargo run -p bc-core --example sia_live                 # recorrido real contra el SIA
cargo run -p bc-core --example sia_prereqs -- 0-2-8-4   # prerrequisitos de un plan completo
cargo run -p bc-core --example dump_fixtures            # renueva los datos del mock de la UI
npm run typecheck
```

## Compilar instaladores

```bash
npm run app:build
```

Genera los instaladores del sistema actual en `target/release/bundle/`: `.AppImage`, `.deb` y `.rpm` en Linux; instalador NSIS `.exe` y `.msi` en Windows; `.dmg` en macOS.

Para las tres plataformas, crea un tag y el workflow `release.yml` publica un borrador de release con todos los instaladores. macOS se compila en los runners de GitHub, así que no hace falta un Mac:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Windows desde Linux (experimental en Tauri, útil para pruebas rápidas):

```bash
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin      # requiere también llvm, lld y nsis
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc
```

Sin certificado de firma, Windows SmartScreen y macOS Gatekeeper advierten la primera vez que se abre la app.

## Configuración

| Variable (al compilar) / Ajuste | Para qué |
| --- | --- |
| `BC_GOOGLE_CLIENT_ID`, `BC_GOOGLE_CLIENT_SECRET` · Ajustes › Integraciones | Exportar a Google Calendar |
| `BC_STATS_API_URL` · Ajustes › Integraciones | Histórico de cupos (`POST {url}/InscriptionStats/`) |

**Google Calendar**: en Google Cloud Console crea un cliente OAuth de tipo **App de escritorio** y habilita la Google Calendar API. La app usa el redirect de loopback (`http://127.0.0.1:<puerto>`) con PKCE y solo pide el alcance `calendar.app.created`, así que solo ve y modifica los calendarios que ella misma crea. El refresh token se guarda en el llavero del sistema operativo.

Los datos viven en una base SQLite en el directorio de datos de la app (Ajustes › Datos › Abrir).

## Diferencias con la versión web

- La consulta al SIA es directa desde el equipo. La sesión ADF se mantiene viva en memoria, y el catálogo y las ofertas se guardan en caché local.
- Los desplegables de carreras se consultan en cascada en lugar de depender de un árbol precalculado en Mongo. Así no se rompen cuando el SIA cambia los índices: la Facultad de Ingeniería pasó del índice 7 al 8.
- El generador, que la web no exponía, ahora es una función central.
- La historia académica se procesa localmente y no se guarda en ningún servidor.
- El grafo de prerrequisitos se dibuja de forma nativa, sin iframes de pyvis.
