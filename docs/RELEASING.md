# Publicar una versión

Las versiones se publican con GitHub Actions (`.github/workflows/release.yml`). Al subir un tag `v*`, el workflow compila en Linux, Windows y macOS y deja un **borrador** de release con los instaladores.

## Pasos

1. Actualiza la versión, con el mismo número, en:
   - `package.json` → `version`
   - `Cargo.toml` → `[workspace.package] version`
   - `src-tauri/tauri.conf.json` → `version`
2. Corre `cargo check` para que se actualice `Cargo.lock`.
3. En `CHANGELOG.md`, mueve lo de `Sin publicar` a una sección nueva con la versión y la fecha, y actualiza los enlaces del final.
4. Haz commit, crea el tag `vX.Y.Z` y súbelo.
5. Cuando el workflow termine, revisa el borrador en Releases: prueba al menos el instalador de Windows, pega las notas del changelog y publícalo. **Al publicarlo, las apps instaladas empiezan a ofrecer la actualización**; mientras siga en borrador o marcado como *pre-release*, nadie la recibe.

## Artefactos

| Sistema | Archivos |
| --- | --- |
| Linux | `.AppImage`, `.deb`, `.rpm` |
| Windows | `*_x64-setup.exe` (NSIS, sin permisos de administrador) y `*_x64_en-US.msi` |
| macOS | `.dmg` universal (Intel y Apple Silicon) |

## Compilar localmente

`npm run app:build` genera los instaladores del sistema donde se ejecuta, en `target/release/bundle/`.

El `.exe` de Windows también se puede generar desde Linux. Tauri marca este camino como experimental y solo produce NSIS, no MSI:

```bash
# Arch: llvm lld clang (repos oficiales) y nsis (AUR). Debian/Ubuntu: apt install nsis lld llvm clang
rustup target add x86_64-pc-windows-msvc
cargo install --locked cargo-xwin
npm run tauri build -- --runner cargo-xwin --target x86_64-pc-windows-msvc
# → target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

## Variables y secrets del repositorio

Se configuran en *Settings › Secrets and variables › Actions*. Se incrustan en el binario al compilar; la app no permite cambiarlas. Si falta alguna, la función correspondiente aparece como no disponible. Los secrets de firma de las actualizaciones son aparte y obligatorios: ver [Llaves de firma](#llaves-de-firma).

| Nombre | Tipo | Uso |
| --- | --- | --- |
| `BC_GOOGLE_CLIENT_ID` | Variable | Client ID del cliente OAuth "App de escritorio" |
| `BC_GOOGLE_CLIENT_SECRET` | Secret | Secret del mismo cliente |
| `BC_STATS_API_URL` | Variable | URL base de la API de cupos |

`BC_GOOGLE_CLIENT_ID` va en la pestaña **Variables** y `BC_GOOGLE_CLIENT_SECRET` en **Secrets**. Si se intercambian, el workflow no los encuentra. Para builds locales, los mismos nombres van en un `.env` en la raíz del proyecto (copia de `.env.example`, ignorado por git), que `src-tauri/build.rs` lee al compilar.

### Google Calendar

1. En [Google Cloud Console](https://console.cloud.google.com/), dentro del proyecto de BetterCampus, habilita la **Google Calendar API**.
2. En la pantalla de consentimiento (*Google Auth Platform*), agrega el alcance `https://www.googleapis.com/auth/calendar.app.created` además de `openid`, `email` y `profile`.
3. Crea un cliente OAuth de tipo **App de escritorio**. No necesita URIs de redirección: la app usa `http://127.0.0.1:<puerto aleatorio>`, que Google acepta para este tipo de cliente.
4. Guarda su ID y su secret como se indica en la tabla. El secret de un cliente de escritorio no se considera confidencial, porque viaja dentro del binario. La seguridad del flujo la da PKCE.

