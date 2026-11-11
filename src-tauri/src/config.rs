use crate::{error::Error, APP};
use dirs::config_dir;
use log::{info, warn};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{Manager, Wry};
use tauri_plugin_store::{Store, StoreBuilder};

pub struct StoreWrapper(pub Mutex<Store<Wry>>);

/// 把旧版本留下的应用数据搬到当前 identifier 目录下。
///
/// 背景：3.0.7-lzc.1 用 com.lzc.pot-study，3.1.0 改成了 com.pot-app.desktop。
/// 后者与原版 Pot 完全同标识，同时安装会共用配置、抢热键，所以改回独立标识。
/// 代价是装过 3.1.0 的用户需要迁移一次。
///
/// 甄别：原版 Pot 的配置里没有 study_services 字段，有它才是 Pot Study 的数据，
/// 避免把原版 Pot 的配置误搬过来。目标已有配置时直接返回，不覆盖现有数据。
fn migrate_legacy_config(identifier: &str) {
    let base = match config_dir() {
        Some(v) => v,
        None => return,
    };
    let target_dir = base.join(identifier);
    let target_cfg = target_dir.join("config.json");

    if target_cfg.exists() {
        return;
    }

    let legacy_id = "com.pot-app.desktop";
    if legacy_id == identifier {
        return;
    }
    let legacy_dir = base.join(legacy_id);
    let legacy_cfg = legacy_dir.join("config.json");
    if !legacy_cfg.exists() {
        return;
    }

    let content = match std::fs::read_to_string(&legacy_cfg) {
        Ok(v) => v,
        Err(_) => return,
    };
    if !content.contains("\"study_services\"") {
        info!("legacy dir belongs to original Pot, skip migration");
        return;
    }

    // 先备份再复制，迁移出问题还能找回
    let _ = std::fs::copy(&legacy_cfg, legacy_dir.join("config.json.pre-migrate.bak"));

    if std::fs::create_dir_all(&target_dir).is_err() {
        warn!("migrate: cannot create target dir");
        return;
    }
    if let Err(e) = std::fs::copy(&legacy_cfg, &target_cfg) {
        warn!("migrate: copy config failed: {:?}", e);
        return;
    }

    // 历史记录和插件一起搬，保证翻译历史和朗读可用
    for name in ["history.db", "history.db-shm", "history.db-wal"] {
        let src = legacy_dir.join(name);
        if src.exists() {
            let _ = std::fs::copy(&src, target_dir.join(name));
        }
    }
    let legacy_plugins = legacy_dir.join("plugins");
    if legacy_plugins.is_dir() {
        if let Err(e) = copy_dir(&legacy_plugins, &target_dir.join("plugins")) {
            warn!("migrate: copy plugins failed: {:?}", e);
        }
    }
    info!("migrated config from {} to {}", legacy_id, identifier);
}

fn copy_dir(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let to = dst.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir(&entry.path(), &to)?;
        } else {
            std::fs::copy(entry.path(), &to)?;
        }
    }
    Ok(())
}

pub fn init_config(app: &mut tauri::App) {
    let identifier = app.config().tauri.bundle.identifier.clone();
    // 先把旧版本的数据搬过来，再读配置
    migrate_legacy_config(&identifier);
    let config_path = config_dir().unwrap();
    let config_path = config_path.join(&identifier);
    let config_path = config_path.join("config.json");
    info!("Load config from: {:?}", config_path);
    let mut store = StoreBuilder::new(app.handle(), config_path).build();

    match store.load() {
        Ok(_) => info!("Config loaded"),
        Err(e) => {
            warn!("Config load error: {:?}", e);
            info!("Config not found, creating new config");
        }
    }
    app.manage(StoreWrapper(Mutex::new(store)));
    let _ = check_service_available();
}

fn check_available(list: Vec<String>, builtin: Vec<&str>, plugin: Vec<String>, key: &str) {
    let origin_length = list.len();
    let mut new_list = list.clone();
    for service in list {
        let name = service.split("@").collect::<Vec<&str>>()[0];
        let mut is_available = true;
        if name.starts_with("plugin") {
            if !plugin.contains(&name.to_string()) {
                is_available = false;
            }
        } else {
            if !builtin.contains(&name) {
                is_available = false;
            }
        }
        if !is_available {
            new_list.retain(|x| x != &service);
        }
    }
    if new_list.len() != origin_length {
        set(key, new_list);
    }
}

