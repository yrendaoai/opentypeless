//! Evdev-based global shortcut listener for Linux.
//!
//! `tauri-plugin-global-shortcut` on Linux uses X11's `XGrabKey`, which under a
//! Wayland session (via XWayland) only observes X11 clients. Native Wayland
//! apps — Firefox/Chrome/VS Code in Wayland mode, GNOME apps — never deliver
//! their key events to the X server, so the shortcut never fires.
//!
//! This module reads directly from `/dev/input/event*` so we see key events
//! regardless of which display-server protocol the focused app uses. It runs
//! alongside the X11 plugin; `HotkeyGate` in `lib.rs` dedupes the two sources.
//!
//! Requires the process UID to be in the `input` group. If access is denied
//! we log a warning and the caller emits a one-line message to the frontend;
//! the X11 plugin still covers X11/XWayland focus in that case.

use std::sync::Arc;

use evdev::{EventType, InputEventKind, Key};
use tokio::sync::{mpsc, RwLock};

/// Subset of `ShortcutState` we share with the X11 handler path.
#[derive(Clone, Copy, Debug)]
pub enum Edge {
    Pressed,
    Released,
}

/// Target hotkey in evdev terms. Updated live when the user changes the
/// hotkey in Settings; tasks read via `RwLock`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HotkeySpec {
    pub ctrl: bool,
    pub alt: bool,
    pub shift: bool,
    pub meta: bool,
    /// Raw evdev keycode of the non-modifier key.
    pub key: u16,
}

pub type SharedSpec = Arc<RwLock<Option<HotkeySpec>>>;

/// Parse a hotkey string (same format as `parse_hotkey` in lib.rs:
/// "Ctrl+/", "Alt+F3", "Ctrl+Shift+A") into a `HotkeySpec`.
pub fn parse(s: &str) -> Option<HotkeySpec> {
    let parts: Vec<&str> = s.split('+').map(|p| p.trim()).collect();
    if parts.is_empty() {
        return None;
    }
    let mut spec = HotkeySpec::default();
    let key_str = parts.last()?;

    for &part in &parts[..parts.len() - 1] {
        match part.to_lowercase().as_str() {
            "alt" => spec.alt = true,
            "ctrl" | "control" => spec.ctrl = true,
            "shift" => spec.shift = true,
            "meta" | "super" | "win" | "cmd" => spec.meta = true,
            _ => return None,
        }
    }
    spec.key = key_to_code(key_str)?;
    Some(spec)
}

fn key_to_code(s: &str) -> Option<u16> {
    let lower = s.to_lowercase();
    let named = match lower.as_str() {
        "space" => Some(Key::KEY_SPACE),
        "tab" => Some(Key::KEY_TAB),
        "enter" | "return" => Some(Key::KEY_ENTER),
        "escape" | "esc" => Some(Key::KEY_ESC),
        "backspace" => Some(Key::KEY_BACKSPACE),
        "delete" => Some(Key::KEY_DELETE),
        "insert" => Some(Key::KEY_INSERT),
        "home" => Some(Key::KEY_HOME),
        "end" => Some(Key::KEY_END),
        "pageup" => Some(Key::KEY_PAGEUP),
        "pagedown" => Some(Key::KEY_PAGEDOWN),
        "up" | "arrowup" => Some(Key::KEY_UP),
        "down" | "arrowdown" => Some(Key::KEY_DOWN),
        "left" | "arrowleft" => Some(Key::KEY_LEFT),
        "right" | "arrowright" => Some(Key::KEY_RIGHT),
        "/" | "slash" => Some(Key::KEY_SLASH),
        "\\" | "backslash" => Some(Key::KEY_BACKSLASH),
        "," | "comma" => Some(Key::KEY_COMMA),
        "." | "period" | "dot" => Some(Key::KEY_DOT),
        ";" | "semicolon" => Some(Key::KEY_SEMICOLON),
        "'" | "apostrophe" | "quote" => Some(Key::KEY_APOSTROPHE),
        "[" | "leftbracket" => Some(Key::KEY_LEFTBRACE),
        "]" | "rightbracket" => Some(Key::KEY_RIGHTBRACE),
        "-" | "minus" => Some(Key::KEY_MINUS),
        "=" | "equal" | "equals" => Some(Key::KEY_EQUAL),
        "`" | "grave" | "backtick" => Some(Key::KEY_GRAVE),
        "f1" => Some(Key::KEY_F1),
        "f2" => Some(Key::KEY_F2),
        "f3" => Some(Key::KEY_F3),
        "f4" => Some(Key::KEY_F4),
        "f5" => Some(Key::KEY_F5),
        "f6" => Some(Key::KEY_F6),
        "f7" => Some(Key::KEY_F7),
        "f8" => Some(Key::KEY_F8),
        "f9" => Some(Key::KEY_F9),
        "f10" => Some(Key::KEY_F10),
        "f11" => Some(Key::KEY_F11),
        "f12" => Some(Key::KEY_F12),
        _ => None,
    };
    if let Some(k) = named {
        return Some(k.code());
    }
    if lower.len() == 1 {
        let ch = lower.chars().next().unwrap();
        return match ch {
            'a'..='z' => Some(letter_code(ch)),
            '0'..='9' => Some(digit_code(ch)),
            _ => None,
        };
    }
    None
}

