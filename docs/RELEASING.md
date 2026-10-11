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
5. Cuando el workflow termine, revisa el borrador en Releases: prueba al menos el instalador de Windows, pega las notas del changelog y publícalo.

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

Se configuran en *Settings › Secrets and variables › Actions*. Todas son opcionales: sin ellas, la función correspondiente se configura desde Ajustes dentro de la app.

| Nombre | Tipo | Uso |
| --- | --- | --- |
| `BC_GOOGLE_CLIENT_ID` | Variable | Client ID del cliente OAuth "App de escritorio" |
| `BC_GOOGLE_CLIENT_SECRET` | Secret | Secret del mismo cliente |
| `BC_STATS_API_URL` | Variable | URL base de la API de cupos |

## Pendiente para versiones futuras

- **Firma de código**: sin certificado, Windows SmartScreen y macOS Gatekeeper muestran una advertencia al primer arranque. Para Windows se puede usar un certificado OV/EV o Azure Trusted Signing. Para macOS, una cuenta de Apple Developer más notarización. Ambos se configuran en `tauri-action` con secrets.
- **Actualizaciones automáticas**: agregar `tauri-plugin-updater`, generar un par de llaves con `npm run tauri signer generate`, poner la llave pública en `tauri.conf.json`, guardar `TAURI_SIGNING_PRIVATE_KEY` como secret y activar `createUpdaterArtifacts`.
