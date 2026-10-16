mod commands;
mod state;

use tauri::Manager;

use commands::*;

pub fn run() {
    let builder = tauri::Builder::default()
        // Must be registered first: a second launch focuses the running window and exits.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .level_for("html5ever", log::LevelFilter::Warn)
                .level_for("selectors", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build());

    // Updates come from GitHub Releases (`plugins.updater` in tauri.conf.json); the frontend drives them.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let state = state::AppState::new(dir).map_err(|e| e.to_string())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            system::app_info,
            system::settings_get,
            system::settings_set,
            system::cache_clear,
            system::data_reset,
            catalog::catalog_levels,
            catalog::catalog_campuses,
            catalog::catalog_faculties,
            catalog::catalog_plans,
            catalog::catalog_courses,
            catalog::sia_cancel,
            library::library_list,
            library::library_fetch,
            library::library_refresh,
            library::library_save_manual,
            library::library_remove,
            library::library_set_color,
            library::favorites_toggle,
            schedules::schedules_list,
            schedules::schedule_create,
            schedules::schedule_save,
            schedules::schedule_duplicate,
            schedules::schedule_delete,
            schedules::schedules_reorder,
            schedules::schedules_generate,
            academic::history_parse,
            academic::history_latest,
            academic::history_clear,
            academic::calc_papa_after,
            academic::calc_papi_for,
            academic::calc_max_papa,
            curriculum::plans_list,
            curriculum::plan_fetch,
            curriculum::plan_delete,
            curriculum::plan_graph,
            integrations::professor_lookup,
            integrations::stats_inscriptions,
            integrations::export_ics,
            integrations::google_status,
            integrations::google_connect,
            integrations::google_disconnect,
            integrations::google_export,
        ])
        .run(tauri::generate_context!())
        .expect("error while running BetterCampus");
}
