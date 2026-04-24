// Prevents an extra console window from opening on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    druz9_copilot_tauri_poc::run();
}
