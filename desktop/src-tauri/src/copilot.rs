use std::io::{Read, Write};
use std::net::TcpStream;

const VSCODE_WS_ADDR: &str = "127.0.0.1:19542";

/// Send raw text to VS Code's CopilotBridge for LLM refinement.
/// Uses a simple HTTP-upgraded WebSocket handshake, then a single JSON message exchange.
/// Returns the refined text, or the original text if VS Code is unreachable.
pub fn refine_text(raw_text: &str, language: &str) -> Result<String, String> {
    // Connect with a short timeout
    let stream = TcpStream::connect_timeout(
        &VSCODE_WS_ADDR.parse().unwrap(),
        std::time::Duration::from_secs(2),
    )
    .map_err(|e| format!("Cannot connect to VS Code: {e}"))?;

    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(30)))
        .ok();
    stream
        .set_write_timeout(Some(std::time::Duration::from_secs(5)))
        .ok();

    // WebSocket handshake
    let key = "dGhlIHNhbXBsZSBub25jZQ=="; // static key, fine for localhost
    let handshake = format!(
        "GET / HTTP/1.1\r\n\
         Host: {VSCODE_WS_ADDR}\r\n\
         Upgrade: websocket\r\n\
         Connection: Upgrade\r\n\
         Sec-WebSocket-Key: {key}\r\n\
         Sec-WebSocket-Version: 13\r\n\r\n"
    );

    let mut stream = stream;
    stream
        .write_all(handshake.as_bytes())
        .map_err(|e| format!("Handshake write failed: {e}"))?;

    // Read handshake response (we just need to consume it)
    let mut response = [0u8; 1024];
    let n = stream
        .read(&mut response)
        .map_err(|e| format!("Handshake read failed: {e}"))?;
    let resp_str = String::from_utf8_lossy(&response[..n]);
    if !resp_str.contains("101") {
        return Err(format!("WebSocket handshake failed: {resp_str}"));
    }

    // Send refinement request as a WebSocket text frame
    let id = uuid::Uuid::new_v4().to_string();
    let payload = serde_json::json!({
        "type": "refine",
        "id": id,
        "text": raw_text,
        "language": language
    })
    .to_string();

    write_ws_text_frame(&mut stream, &payload)?;

    // Read response frame
    let response_text = read_ws_text_frame(&mut stream)?;

    let parsed: serde_json::Value =
        serde_json::from_str(&response_text).map_err(|e| format!("Bad JSON: {e}"))?;

    if parsed["type"] == "refined" {
        Ok(parsed["text"]
            .as_str()
            .unwrap_or(raw_text)
            .to_string())
    } else if parsed["type"] == "error" {
        Err(parsed["message"]
            .as_str()
            .unwrap_or("Unknown error")
            .to_string())
    } else {
        Ok(raw_text.to_string())
    }
}

fn write_ws_text_frame(stream: &mut TcpStream, text: &str) -> Result<(), String> {
    let payload = text.as_bytes();
    let len = payload.len();

    let mut frame = Vec::new();
    frame.push(0x81); // FIN + text opcode

    // Mask bit must be set for client -> server frames
    if len < 126 {
        frame.push((len as u8) | 0x80);
    } else if len < 65536 {
        frame.push(126 | 0x80);
        frame.push((len >> 8) as u8);
        frame.push((len & 0xFF) as u8);
    } else {
        return Err("Payload too large".into());
    }

    // Masking key (simple, localhost only)
    let mask = [0x12, 0x34, 0x56, 0x78];
    frame.extend_from_slice(&mask);

    // Masked payload
    for (i, byte) in payload.iter().enumerate() {
        frame.push(byte ^ mask[i % 4]);
    }

    stream
        .write_all(&frame)
        .map_err(|e| format!("WS write failed: {e}"))?;
    Ok(())
}

fn read_ws_text_frame(stream: &mut TcpStream) -> Result<String, String> {
    let mut header = [0u8; 2];
    stream
        .read_exact(&mut header)
        .map_err(|e| format!("WS read header failed: {e}"))?;

    let len_byte = header[1] & 0x7F;
    let payload_len = if len_byte < 126 {
        len_byte as usize
    } else if len_byte == 126 {
        let mut ext = [0u8; 2];
        stream.read_exact(&mut ext).map_err(|e| e.to_string())?;
        ((ext[0] as usize) << 8) | (ext[1] as usize)
    } else {
        return Err("Payload too large".into());
    };

    // Server frames are not masked
    let mut payload = vec![0u8; payload_len];
    stream
        .read_exact(&mut payload)
        .map_err(|e| format!("WS read payload failed: {e}"))?;

    String::from_utf8(payload).map_err(|e| format!("Invalid UTF-8: {e}"))
}
