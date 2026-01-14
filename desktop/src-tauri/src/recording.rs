use std::process::{Child, Command};
use tauri::{AppHandle, Emitter};

pub struct RecordingHandle {
    child: Child,
    pub wav_path: String,
}

pub fn start(app: &AppHandle) -> Result<RecordingHandle, Box<dyn std::error::Error>> {
    let wav_path = std::env::temp_dir()
        .join(format!("sunyapper_{}.wav", std::process::id()))
        .to_string_lossy()
        .to_string();

    // Resolve rec sidecar
    let rec_bin = super::resolve_sidecar(app, "rec")
        .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;

    let child = Command::new(&rec_bin)
        .args([
            "-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer", &wav_path,
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start rec: {e}"))?;

    let _ = app.emit("recording-started", ());

    Ok(RecordingHandle { child, wav_path })
}

pub fn stop(mut handle: RecordingHandle) -> Result<String, Box<dyn std::error::Error>> {
    #[cfg(unix)]
    unsafe {
        libc::kill(handle.child.id() as libc::pid_t, libc::SIGINT);
    }

    #[cfg(windows)]
    {
        let _ = handle.child.kill();
    }

    let _ = handle.child.wait();

    let metadata = std::fs::metadata(&handle.wav_path)?;
    if metadata.len() <= 44 {
        return Err("No audio captured".into());
    }

    Ok(handle.wav_path)
}
