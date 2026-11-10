use crate::config::{get, set};
use crate::window::{input_translate, ocr_recognize, ocr_translate, selection_translate, study_translate};
use crate::APP;
use log::{info, warn};
use tauri::{AppHandle, GlobalShortcutManager};

fn register<F>(app_handle: &AppHandle, name: &str, handler: F, key: &str) -> Result<(), String>
where
    F: Fn() + Send + 'static,
{
    let hotkey = {
        if key.is_empty() {
            match get(name) {
                Some(v) => v.as_str().unwrap().to_string(),
                None => {
                    set(name, "");
                    String::new()
                }
            }
        } else {
            key.to_string()
        }
    };

    if !hotkey.is_empty() {
        match app_handle
            .global_shortcut_manager()
            .register(hotkey.as_str(), handler)
        {
            Ok(()) => {
                info!("Registered global shortcut: {} for {}", hotkey, name);
            }
            Err(e) => {
                warn!("Failed to register global shortcut: {} {:?}", hotkey, e);
                return Err(e.to_string());
            }
        };
    }
    Ok(())
}

// Register global shortcuts
pub fn register_shortcut(shortcut: &str) -> Result<(), String> {
    let app_handle = APP.get().unwrap();
    match shortcut {
        "hotkey_selection_translate" => register(
            app_handle,
            "hotkey_selection_translate",
            selection_translate,
            "",
        )?,
        "hotkey_selection_translate_study" => register(
            app_handle,
            "hotkey_selection_translate_study",
            study_translate,
            "",
        )?,
        "hotkey_input_translate" => {
            register(app_handle, "hotkey_input_translate", input_translate, "")?
        }
        "hotkey_ocr_recognize" => register(app_handle, "hotkey_ocr_recognize", ocr_recognize, "")?,
        "hotkey_ocr_translate" => register(app_handle, "hotkey_ocr_translate", ocr_translate, "")?,
        "all" => {
            // 单个热键注册失败不能中断后面的：之前每步都用 ? 直接 return，
            // 只要有一个被其他软件占用，剩下的热键全部不注册，用户看到的是“全部没反应”
            let mut errors: Vec<String> = Vec::new();

            if let Err(e) = register(app_handle, "hotkey_selection_translate", selection_translate, "") {
                errors.push(format!("hotkey_selection_translate: {}", e));
            }
            // 学习模式热键：默认 Alt+S，未配置时写入默认值
            if get("hotkey_selection_translate_study").is_none() {
                set("hotkey_selection_translate_study", "Alt+S");
            }
            if let Err(e) = register(
                app_handle,
                "hotkey_selection_translate_study",
                study_translate,
                "",
            ) {
                errors.push(format!("hotkey_selection_translate_study: {}", e));
            }
            if let Err(e) = register(app_handle, "hotkey_input_translate", input_translate, "") {
                errors.push(format!("hotkey_input_translate: {}", e));
            }
            if let Err(e) = register(app_handle, "hotkey_ocr_recognize", ocr_recognize, "") {
                errors.push(format!("hotkey_ocr_recognize: {}", e));
            }
            if let Err(e) = register(app_handle, "hotkey_ocr_translate", ocr_translate, "") {
                errors.push(format!("hotkey_ocr_translate: {}", e));
            }
            if !errors.is_empty() {
                return Err(errors.join("; "));
            }
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn register_shortcut_by_frontend(name: &str, shortcut: &str) -> Result<(), String> {
    let app_handle = APP.get().unwrap();
    match name {
        "hotkey_selection_translate" => register(
            app_handle,
            "hotkey_selection_translate",
            selection_translate,
            shortcut,
        )?,
        "hotkey_selection_translate_study" => register(
            app_handle,
            "hotkey_selection_translate_study",
            study_translate,
            shortcut,
        )?,
        "hotkey_input_translate" => register(
            app_handle,
            "hotkey_input_translate",
            input_translate,
            shortcut,
        )?,
        "hotkey_ocr_recognize" => {
            register(app_handle, "hotkey_ocr_recognize", ocr_recognize, shortcut)?
        }
        "hotkey_ocr_translate" => {
            register(app_handle, "hotkey_ocr_translate", ocr_translate, shortcut)?
        }
        _ => {}
    }
    Ok(())
}
