// Tauri build script — runs tauri-build's codegen (capabilities,
// embedded assets, generated types). Keep empty apart from the call;
// custom build steps go here later if/when we need them.
fn main() {
    tauri_build::build();
}
