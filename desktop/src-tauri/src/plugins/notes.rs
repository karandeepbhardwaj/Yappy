use super::{ActionDefinition, ActionResult, AppPlugin, ParamDef};
use std::process::Command;

pub struct NotesPlugin;

impl AppPlugin for NotesPlugin {
    fn id(&self) -> &str { "notes" }
    fn name(&self) -> &str { if cfg!(target_os = "macos") { "Apple Notes" } else { "Notepad" } }
    fn platforms(&self) -> &[&str] { &["macos", "windows"] }

    fn actions(&self) -> Vec<ActionDefinition> {
        vec![
            ActionDefinition {
                id: "create_note".into(), name: "Create Note".into(),
                description: "Create a new note with text".into(),
                params: vec![ParamDef { name: "text".into(), description: "Note content".into(), required: true }],
                risk: "safe".into(),
            },
            ActionDefinition {
                id: "write_text".into(), name: "Write Text".into(),
                description: "Copy text to clipboard for pasting".into(),
                params: vec![ParamDef { name: "text".into(), description: "Text to write".into(), required: true }],
                risk: "safe".into(),
            },
        ]
    }

    fn execute(&self, action_id: &str, params: &serde_json::Value) -> ActionResult {
        let text = params["text"].as_str().unwrap_or("");
        match action_id {
            "create_note" => create_note(text),
            "write_text" => write_to_clipboard(text),
            _ => ActionResult { success: false, message: format!("Unknown action: {action_id}") },
        }
    }

    fn is_available(&self) -> bool { true }
}

fn create_note(text: &str) -> ActionResult {
    #[cfg(target_os = "macos")]
    {
        let escaped = text.replace('"', r#"\""#).replace('\\', "\\\\");
        let script = format!(
            r#"tell application "Notes"
                activate
                tell account "iCloud"
                    make new note at folder "Notes" with properties {{body:"{}"}}
                end tell
            end tell"#,
            escaped
        );
        match Command::new("osascript").args(["-e", &script]).output() {
            Ok(out) if out.status.success() => ActionResult { success: true, message: "Note created in Apple Notes".into() },
            Ok(out) => ActionResult { success: false, message: String::from_utf8_lossy(&out.stderr).to_string() },
            Err(e) => ActionResult { success: false, message: format!("Failed: {e}") },
        }
    }
    #[cfg(target_os = "windows")]
    {
        let tmp = std::env::temp_dir().join("yapper_note.txt");
        if std::fs::write(&tmp, text).is_ok() {
            match Command::new("notepad.exe").arg(&tmp).spawn() {
                Ok(_) => ActionResult { success: true, message: "Opened in Notepad".into() },
                Err(e) => ActionResult { success: false, message: format!("Failed: {e}") },
            }
        } else {
            ActionResult { success: false, message: "Failed to write temp file".into() }
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { ActionResult { success: false, message: "Platform not supported".into() } }
}

fn write_to_clipboard(text: &str) -> ActionResult {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        let mut child = Command::new("pbcopy").stdin(std::process::Stdio::piped()).spawn().map_err(|e| e.to_string()).unwrap();
        child.stdin.as_mut().unwrap().write_all(text.as_bytes()).ok();
        child.wait().ok();
        ActionResult { success: true, message: "Text copied to clipboard. Paste with Cmd+V.".into() }
    }
    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        let mut child = Command::new("clip").stdin(std::process::Stdio::piped()).spawn().map_err(|e| e.to_string()).unwrap();
        child.stdin.as_mut().unwrap().write_all(text.as_bytes()).ok();
        child.wait().ok();
        ActionResult { success: true, message: "Text copied to clipboard. Paste with Ctrl+V.".into() }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { ActionResult { success: false, message: "Platform not supported".into() } }
}
