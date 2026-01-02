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

    // Find whisper-cli: check bundled sidecar location first, then PATH
    let whisper_bin = find_binary("whisper-cli")?;

    let output = StdCommand::new(&whisper_bin)
        .args([
            "-m",
            model_path.to_str().unwrap(),
            "-l",
            &language,
            "-np",
            "-nt",
            "-f",
            &audio_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run whisper-cli: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Whisper failed: {stderr}"));
    }

    let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(text)
}

#[tauri::command]
fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    // Write to clipboard
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("Clipboard error: {e}"))?;

    // Small delay for clipboard to be ready
    std::thread::sleep(std::time::Duration::from_millis(50));

    // Simulate Cmd+V (macOS) or Ctrl+V (Windows/Linux)
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
    // Quick TCP check if VS Code WebSocket server is listening
    std::net::TcpStream::connect_timeout(
        &"127.0.0.1:19542".parse().unwrap(),
        std::time::Duration::from_millis(200),
    )
    .is_ok()
}

fn find_binary(name: &str) -> Result<String, String> {
    // Check common locations for bundled binary
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    if let Some(dir) = &exe_dir {
        // macOS: binary is in Contents/MacOS/ alongside the app
        let candidate = dir.join(name);
        if candidate.exists() {
            return Ok(candidate.to_string_lossy().to_string());
        }
    }

    // Fall back to system PATH
    let which = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let output = StdCommand::new(which)
        .arg(name)
        .output()
        .map_err(|_| format!("{name} not found"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!("{name} not found. Make sure it's installed or bundled."))
    }
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
            // Register global shortcut: Cmd+Shift+Y (macOS) / Ctrl+Shift+Y
            #[cfg(target_os = "macos")]
            let shortcut: Shortcut = "CommandOrControl+Shift+Y".parse().unwrap();
            #[cfg(not(target_os = "macos"))]
            let shortcut: Shortcut = "Ctrl+Shift+Y".parse().unwrap();

            let app_handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == ShortcutState::Pressed {
                    let _ = app_handle.emit("toggle-dictation", ());
                }
            })?;

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