fn letter_code(c: char) -> u16 {
    match c {
        'a' => Key::KEY_A.code(),
        'b' => Key::KEY_B.code(),
        'c' => Key::KEY_C.code(),
        'd' => Key::KEY_D.code(),
        'e' => Key::KEY_E.code(),
        'f' => Key::KEY_F.code(),
        'g' => Key::KEY_G.code(),
        'h' => Key::KEY_H.code(),
        'i' => Key::KEY_I.code(),
        'j' => Key::KEY_J.code(),
        'k' => Key::KEY_K.code(),
        'l' => Key::KEY_L.code(),
        'm' => Key::KEY_M.code(),
        'n' => Key::KEY_N.code(),
        'o' => Key::KEY_O.code(),
        'p' => Key::KEY_P.code(),
        'q' => Key::KEY_Q.code(),
        'r' => Key::KEY_R.code(),
        's' => Key::KEY_S.code(),
        't' => Key::KEY_T.code(),
        'u' => Key::KEY_U.code(),
        'v' => Key::KEY_V.code(),
        'w' => Key::KEY_W.code(),
        'x' => Key::KEY_X.code(),
        'y' => Key::KEY_Y.code(),
        'z' => Key::KEY_Z.code(),
        _ => unreachable!(),
    }
}

fn digit_code(c: char) -> u16 {
    match c {
        '0' => Key::KEY_0.code(),
        '1' => Key::KEY_1.code(),
        '2' => Key::KEY_2.code(),
        '3' => Key::KEY_3.code(),
        '4' => Key::KEY_4.code(),
        '5' => Key::KEY_5.code(),
        '6' => Key::KEY_6.code(),
        '7' => Key::KEY_7.code(),
        '8' => Key::KEY_8.code(),
        '9' => Key::KEY_9.code(),
        _ => unreachable!(),
    }
}

fn is_ctrl(code: u16) -> bool {
    code == Key::KEY_LEFTCTRL.code() || code == Key::KEY_RIGHTCTRL.code()
}
fn is_shift(code: u16) -> bool {
    code == Key::KEY_LEFTSHIFT.code() || code == Key::KEY_RIGHTSHIFT.code()
}
fn is_alt(code: u16) -> bool {
    code == Key::KEY_LEFTALT.code() || code == Key::KEY_RIGHTALT.code()
}
fn is_meta(code: u16) -> bool {
    code == Key::KEY_LEFTMETA.code() || code == Key::KEY_RIGHTMETA.code()
}

/// Result of attempting to start the listener. The caller uses this to decide
/// whether to surface a permission message to the frontend.
pub enum StartResult {
    /// At least one keyboard device is being watched.
    Started,
    /// `/dev/input/event*` exists but could not be opened (typically EACCES —
    /// user is not in the `input` group). The X11 plugin still works, but
    /// Wayland focus will not trigger the hotkey until this is fixed.
    PermissionDenied,
    /// No keyboard-looking devices found.
    NoDevices,
}

/// Spawn a listener task per attached keyboard.
///
/// Returns a receiver that yields `Edge` events (deduped across keyboards by
/// `HotkeyGate` on the consuming side). The returned `StartResult` reflects
/// the outcome of device enumeration so the caller can surface a message.
pub fn spawn(spec: SharedSpec) -> (mpsc::UnboundedReceiver<Edge>, StartResult) {
    let (tx, rx) = mpsc::unbounded_channel();

    let mut opened = 0usize;
    let mut any_permission_denied = false;

    for (path, device) in evdev::enumerate() {
        // Filter: must look like a keyboard (has the KEY_ENTER capability).
        let is_keyboard = device
            .supported_keys()
            .map(|keys| keys.contains(Key::KEY_ENTER))
            .unwrap_or(false);
        if !is_keyboard {
            continue;
        }

        let stream = match device.into_event_stream() {
            Ok(s) => s,
            Err(e) => {
                if e.kind() == std::io::ErrorKind::PermissionDenied {
                    any_permission_denied = true;
                }
                tracing::warn!("evdev: cannot open {:?}: {}", path, e);
                continue;
            }
        };

        opened += 1;
        let spec = spec.clone();
        let tx = tx.clone();
        tokio::spawn(async move {
            run_device(path, stream, spec, tx).await;
        });
    }

    let status = if opened > 0 {
        StartResult::Started
    } else if any_permission_denied {
        StartResult::PermissionDenied
    } else {
        StartResult::NoDevices
    };
    (rx, status)
}

async fn run_device(
    path: std::path::PathBuf,
    mut stream: evdev::EventStream,
    spec: SharedSpec,
    tx: mpsc::UnboundedSender<Edge>,
) {
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut meta = false;
    let mut target_held = false;
    let mut was_active = false;

    loop {
        let ev = match stream.next_event().await {
            Ok(ev) => ev,
            Err(e) => {
                tracing::warn!("evdev: stream error on {:?}: {}", path, e);
                return;
            }
        };

        if ev.event_type() != EventType::KEY {
            continue;
        }
        // value: 0 = release, 1 = press, 2 = repeat (ignored — HotkeyGate also
        // filters, but skipping here avoids a needless RwLock read).
        let pressed = match ev.value() {
            0 => false,
            1 => true,
            _ => continue,
        };

        let code = if let InputEventKind::Key(k) = ev.kind() {
            k.code()
        } else {
            continue;
        };

        if is_ctrl(code) {
            ctrl = pressed;
        } else if is_shift(code) {
            shift = pressed;
        } else if is_alt(code) {
            alt = pressed;
        } else if is_meta(code) {
            meta = pressed;
        }

        let spec = match spec.read().await.clone() {
            Some(s) => s,
            None => continue,
        };

        if code == spec.key {
            target_held = pressed;
        }

        let mods_match =
            ctrl == spec.ctrl && alt == spec.alt && shift == spec.shift && meta == spec.meta;
        let is_active = mods_match && target_held;

        if is_active != was_active {
            was_active = is_active;
            let edge = if is_active {
                Edge::Pressed
            } else {
                Edge::Released
            };
            if tx.send(edge).is_err() {
                return;
            }
        }
    }
}
