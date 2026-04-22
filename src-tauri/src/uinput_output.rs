//! Kernel-level key injection via `/dev/uinput`.
//!
//! enigo's Linux backend uses X11's XTest, which only delivers keystrokes to
//! XWayland clients — native Wayland apps (VS Code Wayland, GNOME Terminal,
//! Firefox Wayland, etc.) never see them. uinput creates a virtual keyboard
//! at kernel level, so its events flow through the normal input pipeline and
//! every app sees them regardless of display-server protocol.
//!
//! We only need Ctrl+V: typing arbitrary Unicode (Chinese, emoji) through
//! keycode injection is not reliable, so both output modes funnel through
//! "clipboard + simulated paste" — keyboard mode just backs up and restores
//! the user's clipboard around the paste.
//!
//! Requires `/dev/uinput` to be accessible. We ship a udev rule making it
//! group-`input`-writable; if not applied, `paste()` returns an error and
//! the caller falls back to enigo (which still works on X11 sessions).
//!
//! The virtual device is created lazily on first use and reused for the
//! lifetime of the process.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use anyhow::{Context, Result};
use evdev::{
    uinput::{VirtualDevice, VirtualDeviceBuilder},
    AttributeSet, EventType, InputEvent, Key,
};

static DEVICE: OnceLock<Mutex<VirtualDevice>> = OnceLock::new();
static FIRST_USE_SETTLED: OnceLock<()> = OnceLock::new();

/// SYN_REPORT terminates an event group so downstream consumers know a
/// self-consistent state change is complete.
const SYN_REPORT_CODE: u16 = 0;

fn init_device() -> Result<VirtualDevice> {
    let mut keys = AttributeSet::<Key>::new();
    keys.insert(Key::KEY_LEFTCTRL);
    keys.insert(Key::KEY_V);

    let device = VirtualDeviceBuilder::new()
        .context(
            "Opening /dev/uinput failed. Install the udev rule and re-login so \
             the `input` group is picked up: \
             echo 'KERNEL==\"uinput\", MODE=\"0660\", GROUP=\"input\", OPTIONS+=\"static_node=uinput\"' \
             | sudo tee /etc/udev/rules.d/99-uinput.rules && \
             sudo udevadm control --reload-rules && sudo udevadm trigger",
        )?
        .name("OpenTypeless virtual keyboard")
        .with_keys(&keys)
        .context("uinput: setting key capabilities failed")?
        .build()
        .context("uinput: device build failed")?;
    Ok(device)
}

fn device() -> Result<&'static Mutex<VirtualDevice>> {
    if let Some(m) = DEVICE.get() {
        return Ok(m);
    }
    let d = init_device()?;
    // If another thread initialized first, our device is just dropped (closing fd).
    let _ = DEVICE.set(Mutex::new(d));
    DEVICE
        .get()
        .context("uinput: DEVICE unset after initialization")
}

/// Press-and-release Ctrl+V via the virtual keyboard.
///
/// Caller has already placed the payload on the clipboard — this just fires
/// the paste shortcut. Returns an error if `/dev/uinput` is not accessible;
/// callers that have an X11 fallback (enigo) should use it in that case.
pub fn paste() -> Result<()> {
    let dev_mutex = device()?;
    let mut dev = dev_mutex.lock().unwrap_or_else(|e| e.into_inner());

    // First call after creating the virtual device: the compositor / input
    // stack may not have registered it yet, so very-early events are lost.
    // Settle once; cost is amortized across the process lifetime.
    if FIRST_USE_SETTLED.get().is_none() {
        std::thread::sleep(Duration::from_millis(250));
        let _ = FIRST_USE_SETTLED.set(());
    }

    let key_type = EventType::KEY;
    let syn = InputEvent::new(EventType::SYNCHRONIZATION, SYN_REPORT_CODE, 0);
    let ctrl = Key::KEY_LEFTCTRL.code();
    let v = Key::KEY_V.code();

    dev.emit(&[
        InputEvent::new(key_type, ctrl, 1),
        syn,
        InputEvent::new(key_type, v, 1),
        syn,
    ])
    .context("uinput: emit Ctrl+V down")?;
    std::thread::sleep(Duration::from_millis(15));
    dev.emit(&[
        InputEvent::new(key_type, v, 0),
        syn,
        InputEvent::new(key_type, ctrl, 0),
        syn,
    ])
    .context("uinput: emit Ctrl+V up")?;

    Ok(())
}

/// Cheap check: is the uinput device openable / already open? Used to decide
/// at startup whether to warn the user.
pub fn probe() -> bool {
    device().is_ok()
}
