//! Shared test helpers. Anything that mutates process-global state (env vars,
//! cwd, etc.) lives here so the entire test suite serializes through one lock
//! instead of separate per-module locks racing against each other.

#![cfg(test)]

use std::path::Path;

/// Single global mutex guarding `PI_CODING_AGENT_DIR` mutations across the
/// whole crate. Tests in any module that need to redirect the Pi global dir
/// must go through `with_pi_dir`.
pub(crate) static PI_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Single global mutex guarding home directory env mutations across the whole
/// crate. Tests that need to redirect `dirs::home_dir()` must go through
/// `with_home_dir`.
pub(crate) static HOME_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Run `body` with `PI_CODING_AGENT_DIR` set to `pi_dir`, restoring the
/// previous value (or unsetting) afterwards. Tolerates a poisoned lock from a
/// prior panicking test so failures don't cascade across the whole suite.
pub(crate) fn with_pi_dir<R>(pi_dir: &Path, body: impl FnOnce() -> R) -> R {
    let guard = match PI_ENV_LOCK.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let prev = std::env::var_os("PI_CODING_AGENT_DIR");
    unsafe {
        std::env::set_var("PI_CODING_AGENT_DIR", pi_dir);
    }
    let result = body();
    unsafe {
        if let Some(prev) = prev {
            std::env::set_var("PI_CODING_AGENT_DIR", prev);
        } else {
            std::env::remove_var("PI_CODING_AGENT_DIR");
        }
    }
    drop(guard);
    result
}

/// Run `body` with HOME-style env vars pointing at `home_dir`, restoring the
/// previous values afterwards.
pub(crate) fn with_home_dir<R>(home_dir: &Path, body: impl FnOnce() -> R) -> R {
    let guard = match HOME_ENV_LOCK.lock() {
        Ok(g) => g,
        Err(poisoned) => poisoned.into_inner(),
    };
    let prev_home = std::env::var_os("HOME");
    let prev_userprofile = std::env::var_os("USERPROFILE");
    unsafe {
        std::env::set_var("HOME", home_dir);
        std::env::set_var("USERPROFILE", home_dir);
    }
    let result = body();
    unsafe {
        if let Some(prev) = prev_home {
            std::env::set_var("HOME", prev);
        } else {
            std::env::remove_var("HOME");
        }
        if let Some(prev) = prev_userprofile {
            std::env::set_var("USERPROFILE", prev);
        } else {
            std::env::remove_var("USERPROFILE");
        }
    }
    drop(guard);
    result
}
