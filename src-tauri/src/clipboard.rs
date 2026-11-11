use crate::window::text_translate;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{ClipboardManager, Manager};

pub struct ClipboardMonitorEnableWrapper(pub Mutex<String>);

// 每次启动监听都递增。旧线程醒来发现代号变了就自己退出，
// 否则快速「关→开」会让两个线程并存，各吃一份剪贴板
static CLIPBOARD_GEN: AtomicU64 = AtomicU64::new(0);

pub fn start_clipboard_monitor(app_handle: tauri::AppHandle) {
    let my_gen = CLIPBOARD_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    // 用独立 OS 线程而不是 async task：循环里是 std::thread::sleep，
    // 放进 tokio 会永久占住一个 worker，核数少的机器上会明显拖慢其他异步命令
    std::thread::spawn(move || {
        let mut pre_text = "".to_string();
        loop {
            // 已经有更新的监视线程起来了，这个就退场
            if CLIPBOARD_GEN.load(Ordering::SeqCst) != my_gen {
                break;
            }
            let handle = app_handle.app_handle();
            let state = handle.state::<ClipboardMonitorEnableWrapper>();
            if let Ok(clipboard_monitor) = state.0.try_lock() {
                if clipboard_monitor.contains("true") {
                    if let Ok(result) = app_handle.clipboard_manager().read_text() {
                        match result {
                            Some(v) => {
                                if v != pre_text {
                                    text_translate(v.clone());
                                    pre_text = v;
                                }
                            }
                            None => {}
                        }
                    }
                } else {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
    });
}
