use std::process::Command as StdCommand;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

mod copilot;
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
        Some(handle) => {
            // Stop recording — returns the final segment WAV path
            // Do NOT cleanup yet — the caller needs to transcribe this file first
            recording::stop(handle).map_err(|e| e.to_string())
        }
        None => Err("Not recording".into()),
    }
}

#[tauri::command]
fn cleanup_recording_files() {
    recording::cleanup_segments();
}

/// Rotate current recording segment and transcribe it.
/// Returns the interim transcription text for the completed segment.
#[tauri::command]
fn interim_transcribe(state: State<AppState>, app: AppHandle, language: String) -> Result<String, String> {
    let mut rec = state.recording.lock().map_err(|e| e.to_string())?;
    let handle = rec.as_mut().ok_or("Not recording")?;

    // Rotate: stop current segment, start new one, get completed WAV path
    let segment_path = recording::rotate_segment(handle).map_err(|e| e.to_string())?;

    // Transcribe the completed segment (using tiny model for speed)
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("No resource dir: {e}"))?;

    // Try tiny model first for speed, fall back to base
    let model_path = {
        let tiny = resource_dir.join("resources").join("models").join("ggml-tiny.bin");
        let base = resource_dir.join("resources").join("models").join("ggml-base.bin");
        let tiny_alt = resource_dir.join("models").join("ggml-tiny.bin");
        let base_alt = resource_dir.join("models").join("ggml-base.bin");
        if tiny.exists() { tiny }
        else if tiny_alt.exists() { tiny_alt }
        else if base.exists() { base }
        else if base_alt.exists() { base_alt }
        else { return Err("No model found".into()); }
    };

    let whisper_bin = resolve_sidecar(&app, "whisper-cli")?;

    let resource_lib = if resource_dir.join("binaries").join("lib").exists() {
        resource_dir.join("binaries").join("lib")
    } else {
        resource_dir.join("resources").join("binaries").join("lib")
    };
    let exe_lib = whisper_bin.parent().map(|p| p.join("lib")).unwrap_or_default();
    let lib_path = if resource_lib.exists() { resource_lib } else { exe_lib };

    let mut cmd = std::process::Command::new(&whisper_bin);
    let mut args = vec!["-m".to_string(), model_path.to_str().unwrap().to_string(), "-np".to_string(), "-nt".to_string()];
    if !language.is_empty() && language != "auto" {
        args.push("-l".to_string());
        args.push(language.clone());
    }
    if language != "en" {
        args.push("-tr".to_string());
    }
    args.push("-f".to_string());
    args.push(segment_path.clone());
    cmd.args(&args);

    if lib_path.exists() {
        #[cfg(target_os = "macos")]
        cmd.env("DYLD_LIBRARY_PATH", &lib_path);
        #[cfg(target_os = "linux")]
        cmd.env("LD_LIBRARY_PATH", &lib_path);
    }

    let output = cmd.output().map_err(|e| format!("Whisper failed: {e}"))?;

    // Clean up segment file
    let _ = std::fs::remove_file(&segment_path);

    if !output.status.success() {
        return Err("Interim transcription failed".into());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[tauri::command]
fn transcribe(app: AppHandle, audio_path: String, language: String) -> Result<String, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("No resource dir: {e}"))?;

    // Tauri nests resources under resources/ subdirectory in the bundle
    let model_path = resource_dir.join("resources").join("models").join("ggml-base.bin");
    let model_path = if model_path.exists() {
        model_path
    } else {
        // Fallback: direct path (dev mode)
        let alt = resource_dir.join("models").join("ggml-base.bin");
        if alt.exists() {
            alt
        } else {
            return Err(format!("Model not found. Checked:\n  {}\n  {}", model_path.display(), alt.display()));
        }
    };

    let whisper_bin = resolve_sidecar(&app, "whisper-cli")?;

    // Dylibs are in Resources/binaries/lib/ (or Resources/resources/binaries/lib/) in the .app bundle
    let resource_lib = if resource_dir.join("binaries").join("lib").exists() {
        resource_dir.join("binaries").join("lib")
    } else {
        resource_dir.join("resources").join("binaries").join("lib")    // Tauri nesting
    };
    // Also check next to the binary
    let exe_lib = whisper_bin
        .parent()
        .map(|p| p.join("lib"))
        .unwrap_or_default();

    let mut cmd = StdCommand::new(&whisper_bin);

    // Base args
    let mut args = vec![
        "-m".to_string(),
        model_path.to_str().unwrap().to_string(),
        "-np".to_string(),
        "-nt".to_string(),
    ];

    // Force language if not auto
    if !language.is_empty() && language != "auto" {
        args.push("-l".to_string());
        args.push(language.clone());
    }

    // Translate non-English to English using whisper's built-in translation
    if language != "en" {
        args.push("-tr".to_string());
    }

    args.push("-f".to_string());
    args.push(audio_path.clone());

    cmd.args(&args);

    // Set library path — check both possible locations
    let lib_path = if resource_lib.exists() {
        resource_lib
    } else {
        exe_lib
    };
    if lib_path.exists() {
        #[cfg(target_os = "macos")]
        cmd.env("DYLD_LIBRARY_PATH", &lib_path);
        #[cfg(target_os = "linux")]
        cmd.env("LD_LIBRARY_PATH", &lib_path);
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
fn refine_via_copilot(text: String, language: String, model: String) -> Result<String, String> {
    copilot::refine_text(&text, &language, &model)
}

#[tauri::command]
fn paste_text(app: AppHandle, text: String) -> Result<(), String> {
    // Copy text to system clipboard
    app.clipboard()
        .write_text(&text)
        .map_err(|e| format!("Clipboard error: {e}"))?;
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

fn resolve_sidecar(_app: &AppHandle, name: &str) -> Result<std::path::PathBuf, String> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()));

    if let Some(dir) = &exe_dir {
        let triple = built_target_triple();
        let suffixed = dir.join(format!("{name}-{triple}"));
        if suffixed.exists() {
            return Ok(suffixed);
        }
        let plain = dir.join(name);
        if plain.exists() {
            return Ok(plain);
        }
    }

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
            // Global shortcut
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
            cleanup_recording_files,
            interim_transcribe,
            transcribe,
            refine_via_copilot,
            paste_text,
            check_vscode_connection,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
