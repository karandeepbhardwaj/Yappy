use std::process::{Child, Command};
use tauri::AppHandle;

pub struct RecordingHandle {
    child: Child,
    pub wav_path: String,
    rec_bin: String,
    segment_counter: u32,
}

fn build_args(wav_path: &str) -> Vec<String> {
    #[cfg(windows)]
    let mut args = vec!["-d".to_string()];
    #[cfg(unix)]
    let mut args = vec![];
    args.extend(
        ["-r", "16000", "-c", "1", "-b", "16", "-e", "signed-integer"].map(String::from),
    );
    args.push(wav_path.to_string());
    args
}

fn segment_path(counter: u32) -> String {
    std::env::temp_dir()
        .join(format!("sunyapper_{}_{}.wav", std::process::id(), counter))
        .to_string_lossy()
        .to_string()
}

pub fn start(app: &AppHandle) -> Result<RecordingHandle, Box<dyn std::error::Error>> {
    let rec_bin = super::resolve_sidecar(app, "rec")
        .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?
        .to_string_lossy()
        .to_string();

    let wav_path = segment_path(0);
    let args = build_args(&wav_path);

    let child = Command::new(&rec_bin)
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start rec: {e}"))?;

    Ok(RecordingHandle {
        child,
        wav_path,
        rec_bin,
        segment_counter: 0,
    })
}

/// Stop current segment, return its WAV path, and start a new segment.
/// Returns the path to the completed segment WAV file.
pub fn rotate_segment(handle: &mut RecordingHandle) -> Result<String, Box<dyn std::error::Error>> {
    // Stop current recording
    stop_process(&mut handle.child);

    let completed_path = handle.wav_path.clone();

    // Verify the completed segment has audio
    let metadata = std::fs::metadata(&completed_path)?;
    if metadata.len() <= 44 {
        // No audio in this segment — start new one anyway
        handle.segment_counter += 1;
        handle.wav_path = segment_path(handle.segment_counter);
        let args = build_args(&handle.wav_path);
        handle.child = Command::new(&handle.rec_bin)
            .args(&args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        return Err("Empty segment".into());
    }

    // Start new segment
    handle.segment_counter += 1;
    handle.wav_path = segment_path(handle.segment_counter);
    let args = build_args(&handle.wav_path);
    handle.child = Command::new(&handle.rec_bin)
        .args(&args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to restart rec: {e}"))?;

    Ok(completed_path)
}

pub fn stop(mut handle: RecordingHandle) -> Result<String, Box<dyn std::error::Error>> {
    stop_process(&mut handle.child);

    let metadata = std::fs::metadata(&handle.wav_path)?;
    if metadata.len() <= 44 {
        return Err("No audio captured".into());
    }

    Ok(handle.wav_path)
}

fn stop_process(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        libc::kill(child.id() as libc::pid_t, libc::SIGINT);
    }

    #[cfg(windows)]
    {
        drop(child.stdin.take());
        std::thread::sleep(std::time::Duration::from_millis(500));
    }

    let _ = child.wait();
}

/// Clean up all temp segment files
pub fn cleanup_segments() {
    let tmp = std::env::temp_dir();
    let prefix = format!("sunyapper_{}_", std::process::id());
    if let Ok(entries) = std::fs::read_dir(&tmp) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&prefix) && name.ends_with(".wav") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}
