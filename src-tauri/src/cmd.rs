use crate::config::get;
use crate::config::StoreWrapper;
use crate::error::Error;
use crate::window::config_window;
use crate::StringWrapper;
use crate::APP;
use log::{error, info};
use serde_json::{json, Value};
use std::io::Read;
use tauri::Manager;

#[tauri::command]
pub fn get_text(state: tauri::State<StringWrapper>) -> String {
    return state.0.lock().unwrap().to_string();
}

#[tauri::command]
pub fn get_translate_mode(state: tauri::State<crate::TranslateModeWrapper>) -> String {
    return state.0.lock().unwrap().to_string();
}

/// 前端打开设置窗口（学习模式未配置服务时的引导入口）
#[tauri::command]
pub fn open_config_window() {
    config_window();
}

#[tauri::command]
pub fn reload_store() {
    let state = APP.get().unwrap().state::<StoreWrapper>();
    let mut store = state.0.lock().unwrap();
    store.load().unwrap();
}

#[tauri::command]
pub async fn cut_image(
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // 读整图 + 裁剪 + 写盘，几 MB 的图在主线程跑会拖慢截图后的响应。
    // Error 里有非 Send 的 Box<dyn Error>，闭包里先降成 String。
    match tauri::async_runtime::spawn_blocking(move || {
        cut_image_blocking(left, top, width, height, app_handle).map_err(|e| e.to_string())
    })
    .await
    {
        Ok(r) => r,
        Err(e) => Err(format!("cut task failed: {e}")),
    }
}

fn cut_image_blocking(
    left: u32,
    top: u32,
    width: u32,
    height: u32,
    app_handle: tauri::AppHandle,
) -> Result<(), Error> {
    use dirs::cache_dir;
    use image::GenericImage;
    info!("Cut image: {}x{}+{}+{}", width, height, left, top);
    let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
    app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
    app_cache_dir_path.push("pot_screenshot.png");
    // 失败必须向上报：前端只看得到“成功”，否则会拿上一张缓存图去识别
    if !app_cache_dir_path.exists() {
        return Err(Error::Error("screenshot cache not found".into()));
    }
    let mut img = image::open(&app_cache_dir_path)?;
    let img2 = img.sub_image(left, top, width, height);
    app_cache_dir_path.pop();
    app_cache_dir_path.push("pot_screenshot_cut.png");
    img2.to_image().save(&app_cache_dir_path)?;
    Ok(())
}

#[tauri::command]
pub async fn get_base64(app_handle: tauri::AppHandle) -> String {
    // 读文件 + base64 编码，同样不能占主线程
    tauri::async_runtime::spawn_blocking(move || get_base64_blocking(app_handle))
        .await
        .unwrap_or_default()
}

fn get_base64_blocking(app_handle: tauri::AppHandle) -> String {
    use base64::{engine::general_purpose, Engine as _};
    use dirs::cache_dir;
    use std::fs::File;
    use std::io::Read;
    let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
    app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
    app_cache_dir_path.push("pot_screenshot_cut.png");
    if !app_cache_dir_path.exists() {
        return "".to_string();
    }
    let mut file = File::open(app_cache_dir_path).unwrap();
    let mut vec = Vec::new();
    match file.read_to_end(&mut vec) {
        Ok(_) => {}
        Err(e) => {
            error!("{:?}", e.to_string());
            return "".to_string();
        }
    }
    let base64 = general_purpose::STANDARD.encode(&vec);
    base64.replace("\r\n", "")
}

#[tauri::command]
pub fn copy_img(app_handle: tauri::AppHandle, width: usize, height: usize) -> Result<(), Error> {
    use arboard::{Clipboard, ImageData};
    use dirs::cache_dir;
    use image::ImageReader;
    use std::borrow::Cow;

    let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
    app_cache_dir_path.push(&app_handle.config().tauri.bundle.identifier);
    app_cache_dir_path.push("pot_screenshot_cut.png");
    let data = ImageReader::open(app_cache_dir_path)?.decode()?;

    let img = ImageData {
        width,
        height,
        bytes: Cow::from(data.as_bytes()),
    };
    let result = Clipboard::new()?.set_image(img)?;
    Ok(result)
}

#[tauri::command]
pub fn set_proxy() -> Result<bool, ()> {
    let host = match get("proxy_host") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => return Err(()),
    };
    let port = match get("proxy_port") {
        Some(v) => v.as_i64().unwrap(),
        None => return Err(()),
    };
    let no_proxy = match get("no_proxy") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => return Err(()),
    };
    let proxy = format!("http://{}:{}", host, port);

    // 大小写都设：WebView2 读大写，部分库读小写
    for k in ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"] {
        std::env::set_var(k, &proxy);
    }
    std::env::set_var("no_proxy", &no_proxy);
    std::env::set_var("NO_PROXY", &no_proxy);
    Ok(true)
}

