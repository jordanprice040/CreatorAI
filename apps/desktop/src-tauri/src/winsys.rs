//! Windows process plumbing for the installed studio (ADR-0041): one studio per user and
//! data folder, a kill-on-close job for owned children, the opt-in login Run entry and a
//! plain message box. No services, scheduled tasks or machine-wide settings.
#![cfg(windows)]
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ALREADY_EXISTS, HANDLE, WAIT_OBJECT_0,
};
use windows::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};
use windows::Win32::System::Registry::{
    RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::System::Threading::{
    CreateEventW, CreateMutexW, OpenEventW, OpenMutexW, SetEvent, WaitForSingleObject,
    EVENT_MODIFY_STATE, SYNCHRONIZATION_SYNCHRONIZE,
};
use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONINFORMATION, MB_OK};

/// Handle wrapper that is safe to move between threads (the handles are kernel objects).
pub struct Owned(pub HANDLE);
unsafe impl Send for Owned {}
unsafe impl Sync for Owned {}
impl Drop for Owned {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

pub enum Instance {
    /// This process owns the studio; the event fires when another launch asks to be shown.
    First { _mutex: Owned, show: Owned },
    /// Another process owns it and has been asked to show its window.
    Second,
}

pub fn single_instance(key: &str) -> Result<Instance, String> {
    let mutex_name = HSTRING::from(format!("Local\\CreatorAgentStudio-{key}"));
    let event_name = HSTRING::from(format!("Local\\CreatorAgentStudioShow-{key}"));
    unsafe {
        let mutex = CreateMutexW(None, true, &mutex_name)
            .map_err(|_| "Could not create the single-instance lock")?;
        if GetLastError() == ERROR_ALREADY_EXISTS {
            let _ = CloseHandle(mutex);
            if let Ok(event) = OpenEventW(EVENT_MODIFY_STATE, false, &event_name) {
                let _ = SetEvent(event);
                let _ = CloseHandle(event);
            }
            return Ok(Instance::Second);
        }
        let show = CreateEventW(None, false, false, &event_name)
            .map_err(|_| "Could not create the show-window signal")?;
        Ok(Instance::First {
            _mutex: Owned(mutex),
            show: Owned(show),
        })
    }
}

/// F4 (ADR-0128): whether a studio for this home still holds its single-instance lock. Unlike
/// `single_instance`, it never asks that studio to show its window.
pub fn studio_running(key: &str) -> bool {
    let mutex_name = HSTRING::from(format!("Local\\CreatorAgentStudio-{key}"));
    unsafe {
        match OpenMutexW(SYNCHRONIZATION_SYNCHRONIZE, false, &mutex_name) {
            Ok(h) => {
                let _ = CloseHandle(h);
                true
            }
            Err(_) => false,
        }
    }
}

/// Blocks until another launch asks this studio to show itself (or the timeout passes).
pub fn wait_for_show(event: &Owned, ms: u32) -> bool {
    unsafe { WaitForSingleObject(event.0, ms) == WAIT_OBJECT_0 }
}

/// A job whose children die with the supervisor, so a crash never leaves an orphan service.
pub fn kill_on_close_job() -> Result<Owned, String> {
    unsafe {
        let job = CreateJobObjectW(None, PCWSTR::null()).map_err(|_| "Could not create a job")?;
        let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
        .map_err(|_| "Could not configure the job")?;
        Ok(Owned(job))
    }
}

pub fn assign(job: &Owned, child: &std::process::Child) -> Result<(), String> {
    use std::os::windows::io::AsRawHandle;
    unsafe {
        AssignProcessToJobObject(job.0, HANDLE(child.as_raw_handle()))
            .map_err(|_| "Could not attach the service to the app's job".into())
    }
}

const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE: &str = "Creator Agent Studio";

/// Writes or removes the current user's login entry. Only called after an explicit setting.
pub fn set_launch_at_login(enabled: bool, exe: &std::path::Path) -> Result<(), String> {
    let key = HSTRING::from(RUN_KEY);
    let name = HSTRING::from(RUN_VALUE);
    unsafe {
        if enabled {
            let command = format!("\"{}\" --at-login", exe.display());
            let wide: Vec<u16> = command.encode_utf16().chain(std::iter::once(0)).collect();
            let r = RegSetKeyValueW(
                HKEY_CURRENT_USER,
                &key,
                &name,
                REG_SZ.0,
                Some(wide.as_ptr() as *const core::ffi::c_void),
                (wide.len() * 2) as u32,
            );
            if r.is_err() {
                return Err("Could not add the login entry".into());
            }
        } else {
            let r = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, &name);
            if r.is_err() && r.0 != 2 {
                return Err("Could not remove the login entry".into());
            }
        }
    }
    Ok(())
}

pub fn launch_at_login_present() -> bool {
    let key = HSTRING::from(RUN_KEY);
    let name = HSTRING::from(RUN_VALUE);
    unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            &key,
            &name,
            RRF_RT_REG_SZ,
            None,
            None,
            None,
        )
        .is_ok()
    }
}

pub fn message(title: &str, text: &str) {
    unsafe {
        MessageBoxW(
            None,
            &HSTRING::from(text),
            &HSTRING::from(title),
            MB_OK | MB_ICONINFORMATION,
        );
    }
}
