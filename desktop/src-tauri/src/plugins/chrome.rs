use super::{ActionDefinition, ActionResult, AppPlugin, ParamDef};
use std::process::Command;

pub struct ChromePlugin;

impl AppPlugin for ChromePlugin {
    fn id(&self) -> &str { "chrome" }
    fn name(&self) -> &str { "Google Chrome" }
    fn platforms(&self) -> &[&str] { &["macos", "windows"] }

    fn actions(&self) -> Vec<ActionDefinition> {
        vec![
            ActionDefinition {
                id: "open_url".into(), name: "Open URL".into(),
                description: "Open a URL in Chrome".into(),
                params: vec![ParamDef { name: "url".into(), description: "URL to open".into(), required: true }],
                risk: "safe".into(),
            },
            ActionDefinition {
                id: "search".into(), name: "Search Google".into(),
                description: "Search Google in Chrome".into(),
                params: vec![ParamDef { name: "query".into(), description: "Search query".into(), required: true }],
                risk: "safe".into(),
            },
            ActionDefinition {
                id: "new_tab".into(), name: "New Tab".into(),
                description: "Open a new empty tab in Chrome".into(),
                params: vec![],
                risk: "safe".into(),
            },
        ]
    }

    fn execute(&self, action_id: &str, params: &serde_json::Value) -> ActionResult {
        match action_id {
            "open_url" => {
                let url = params["url"].as_str().unwrap_or("https://google.com");
                open_chrome_url(url)
            }
            "search" => {
                let query = params["query"].as_str().unwrap_or("");
                let url = format!("https://www.google.com/search?q={}", urlencoding(query));
                open_chrome_url(&url)
            }
            "new_tab" => open_chrome_url("chrome://newtab"),
            _ => ActionResult { success: false, message: format!("Unknown action: {action_id}") },
        }
    }

    fn is_available(&self) -> bool {
        #[cfg(target_os = "macos")]
        { std::path::Path::new("/Applications/Google Chrome.app").exists() }
        #[cfg(target_os = "windows")]
        { true }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        { false }
    }
}

fn urlencoding(s: &str) -> String {
    s.replace(' ', "+").replace('&', "%26").replace('=', "%3D")
}

fn open_chrome_url(url: &str) -> ActionResult {
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            r#"tell application "Google Chrome"
                activate
                if (count of windows) = 0 then
                    make new window
                end if
                tell front window to make new tab with properties {{URL:"{}"}}
            end tell"#,
            url
        );
        match Command::new("osascript").args(["-e", &script]).output() {
            Ok(out) if out.status.success() => ActionResult { success: true, message: format!("Opened in Chrome: {url}") },
            Ok(out) => ActionResult { success: false, message: String::from_utf8_lossy(&out.stderr).to_string() },
            Err(e) => ActionResult { success: false, message: format!("Failed: {e}") },
        }
    }
    #[cfg(target_os = "windows")]
    {
        match Command::new("cmd").args(["/c", "start", "chrome", url]).output() {
            Ok(_) => ActionResult { success: true, message: format!("Opened in Chrome: {url}") },
            Err(e) => ActionResult { success: false, message: format!("Failed: {e}") },
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { ActionResult { success: false, message: "Platform not supported".into() } }
}