#[tauri::command]
pub fn unset_proxy() -> Result<bool, ()> {
    // 之前只删了小写，系统继承来的大写变量还在，导致代理关了仍然走代理
    for k in [
        "http_proxy",
        "HTTP_PROXY",
        "https_proxy",
        "HTTPS_PROXY",
        "all_proxy",
        "ALL_PROXY",
        "no_proxy",
        "NO_PROXY",
    ] {
        std::env::remove_var(k);
    }
    Ok(true)
}

/// 读 Windows 系统代理设置（分流软件开关控制的就是它）。
/// 一次查询拿整个键，不分开查 ProxyEnable / ProxyServer：
/// 每次启动 reg.exe 要几十到几百毫秒，两次叠加就是能感觉到的卡顿。
#[cfg(target_os = "windows")]
fn read_system_proxy() -> Option<String> {
    use std::process::Command;
    let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    let out = Command::new("reg").args(["query", key]).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);

    let mut enabled = false;
    let mut server = String::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("ProxyEnable") {
            // 形如 "ProxyEnable    REG_DWORD    0x1"，按字段精确比对，
            // 不用 contains：0x10 这类值会被误判成开启
            enabled = rest.split_whitespace().any(|t| t.eq_ignore_ascii_case("0x1"));
        } else if let Some(rest) = line.strip_prefix("ProxyServer") {
            if let Some(pos) = rest.find("REG_SZ") {
                server = rest[pos + 6..].trim().to_string();
            }
        }
    }
    if !enabled || server.is_empty() {
        return None;
    }
    // 可能是 "127.0.0.1:10808" 或 "http=...;https=..."，取第一个
    let first = server.split(';').next().unwrap_or(&server).trim();
    let addr = first.rsplit('=').next().unwrap_or(first).trim();
    if addr.contains(':') {
        Some(addr.to_string())
    } else {
        None
    }
}

