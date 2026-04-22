use anyhow::Result;
use async_trait::async_trait;

use super::{OutputMode, TextOutput};

#[cfg(not(target_os = "linux"))]
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

/// Maximum characters per enigo.text() call to avoid input buffer overflow.
#[cfg(not(target_os = "linux"))]
const TYPE_CHUNK_SIZE: usize = 200;
/// Delay between typing chunks.
#[cfg(not(target_os = "linux"))]
const TYPE_CHUNK_DELAY_MS: u64 = 5;

pub struct KeyboardOutput;

impl Default for KeyboardOutput {
    fn default() -> Self {
        Self::new()
    }
}

impl KeyboardOutput {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl TextOutput for KeyboardOutput {
    async fn type_text(&self, text: &str) -> Result<()> {
        let text = text.to_string();
        tokio::task::spawn_blocking(move || type_text_blocking(&text)).await?
    }

    fn mode(&self) -> OutputMode {
        OutputMode::Keyboard
    }
}

#[cfg(not(target_os = "linux"))]
fn type_text_blocking(text: &str) -> Result<()> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow::anyhow!("Failed to create Enigo: {:?}", e))?;

    let lines: Vec<&str> = text.split('\n').collect();
    for (i, line) in lines.iter().enumerate() {
        if !line.is_empty() {
            for chunk in line.chars().collect::<Vec<_>>().chunks(TYPE_CHUNK_SIZE) {
                let s: String = chunk.iter().collect();
                enigo
                    .text(&s)
                    .map_err(|e| anyhow::anyhow!("Failed to type text: {:?}", e))?;
                std::thread::sleep(std::time::Duration::from_millis(TYPE_CHUNK_DELAY_MS));
            }
        }
        if i < lines.len() - 1 {
            enigo
                .key(Key::Shift, Direction::Press)
                .map_err(|e| anyhow::anyhow!("Key error: {:?}", e))?;
            enigo
                .key(Key::Return, Direction::Click)
                .map_err(|e| anyhow::anyhow!("Key error: {:?}", e))?;
            enigo
                .key(Key::Shift, Direction::Release)
                .map_err(|e| anyhow::anyhow!("Key error: {:?}", e))?;
        }
    }
    Ok(())
}

/// Linux keyboard mode: clipboard save → write payload → paste → restore.
///
/// Pure per-character typing through uinput can't produce Chinese or any
/// non-Latin codepoint (uinput only knows keycodes, not characters), and
/// enigo's `text()` uses XTest which native-Wayland apps ignore entirely.
/// The paste trick works in both session types for arbitrary Unicode; the
/// backup/restore makes it feel like typing from the user's perspective
/// (their prior clipboard content is undisturbed).
#[cfg(target_os = "linux")]
fn type_text_blocking(text: &str) -> Result<()> {
    use std::time::Duration;

    let mut clipboard = arboard::Clipboard::new()
        .map_err(|e| anyhow::anyhow!("Failed to access clipboard: {}", e))?;
    let backup = clipboard.get_text().ok();

    clipboard
        .set_text(text)
        .map_err(|e| anyhow::anyhow!("Failed to set clipboard: {}", e))?;
    // Drop the arboard handle before the paste simulation — arboard holds the
    // Wayland/X11 selection; keeping it locked while the target app reads
    // clipboard would race.
    drop(clipboard);
    std::thread::sleep(Duration::from_millis(20));

    // Prefer uinput so Wayland-native apps receive the paste.
    if let Err(e) = crate::uinput_output::paste() {
        tracing::warn!(
            "uinput paste unavailable ({}); falling back to enigo (X11 only)",
            e
        );
        enigo_paste_fallback()?;
    }

    // Give the target app time to consume the paste before we clobber the
    // clipboard with the restore. 150ms is generous for any interactive app;
    // slower consumers would at worst see the restored backup, never garbage.
    std::thread::sleep(Duration::from_millis(150));

    if let Some(prev) = backup {
        if let Ok(mut cb) = arboard::Clipboard::new() {
            let _ = cb.set_text(&prev);
        }
    }

    Ok(())
}

#[cfg(target_os = "linux")]
fn enigo_paste_fallback() -> Result<()> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| anyhow::anyhow!("Failed to create Enigo: {:?}", e))?;
    enigo
        .key(Key::Control, Direction::Press)
        .map_err(|e| anyhow::anyhow!("Key press error: {:?}", e))?;
    enigo
        .key(Key::Unicode('v'), Direction::Click)
        .map_err(|e| anyhow::anyhow!("Key click error: {:?}", e))?;
    enigo
        .key(Key::Control, Direction::Release)
        .map_err(|e| anyhow::anyhow!("Key release error: {:?}", e))?;
    Ok(())
}
