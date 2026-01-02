use std::process::Command as StdCommand;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

mod recording;

struct AppState {
    recording: Mutex<Option<recording::RecordingHandle>>,
}

#[tauri::command]
fn start_recording(state: State<AppState>, app: AppHandle) -> Result<(), String> {
    let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
    if rec.is_some() {
        return Err("Already recording".into());
    }
    let handle = recording::start(&app).map_err(|e| e.to_string())?;
    *rec = Some(handle);
    Ok(())
}

#[tauri::command]
fn stop_recording(state: State<AppState>) -> Result<String, String> {
    let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
    match rec.take() {
        Some(handle) => recording::stop(handle).map_err(|e| e.to_string()),
        None => Err("Not recording".into()),
    }
}

#[tauri::command]
fn transcribe(app: AppHandle, audio_path: String, language: String) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("No resource dir: {e}"))?;

    let model_path = resource_dir.join("models").join("ggml-base.bin");
    if !model_path.exists() {
        return Err(format!("Model not found at {}", model_path.display()));
    }

    // Resolve whisper-cli sidecar path
    let whisper_bin = resolve_sidecar(&app, "whisper-cli")?;

    // The bundled dylibs are in a lib/ directory next to the sidecar binary
    let lib_dir = whisper_bin
        .parent()
        .map(|p| p.join("lib"))
        .unwrap_or_default();

    let mut cmd = StdCommand::new(&whisper_bin);
    cmd.args([
        "-m",
        model_path.to_str().unwrap(),
        "-l",
        &language,
        "-np",
        "-nt",
        "-f",
        &audio_path,
    ]);

    // Set library path so whisper-cli finds its dylibs
    if lib_dir.exists() {
        #[cfg(target_os = "macos")]
        cmd.env("DYLD_LIBRARY_PATH", &lib_dir);
        #[cfg(target_os = "linux")]
        cmd.env("LD_LIBRARY_PATH", &lib_dir);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run whisper-cli: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Whisper failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("Clipboard error: {e}"))?;

    std::thread::sleep(std::time::Duration::from_millis(50));

    use enigo::{Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| format!("Enigo error: {e}"))?;

    #[cfg(target_os = "macos")]
    {
        enigo.key(Key::Meta, enigo::Direction::Press).ok();
        enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
        enigo.key(Key::Meta, enigo::Direction::Release).ok();
    }

    #[cfg(not(target_os = "macos"))]
    {
        enigo.key(Key::Control, enigo::Direction::Press).ok();
        enigo.key(Key::Unicode('v'), enigo::Direction::Click).ok();
        enigo.key(Key::Control, enigo::Direction::Release).ok();
    }

    Ok(())
}

#[tauri::command]
fn check_vscode_connection() -> bool {
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:19542".parse().unwrap(),
        std::time::Duration::from_millis(200),
    )
    .is_ok()
}

/// Resolve a sidecar binary path. Tauri places sidecars next to the app binary
/// with the target triple appended (e.g., `whisper-cli-aarch64-apple-darwin`).
fn resolve_sidecar(app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    // In development, binaries are in src-tauri/binaries/
    // In production, they're in Contents/MacOS/ (macOS) or next to exe (Windows)
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    if let Some(dir) = &exe_dir {
        // Check for target-triple suffixed name (Tauri sidecar convention)
        let triple = built_target_triple();
        let suffixed = dir.join(format!("{name}-{triple}"));
        if suffixed.exists() {
            return Ok(suffixed);
        }

        // Check plain name (development)
        let plain = dir.join(name);
        if plain.exists() {
            return Ok(plain);
        }
    }

    // Fall back to system PATH
    let which = if cfg!(target_os = "windows") { "where" } else { "which" };
    let output = StdCommand::new(which)
        .arg(name)
        .output()
        .map_err(|_| format!("{name} not found"))?;

    if output.status.success() {
        Ok(std::path::PathBuf::from(
            String::from_utf8_lossy(&output.stdout).trim(),
        ))
    } else {
        Err(format!("{name} not found"))
    }
}

fn built_target_triple() -> &'static str {
    // Set by Cargo at compile time
    env!("TARGET", "unknown-unknown-unknown")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            recording: Mutex::new(None),
        })
        .setup(|app| {
            let shortcut: Shortcut = "CommandOrControl+Shift+Y".parse().unwrap();

            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(
                shortcut,
                move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = app_handle.emit("toggle-dictation", ());
                    }
                },
            )?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_recording,
            stop_recording,
            transcribe,
            paste_text,
            check_vscode_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