/// 跟随系统代理：系统开了就用它，关了就不走代理。
/// 阻塞实现，供启动阶段和异步命令共用。
pub fn sync_system_proxy_blocking() -> Result<bool, ()> {
    #[cfg(target_os = "windows")]
    {
        match read_system_proxy() {
            Some(addr) => {
                let proxy = format!("http://{}", addr);
                for k in ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"] {
                    std::env::set_var(k, &proxy);
                }
                let no_proxy = "localhost,127.0.0.1,::1";
                std::env::set_var("no_proxy", no_proxy);
                std::env::set_var("NO_PROXY", no_proxy);
                Ok(true)
            }
            None => {
                // 跟 unset_proxy 保持一致：no_proxy 也要清，
                // 否则关掉跟随后旧的白名单变量还留着
                for k in [
                    "http_proxy",
                    "HTTP_PROXY",
                    "https_proxy",
                    "HTTPS_PROXY",
                    "all_proxy",
                    "ALL_PROXY",
                    "no_proxy",
                    "NO_PROXY",
                ] {
                    std::env::remove_var(k);
                }
                Ok(false)
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

/// 前端入口：放到阻塞线程池里跑，不占主线程，开关点下去界面不会卡。
#[tauri::command]
pub async fn sync_system_proxy() -> Result<bool, ()> {
    match tauri::async_runtime::spawn_blocking(sync_system_proxy_blocking).await {
        Ok(r) => r,
        Err(_) => Err(()),
    }
}

#[tauri::command]
pub async fn install_plugin(path_list: Vec<String>) -> Result<i32, Error> {
    // 解压插件是同步 IO，放主线程会把安装动画卡住。
    // Error 里有非 Send 的 Box<dyn Error>，所以闭包里先降成 String 再传出来。
    match tauri::async_runtime::spawn_blocking(move || {
        install_plugin_blocking(path_list).map_err(|e| e.to_string())
    })
    .await
    {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(msg)) => Err(Error::Error(msg.into())),
        Err(e) => Err(Error::Error(format!("install task failed: {e}").into())),
    }
}

fn install_plugin_blocking(path_list: Vec<String>) -> Result<i32, Error> {
    let mut success_count = 0;

    for path in path_list {
        if !path.ends_with("potext") {
            continue;
        }
        let path = std::path::Path::new(&path);
        let file_name = path.file_name().unwrap().to_str().unwrap();
        let file_name = file_name.replace(".potext", "");
        if !file_name.starts_with("plugin") {
            return Err(Error::Error(
                "Invalid Plugin: file name must start with plugin".into(),
            ));
        }

        let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
        #[allow(unused_mut)]
        let mut plugin_type: String;
        if let Ok(mut info) = zip.by_name("info.json") {
            let mut content = String::new();
            info.read_to_string(&mut content)?;
            let json: serde_json::Value = serde_json::from_str(&content)?;
            plugin_type = json["plugin_type"]
                .as_str()
                .ok_or(Error::Error("can't find plugin type in info.json".into()))?
                .to_string();
        } else {
            return Err(Error::Error("Invalid Plugin: miss info.json".into()));
        }
        // plugin_type 会拼进解压目标路径，必须限定为普通目录名，
        // 否则带 .. 或绝对路径的包能把文件写到插件目录外面
        if plugin_type.is_empty()
            || plugin_type.contains("..")
            || plugin_type.contains('/')
            || plugin_type.contains('\\')
            || plugin_type.contains(':')
        {
            return Err(Error::Error("Invalid Plugin: illegal plugin_type".into()));
        }
        if zip.by_name("main.js").is_err() {
            return Err(Error::Error("Invalid Plugin: miss main.js".into()));
        }
        let config_path = dirs::config_dir().unwrap();
        let config_path =
            config_path.join(APP.get().unwrap().config().tauri.bundle.identifier.clone());
        let config_path = config_path.join("plugins");
        let config_path = config_path.join(plugin_type);
        let plugin_path = config_path.join(file_name);
        std::fs::create_dir_all(&config_path)?;
        zip.extract(&plugin_path)?;

        success_count += 1;
    }
    Ok(success_count)
}

#[tauri::command]
pub async fn run_binary(
    plugin_type: String,
    plugin_name: String,
    cmd_name: String,
    args: Vec<String>,
) -> Result<Value, Error> {
    // output() 会一直等到子进程退出。插件命令慢或不退时，
    // 跑在主线程上就是整个界面冻死，所以挪到阻塞线程池。
    match tauri::async_runtime::spawn_blocking(move || {
        run_binary_blocking(plugin_type, plugin_name, cmd_name, args).map_err(|e| e.to_string())
    })
    .await
    {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(msg)) => Err(Error::Error(msg.into())),
        Err(e) => Err(Error::Error(format!("run_binary task failed: {e}").into())),
    }
}

fn run_binary_blocking(
    plugin_type: String,
    plugin_name: String,
    cmd_name: String,
    args: Vec<String>,
) -> Result<Value, Error> {
    #[cfg(target_os = "windows")]
    use std::os::windows::process::CommandExt;
    use std::process::Command;

    let config_path = dirs::config_dir().unwrap();
    let config_path = config_path.join(APP.get().unwrap().config().tauri.bundle.identifier.clone());
    let config_path = config_path.join("plugins");
    let config_path = config_path.join(plugin_type);
    let plugin_path = config_path.join(plugin_name);

    #[cfg(target_os = "windows")]
    let mut cmd = Command::new(&cmd_name);
    #[cfg(target_os = "windows")]
    let cmd = cmd.creation_flags(0x08000000);
    #[cfg(not(target_os = "windows"))]
    let mut cmd = Command::new(&cmd_name);

    let output = cmd.args(args).current_dir(plugin_path).output()?;
    Ok(json!({
        "stdout": String::from_utf8_lossy(&output.stdout).to_string(),
        "stderr": String::from_utf8_lossy(&output.stderr).to_string(),
        "status": output.status.code().unwrap_or(-1),
    }))
}

#[tauri::command]
pub async fn font_list() -> Result<Vec<String>, Error> {
    // 枚举系统字体在 Windows 上要几百毫秒，同步执行会卡住设置页首帧
    let handle = tauri::async_runtime::spawn_blocking(|| {
        use font_kit::source::SystemSource;
        SystemSource::new().all_families()
    });
    match handle.await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(e)) => Err(e.into()),
        Err(e) => Err(Error::from(Box::new(e) as Box<dyn std::error::Error>)),
    }
}

#[tauri::command]
pub fn open_devtools(window: tauri::Window) {
    if !window.is_devtools_open() {
        window.open_devtools();
    } else {
        window.close_devtools();
    }
}

/// 把文本写到用户选定的路径。前端 dialog.save 只能拿路径，
/// fs 插件的 scope 限定在应用目录，所以这里单独开一个口子。
#[tauri::command]
pub fn save_text_file(path: String, content: String) -> Result<(), Error> {
    std::fs::write(&path, content.as_bytes())?;
    Ok(())
}
