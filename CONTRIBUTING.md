# Cómo contribuir a BetterCampus Desktop

¡Gracias por querer ayudar! Este documento explica cómo preparar el entorno, cómo está organizado el código y qué esperamos de un pull request. Al participar aceptas el [Código de conducta](CODE_OF_CONDUCT.md).

## Formas de ayudar

- **Reportar un bug**: abre un [issue con la plantilla de bug](https://github.com/Camilo-neck/BCDesktop/issues/new/choose). Incluye sistema operativo, versión de la app y pasos para reproducirlo.
- **El SIA cambió y algo dejó de funcionar**: usa la plantilla "Cambio en el SIA". Es el tipo de fallo más común y el más valioso de reportar pronto.
- **Proponer una función**: abre un issue antes de escribir código grande, para acordar el enfoque.
- **Código**: los issues con la etiqueta `good first issue` son un buen punto de partida.
- **Documentación y textos de la interfaz**: también cuentan, y se revisan igual que el código.

## Preparar el entorno

Requisitos: Rust estable, Node 20 o superior y las dependencias de Tauri de tu sistema (ver el [README](README.md#requisitos)).

```bash
npm install
npm run app:dev          # app completa con recarga en caliente
```

Google Calendar y el histórico de cupos necesitan credenciales al compilar. Para probarlos, copia `.env.example` como `.env` y complétalo; sin ellas, esas funciones aparecen como no disponibles y el resto de la app funciona igual.

Para trabajar solo en la interfaz no hace falta compilar Rust:

```bash
npm run dev              # http://localhost:1420, con datos reales guardados en src/dev/fixtures
```

Parámetros de la URL en este modo: `?tours=on` muestra los tutoriales, `?empty` arranca con el horario vacío, `?nohistory` sin historia académica, `?open=gen|add|export|palette` abre ese panel, `?update` simula una actualización disponible.

## Organización del código

| Carpeta | Qué contiene | Regla principal |
| --- | --- | --- |
| `crates/bc-core` | Toda la lógica: SIA, generador, historia, grafo, integraciones, SQLite | No depende de Tauri; todo se prueba con `cargo test` |
| `src-tauri` | Comandos Tauri y estado de la app | Adaptadores finos: validan, llaman a `bc-core` y devuelven |
| `src/lib` | Cliente `invoke` tipado, hooks de datos, ajustes, estado de UI | Los tipos de `types.ts` reflejan los de Rust |
| `src/components`, `src/pages` | Interfaz | Sin llamadas directas a `invoke`; usar `api` y los hooks |
| `src/dev` | Mock de comandos para el navegador | Solo se carga en desarrollo |

La [guía de arquitectura](docs/ARCHITECTURE.md) explica el flujo del SIA, el generador y el esquema de datos.

### Agregar un comando nuevo

1. Implementa la lógica en `bc-core`, con pruebas.
2. Expón un `#[tauri::command]` en el módulo correspondiente de `src-tauri/src/commands/` y regístralo en `src-tauri/src/lib.rs`.
3. Añade el wrapper en `src/lib/api.ts` y los tipos en `src/lib/types.ts`. Los campos van en camelCase, como los serializa serde.
4. Añade el handler en `src/dev/mock.ts` para que la interfaz siga funcionando en el navegador.
5. Si el comando usa un plugin nuevo de Tauri, agrega su permiso en `src-tauri/capabilities/default.json`.

### Cuando el SIA cambia

- Los ids de componentes ADF están en `crates/bc-core/src/sia/constants.rs`; los selectores HTML, en `sia/parser.rs`.
- Guarda una respuesta real nueva en `crates/bc-core/tests/fixtures/` y actualiza la prueba del parser antes de corregirlo.
- Verifica contra el SIA real con `cargo run -p bc-core --example sia_live`.
- Si cambian los datos del mock, regénéralos con `cargo run -p bc-core --example dump_fixtures`.

## Estilo

- **Rust**: `cargo fmt` y `cargo clippy -- -D warnings` sin advertencias. Los errores visibles al estudiante se escriben en español en `bc_core::Error`.
- **TypeScript**: modo `strict`, sin `any` salvo en el mock. Componentes en PascalCase, hooks con prefijo `use`.
- **Interfaz**: textos en español neutro y cercano (tú). Colores solo con los tokens de `tailwind.config.js` (`bg-surface`, `text-primary`…), nunca hex fijos, para que el tema oscuro funcione. En SVG y gráficos usa `useThemeColor()`, porque los atributos SVG no aceptan `var(--…)`.
- **Funciones nuevas visibles**: si la función tiene varios pasos, agrega su recorrido en `src/components/tour/tours.tsx` y marca los elementos con `data-tour`.
- Comentarios solo donde el código no se explica solo; prefiere nombres claros.

## Antes de abrir un pull request

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p bc-core
npm run typecheck
```

La CI corre lo mismo en Linux y Windows.

- Ramas con nombre descriptivo: `feat/generador-bloques`, `fix/sia-tipologia`.
- Commits en el estilo [Conventional Commits](https://www.conventionalcommits.org/es/) (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Un PR por cambio. Si toca la interfaz, incluye capturas en claro y oscuro.
- Actualiza el [CHANGELOG](CHANGELOG.md) en la sección `Sin publicar`.

## Mantenedores

| Persona | GitHub |
| --- | --- |
| Camilo Cuello | [@Camilo-neck](https://github.com/Camilo-neck) |

Para temas de conducta o seguridad, escribe por privado a un mantenedor. Las vulnerabilidades se reportan como indica [SECURITY.md](SECURITY.md).

## Licencia

Al contribuir aceptas que tu aporte se publique bajo la [licencia PolyForm Noncommercial 1.0.0](LICENSE) del proyecto, y que los mantenedores puedan otorgar licencias comerciales sobre el proyecto, incluido tu aporte.
