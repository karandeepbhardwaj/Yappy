use std::process::{Child, Command};
use tauri::{AppHandle, Emitter};

pub struct RecordingHandle {
    child: Child,
    wav_path: String,
}

pub fn start(app: &AppHandle) -> Result<RecordingHandle, Box<dyn std::error::Error>> {
    let tmp_dir = std::env::temp_dir();
    let wav_path = tmp_dir
        .join(format!("sunyapper_{}.wav", std::process::id()))
        .to_string_lossy()
        .to_string();

    // Find rec/sox binary
    let (cmd, args) = if cfg!(target_os = "windows") {
        let sox = super::find_binary("sox").map_err(|e| e)?;
        (
            sox,
            vec![
                "-d".to_string(),
                "-r".to_string(),
                "16000".to_string(),
                "-c".to_string(),
                "1".to_string(),
                "-b".to_string(),
                "16".to_string(),
                "-e".to_string(),
                "signed-integer".to_string(),
                wav_path.clone(),
            ],
        )
    } else {
        let rec = super::find_binary("rec").map_err(|e| e)?;
        (
            rec,
            vec![
                "-r".to_string(),
                "16000".to_string(),
                "-c".to_string(),
                "1".to_string(),
                "-b".to_string(),
                "16".to_string(),
                "-e".to_string(),
                "signed-integer".to_string(),
                wav_path.clone(),
            ],
        )
    };

    let child = Command::new(&cmd)
        .args(&args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start {cmd}: {e}"))?;

    // Emit recording started event
    let _ = app.emit("recording-started", ());

    Ok(RecordingHandle { child, wav_path })
}

pub fn stop(mut handle: RecordingHandle) -> Result<String, Box<dyn std::error::Error>> {
    // Send SIGINT for graceful stop (sox writes WAV header)
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            libc::kill(handle.child.id() as libc::pid_t, libc::SIGINT);
        }
    }

    #[cfg(windows)]
    {
        let _ = handle.child.kill();
    }

    // Wait for process to finish writing
    let _ = handle.child.wait();

    // Verify file exists and has audio data
    let metadata = std::fs::metadata(&handle.wav_path)?;
    if metadata.len() <= 44 {
        return Err("No audio captured".into());
    }

    Ok(handle.wav_path)
}
