use super::{ActionDefinition, ActionResult, AppPlugin, ParamDef};
use std::process::Command;

pub struct OutlookPlugin;

impl AppPlugin for OutlookPlugin {
    fn id(&self) -> &str { "outlook" }
    fn name(&self) -> &str { "Microsoft Outlook" }
    fn platforms(&self) -> &[&str] { &["macos", "windows"] }

    fn actions(&self) -> Vec<ActionDefinition> {
        vec![
            ActionDefinition {
                id: "next_meeting".into(), name: "Next Meeting".into(),
                description: "Get details of your next calendar meeting".into(),
                params: vec![],
                risk: "safe".into(),
            },
            ActionDefinition {
                id: "latest_message".into(), name: "Latest Message".into(),
                description: "Get the subject and sender of your latest email".into(),
                params: vec![],
                risk: "safe".into(),
            },
            ActionDefinition {
                id: "reply_message".into(), name: "Reply to Latest".into(),
                description: "Open reply window for the latest email".into(),
                params: vec![],
                risk: "safe".into(),
            },
            ActionDefinition {
                id: "write_message".into(), name: "Write Message".into(),
                description: "Compose a new email (copies body to clipboard)".into(),
                params: vec![
                    ParamDef { name: "body".into(), description: "Email body text".into(), required: true },
                    ParamDef { name: "to".into(), description: "Recipient email".into(), required: false },
                    ParamDef { name: "subject".into(), description: "Email subject".into(), required: false },
                ],
                risk: "safe".into(),
            },
        ]
    }

    fn execute(&self, action_id: &str, params: &serde_json::Value) -> ActionResult {
        match action_id {
            "next_meeting" => get_next_meeting(),
            "latest_message" => get_latest_message(),
            "reply_message" => reply_latest_message(),
            "write_message" => {
                let body = params["body"].as_str().unwrap_or("");
                let to = params["to"].as_str().unwrap_or("");
                let subject = params["subject"].as_str().unwrap_or("");
                write_message(body, to, subject)
            }
            _ => ActionResult { success: false, message: format!("Unknown action: {action_id}") },
        }
    }

    fn is_available(&self) -> bool {
        #[cfg(target_os = "macos")]
        { std::path::Path::new("/Applications/Microsoft Outlook.app").exists() }
        #[cfg(target_os = "windows")]
        { true }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        { false }
    }
}