Mientras la app esté en estado **Prueba**, solo pueden conectarse las cuentas agregadas como usuarios de prueba, y Google invalida la sesión a los 7 días: la app pide conectar de nuevo. Para que funcione con cualquier cuenta, publica la app en producción. Si Google marca el alcance como sensible, tendrás que pasar su verificación.

## Actualizaciones de la app

Las apps instaladas se actualizan con [`tauri-plugin-updater`](https://v2.tauri.app/plugin/updater/):

1. En el release, `tauri-action` compila con `--config src-tauri/tauri.release.conf.json`, que activa `createUpdaterArtifacts`. Así, cada instalador sale con su firma `.sig`, y se sube al release un `latest.json` con la versión y la URL y la firma de cada plataforma.
2. La app consulta `releases/latest/download/latest.json` (`plugins.updater.endpoints` en `tauri.conf.json`). `releases/latest` solo apunta al último release publicado que no sea *pre-release*.
3. Antes de instalar, la app verifica la firma con la llave pública de `plugins.updater.pubkey`. Un paquete que no esté firmado con la llave privada del proyecto se rechaza.

| Plataforma | Qué se instala |
| --- | --- |
| Windows | El instalador NSIS (`*-setup.exe`) o el `.msi`, en modo pasivo. La app se cierra mientras se instala. |
| macOS | El `.app.tar.gz` |
| Linux | El mismo formato con el que se instaló: AppImage, `.deb` o `.rpm`. Para `.deb` y `.rpm` el sistema pide la contraseña. |

### Llaves de firma

Es un par de llaves [minisign](https://jedisct1.github.io/minisign/). No sirven las llaves SSH ni las de GPG.

```bash
npx tauri signer generate -w ~/.tauri/bettercampus.key   # desde la carpeta del proyecto
```

| Dónde | Qué |
| --- | --- |
| `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` | Contenido de `bettercampus.key.pub` (es pública y va en el repositorio) |
| Secret `TAURI_SIGNING_PRIVATE_KEY` | Contenido de `bettercampus.key` |
| Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | La contraseña de la llave |

- **Respaldo**: la llave privada y su contraseña están guardadas en el gestor de contraseñas de los mantenedores. Si se pierden, las copias instaladas no pueden volver a actualizarse solas: habría que publicar una versión con una llave nueva y pedir que se instale a mano.
- **Si se filtra la llave privada**: genera un par nuevo, actualiza `pubkey` y los secrets, y publica una versión. Las copias que ya tienen la llave anterior seguirían aceptando paquetes firmados con la filtrada, así que avisa a los usuarios para que instalen esa versión a mano.
- **Comprobaciones**: el workflow falla si `pubkey` está vacía, y el bundler falla si la llave privada no corresponde a la pública.
- **Builds locales**: `npm run app:build` no usa `tauri.release.conf.json`, así que no firma y no necesita las llaves.

### Probar una actualización

- **Interfaz**: `npm run dev` y abrir `/?update`, que simula una versión 0.2.0 con descarga e instalación.
- **De punta a punta**: instala una versión publicada, publica la siguiente y abre la app. El diálogo aparece unos segundos después de abrirla. Las builds de desarrollo (`npm run app:dev`) no buscan actualizaciones al abrir.

## Pendiente para versiones futuras

- **TO-DO · Integraciones**:
  - Publicar la pantalla de consentimiento de Google en producción (y pasar la verificación si la pide) para que cualquier cuenta pueda exportar a Google Calendar. Ver [Google Calendar](#google-calendar).
  - Definir `BC_STATS_API_URL` con la URL pública de la API de cupos para que los releases incluyan el histórico de cupos.
- **Firma de código**: sin certificado, Windows SmartScreen y macOS Gatekeeper muestran una advertencia al primer arranque. Para Windows se puede usar un certificado OV/EV o Azure Trusted Signing. Para macOS, una cuenta de Apple Developer más notarización. Ambos se configuran en `tauri-action` con secrets.
