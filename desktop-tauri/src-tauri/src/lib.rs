// Tauri 2.0 POC library entry point. Single window with macOS vibrancy.
//
// Why this crate exists separately from main.rs: Tauri codegen prefers
// a library target so the same setup code can be reused by mobile
// targets later without duplicating. For this POC that's overkill, but
// cargo generate's template expects this structure and fighting it
// costs more than going along.

use tauri::Manager;
// NOTE: window_vibrancy imports intentionally removed. User feedback:
// the frosted-glass look was too heavy. Keeping the window transparent
// (via tauri.conf.json `transparent: true`) so content behind shows
// crisply through the RGBA card — no blur, just a tinted pane.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // Vibrancy removed per user request. Window stays
            // transparent (tauri.conf.json `transparent: true`);
            // the RGBA background on the React card produces a
            // crisp tinted-glass effect — desktop content behind is
            // visible without blur.
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