fn get_next_meeting() -> ActionResult {
    #[cfg(target_os = "macos")]
    {
        let script = r#"tell application "Microsoft Outlook"
            set calEvents to calendar events of default calendar
            set nextEvent to missing value
            set nowDate to current date
            repeat with evt in calEvents
                if start time of evt > nowDate then
                    if nextEvent is missing value or start time of evt < start time of nextEvent then
                        set nextEvent to evt
                    end if
                end if
            end repeat
            if nextEvent is not missing value then
                return subject of nextEvent & " at " & start time of nextEvent
            else
                return "No upcoming meetings"
            end if
        end tell"#;
        run_osascript(script)
    }
    #[cfg(target_os = "windows")]
    {
        let ps = r#"$ol = New-Object -ComObject Outlook.Application; $ns = $ol.GetNamespace('MAPI'); $cal = $ns.GetDefaultFolder(9); $items = $cal.Items; $items.Sort('[Start]'); $items.IncludeRecurrences = $true; $now = Get-Date; $filter = "[Start] >= '$($now.ToString('g'))' AND [Start] <= '$($now.AddDays(1).ToString('g'))'"; $next = $items.Restrict($filter) | Select-Object -First 1; if ($next) { Write-Output "$($next.Subject) at $($next.Start)" } else { Write-Output 'No upcoming meetings' }"#;
        run_powershell(ps)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { ActionResult { success: false, message: "Platform not supported".into() } }
}

fn get_latest_message() -> ActionResult {
    #[cfg(target_os = "macos")]
    {
        let script = r#"tell application "Microsoft Outlook"
            set msgs to messages of inbox
            if (count of msgs) > 0 then
                set latestMsg to item 1 of msgs
                return "From: " & (sender of latestMsg as string) & " — Subject: " & subject of latestMsg
            else
                return "No messages in inbox"
            end if
        end tell"#;
        run_osascript(script)
    }
    #[cfg(target_os = "windows")]
    {
        let ps = r#"$ol = New-Object -ComObject Outlook.Application; $ns = $ol.GetNamespace('MAPI'); $inbox = $ns.GetDefaultFolder(6); $msg = $inbox.Items | Select-Object -First 1; if ($msg) { Write-Output "From: $($msg.SenderName) — Subject: $($msg.Subject)" } else { Write-Output 'No messages' }"#;
        run_powershell(ps)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { ActionResult { success: false, message: "Platform not supported".into() } }
}

fn reply_latest_message() -> ActionResult {
    #[cfg(target_os = "macos")]
    {
        let script = r#"tell application "Microsoft Outlook"
            activate
            set msgs to messages of inbox
            if (count of msgs) > 0 then
                set latestMsg to item 1 of msgs
                reply to latestMsg
                return "Reply window opened"
            else
                return "No messages to reply to"
            end if
        end tell"#;
        run_osascript(script)
    }
    #[cfg(target_os = "windows")]
    {
        let ps = r#"$ol = New-Object -ComObject Outlook.Application; $ns = $ol.GetNamespace('MAPI'); $inbox = $ns.GetDefaultFolder(6); $msg = $inbox.Items | Select-Object -First 1; if ($msg) { $reply = $msg.Reply(); $reply.Display(); Write-Output 'Reply window opened' } else { Write-Output 'No messages' }"#;
        run_powershell(ps)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { ActionResult { success: false, message: "Platform not supported".into() } }
}

fn write_message(body: &str, to: &str, subject: &str) -> ActionResult {
    #[cfg(target_os = "macos")]
    {
        use std::io::Write as IoWrite;
        let mut child = Command::new("pbcopy").stdin(std::process::Stdio::piped()).spawn().unwrap();
        child.stdin.as_mut().unwrap().write_all(body.as_bytes()).ok();
        child.wait().ok();

        if !to.is_empty() || !subject.is_empty() {
            let escaped_subject = subject.replace('"', r#"\""#);
            let escaped_to = to.replace('"', r#"\""#);
            let escaped_body = body.replace('"', r#"\""#);
            let script = format!(
                r#"tell application "Microsoft Outlook"
                    activate
                    set newMsg to make new outgoing message with properties {{subject:"{}", content:"{}"}}
                    if "{}" is not "" then
                        make new to recipient at newMsg with properties {{email address:{{address:"{}"}}}}
                    end if
                    open newMsg
                end tell"#,
                escaped_subject, escaped_body, escaped_to, escaped_to
            );
            Command::new("osascript").args(["-e", &script]).output().ok();
        }

        ActionResult { success: true, message: "Message body copied to clipboard. Paste with Cmd+V.".into() }
    }
    #[cfg(target_os = "windows")]
    {
        use std::io::Write as IoWrite;
        let mut child = Command::new("clip").stdin(std::process::Stdio::piped()).spawn().unwrap();
        child.stdin.as_mut().unwrap().write_all(body.as_bytes()).ok();
        child.wait().ok();
        ActionResult { success: true, message: "Message body copied to clipboard. Paste with Ctrl+V.".into() }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    { ActionResult { success: false, message: "Platform not supported".into() } }
}

#[cfg(target_os = "macos")]
fn run_osascript(script: &str) -> ActionResult {
    match Command::new("osascript").args(["-e", script]).output() {
        Ok(out) if out.status.success() => {
            let msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
            ActionResult { success: true, message: if msg.is_empty() { "Done".into() } else { msg } }
        }
        Ok(out) => ActionResult { success: false, message: String::from_utf8_lossy(&out.stderr).trim().to_string() },
        Err(e) => ActionResult { success: false, message: format!("osascript failed: {e}") },
    }
}

#[cfg(target_os = "windows")]
fn run_powershell(script: &str) -> ActionResult {
    match Command::new("powershell").args(["-NoProfile", "-Command", script]).output() {
        Ok(out) if out.status.success() => {
            let msg = String::from_utf8_lossy(&out.stdout).trim().to_string();
            ActionResult { success: true, message: if msg.is_empty() { "Done".into() } else { msg } }
        }
        Ok(out) => ActionResult { success: false, message: String::from_utf8_lossy(&out.stderr).trim().to_string() },
        Err(e) => ActionResult { success: false, message: format!("PowerShell failed: {e}") },
    }
}