pub fn check_service_available() -> Result<(), Error> {
    let builtin_recognize_list: Vec<&str> = vec![
        "baidu_ocr",
        "baidu_accurate_ocr",
        "baidu_img_ocr",
        "iflytek_ocr",
        "iflytek_intsig_ocr",
        "iflytek_latex_ocr",
        "qrcode",
        "simple_latex_ocr",
        "system",
        "tencent_ocr",
        "tencent_accurate_ocr",
        "tencent_img_ocr",
        "tesseract",
        "volcengine_ocr",
        "volcengine_multi_lang_ocr",
    ];
    let builtin_translate_list: Vec<&str> = vec![
        "alibaba",
        "baidu",
        "baidu_field",
        "bing",
        "bing_dict",
        "caiyun",
        "cambridge_dict",
        "chatglm",
        "deepl",
        "ecdict",
        "lingva",
        "geminipro",
        "niutrans",
        "ollama",
        "openai",
        "google",
        "tencent",
        "transmart",
        "volcengine",
        "yandex",
        "youdao",
    ];
    let builtin_tts_list: Vec<&str> = vec!["lingva_tts"];
    let builtin_collection_list: Vec<&str> = vec!["anki", "eudic"];

    let plugin_recognize_list: Vec<String> = get_plugin_list("recognize").unwrap_or_default();
    let plugin_translate_list: Vec<String> = get_plugin_list("translate").unwrap_or_default();
    let plugin_tts_list: Vec<String> = get_plugin_list("tts").unwrap_or_default();
    let plugin_collection_list: Vec<String> = get_plugin_list("collection").unwrap_or_default();
    if let Some(recognize_service_list) = get("recognize_service_list") {
        let recognize_service_list: Vec<String> = serde_json::from_value(recognize_service_list)?;
        check_available(
            recognize_service_list,
            builtin_recognize_list,
            plugin_recognize_list,
            "recognize_service_list",
        );
    }
    if let Some(translate_service_list) = get("translate_service_list") {
        let translate_service_list: Vec<String> = serde_json::from_value(translate_service_list)?;
        check_available(
            translate_service_list,
            builtin_translate_list,
            plugin_translate_list,
            "translate_service_list",
        );
    }
    if let Some(tts_service_list) = get("tts_service_list") {
        let tts_service_list: Vec<String> = serde_json::from_value(tts_service_list)?;
        check_available(
            tts_service_list,
            builtin_tts_list,
            plugin_tts_list,
            "tts_service_list",
        );
    }
    if let Some(collection_service_list) = get("collection_service_list") {
        let collection_service_list: Vec<String> = serde_json::from_value(collection_service_list)?;
        check_available(
            collection_service_list,
            builtin_collection_list,
            plugin_collection_list,
            "collection_service_list",
        );
    }
    Ok(())
}

pub fn get_plugin_list(plugin_type: &str) -> Option<Vec<String>> {
    let app_handle = APP.get().unwrap();
    let config_dir = dirs::config_dir()?;
    let config_dir = config_dir.join(app_handle.config().tauri.bundle.identifier.clone());
    let plugin_dir = config_dir.join("plugins");
    let plugin_dir = plugin_dir.join(plugin_type);

    // dirs in plugin_dir
    let mut plugin_list = vec![];
    if plugin_dir.exists() {
        let read_dir = std::fs::read_dir(plugin_dir).ok()?;
        for entry in read_dir {
            let entry = entry.ok()?;

            if entry.path().is_dir() {
                let name = entry.file_name().to_str()?.to_string();
                if name.starts_with("plugin") {
                    plugin_list.push(name);
                } else {
                    // Remove old plugin
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
    }
    Some(plugin_list)
}

pub fn get(key: &str) -> Option<Value> {
    let state = APP.get().unwrap().state::<StoreWrapper>();
    let store = state.0.lock().unwrap();
    match store.get(key) {
        Some(value) => Some(value.clone()),
        None => None,
    }
}

pub fn set<T: serde::ser::Serialize>(key: &str, value: T) {
    let state = APP.get().unwrap().state::<StoreWrapper>();
    let mut store = state.0.lock().unwrap();
    store.insert(key.to_string(), json!(value)).unwrap();
    store.save().unwrap();
}

pub fn is_first_run() -> bool {
    let state = APP.get().unwrap().state::<StoreWrapper>();
    let store = state.0.lock().unwrap();
    store.is_empty()
}
