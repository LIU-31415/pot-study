use lingua::{Language, LanguageDetector, LanguageDetectorBuilder};
use once_cell::sync::OnceCell;

// 检测器构建要加载各语言的 n-gram 模型，是重活。
// 之前每次 lang_detect 都重建一遍（init_lang_detect 预热完就把实例丢了），
// 等于每次划词翻译都在主线程上重跑一次初始化。这里改成进程内单例。
static DETECTOR: OnceCell<LanguageDetector> = OnceCell::new();

fn detector() -> &'static LanguageDetector {
    DETECTOR.get_or_init(|| {
        let languages = vec![
            Language::Chinese,
            Language::Japanese,
            Language::English,
            Language::Korean,
            Language::French,
            Language::Spanish,
            Language::German,
            Language::Russian,
            Language::Italian,
            Language::Portuguese,
            Language::Turkish,
            Language::Arabic,
            Language::Vietnamese,
            Language::Thai,
            Language::Indonesian,
            Language::Malay,
            Language::Hindi,
            Language::Mongolian,
            Language::Bokmal,
            Language::Nynorsk,
            Language::Persian,
            Language::Ukrainian,
        ];
        LanguageDetectorBuilder::from_languages(&languages).build()
    })
}

pub fn init_lang_detect() {
    // 预热：首次调用时构建，之后所有请求复用同一实例
    let _ = detector().detect_language_of("Hello Language");
}

fn detect_lang(text: &str) -> String {
    let lang = match detector().detect_language_of(text) {
        Some(v) => v,
        None => return "en".to_string(),
    };
    let code = match lang {
        Language::Chinese => "zh_cn",
        Language::Japanese => "ja",
        Language::English => "en",
        Language::Korean => "ko",
        Language::French => "fr",
        Language::Spanish => "es",
        Language::German => "de",
        Language::Russian => "ru",
        Language::Italian => "it",
        Language::Portuguese => "pt_pt",
        Language::Turkish => "tr",
        Language::Arabic => "ar",
        Language::Vietnamese => "vi",
        Language::Thai => "th",
        Language::Indonesian => "id",
        Language::Malay => "ms",
        Language::Hindi => "hi",
        Language::Mongolian => "mn_cy",
        Language::Bokmal => "nb_no",
        Language::Nynorsk => "nn_no",
        Language::Persian => "fa",
        Language::Ukrainian => "uk",
    };
    code.to_string()
}

#[tauri::command]
pub async fn lang_detect(text: String) -> Result<String, ()> {
    // 长文本的检测本身也要时间，放到阻塞线程池，别占 UI 主线程
    match tauri::async_runtime::spawn_blocking(move || detect_lang(&text)).await {
        Ok(v) => Ok(v),
        Err(_) => Err(()),
    }
}
