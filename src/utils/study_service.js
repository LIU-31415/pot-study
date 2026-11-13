// 学习模式专用的 OpenAI 兼容服务工具：
// 标准化配置 = 接口地址 + 密钥，模型列表由本模块自动探测拉取。
import { store } from './store';
import { INSTANCE_NAME_CONFIG_KEY } from './service_instance';

const REQUEST_TIMEOUT = 12000;

// 把用户随手填的地址规整成绝对 URL（缺协议时默认 https）
export function normalizeInputUrl(input) {
    if (!input) return null;
    let raw = String(input).trim();
    if (!raw) return null;
    if (!/^https?:\/\//i.test(raw)) {
        raw = `https://${raw}`;
    }
    try {
        const u = new URL(raw);
        if (!u.hostname) return null;
        return u.href;
    } catch {
        return null;
    }
}

// 由用户填的地址推导候选 models 地址，按可能性排序，逐个尝试：
// - 结尾是 /models          → 直接用
// - 结尾是 /chat/completions → 换成同目录 /models
// - 结尾是 /v1、/hf/v1 等目录 → 目录后拼 /models，再补一发标准 /v1/models
// - 只有域名                 → /v1/models 优先，/models 兜底
export function modelsUrlCandidates(normalizedUrl) {
    let u;
    try {
        u = new URL(normalizedUrl);
    } catch {
        return [];
    }
    const origin = u.origin;
    const path = u.pathname.replace(/\/+$/, '');
    const out = [];
    if (path.endsWith('/models')) {
        out.push(`${origin}${path}`);
    } else if (path.endsWith('/chat/completions')) {
        out.push(`${origin}${path.replace(/\/chat\/completions$/, '/models')}`);
    } else if (path === '') {
        out.push(`${origin}/v1/models`);
        out.push(`${origin}/models`);
    } else {
        out.push(`${origin}${path}/models`);
        if (path !== '/v1') {
            out.push(`${origin}/v1/models`);
        }
    }
    return [...new Set(out)];
}

function errMsg(e) {
    if (e && typeof e.status === 'number') return `HTTP ${e.status}`;
    if (e?.name === 'AbortError') return 'timeout';
    return e?.message || 'network error';
}

async function getJson(url, headers) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);
    try {
        const res = await window.fetch(url, { method: 'GET', headers, signal: ctrl.signal });
        if (!res.ok) {
            throw { status: res.status };
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// 网关自报的端点最可靠：有 chat/completions、responses、messages 之一，
// 才是能对话的模型。magpie 会返回 native_endpoints，
// 第三方 OpenAI 兼容服务通常只有 id，那就返回 null 交给名字判断。
const CHAT_ENDPOINT_RE = /\/(chat\/completions|responses|messages)\b/;

function endpointCanChat(m) {
    if (!m || typeof m !== 'object') return null;
    const eps = m.native_endpoints;
    if (!Array.isArray(eps) || eps.length === 0) return null;
    return eps.some((e) => CHAT_ENDPOINT_RE.test(String(e)));
}

// 返回 [{ id, chat }]，chat 为 true/false/null（null = 网关没说，靠名字猜）
function parseModels(data) {
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    const out = [];
    for (const m of list) {
        const id = typeof m === 'string' ? m : m?.id;
        if (!id) continue;
        out.push({ id: String(id), chat: endpointCanChat(m) });
    }
    out.sort((a, b) => a.id.localeCompare(b.id));
    return out;
}

// 非对话模型的名称特征：向量、重排、语音、图像、审核。
// 这些模型挂在同一个 /v1/models 下，但发不了 chat/completions，
// 出现在翻译模型列表里只会让人误选。
// 只按名字判断，所以宁可漏放也不误杀：多模态对话模型（名字里带 vision / vl）照常保留。
const NON_CHAT_KEYWORDS = [
    'embed',
    'rerank',
    'whisper',
    'tts',
    'speech',
    'audio',
    'transcribe',
    'moderation',
    'dall-e',
    'diffusion',
    'image',
    'imagen',
    'flux',
    'sdxl',
    'midjourney',
    'suno',
    // 视频与动画：agnes-video-2.5 这类名字里没有 image，靠单独一条兜
    'video',
    'veo',
    'sora',
    'kling',
    'runway',
    'pika',
    'seedance',
    'hailuo',
    'animate',
    // 其余非对话产物：音乐、3D、OCR
    'music',
    'audiocraft',
    'mesh',
    'ocr',
    'bge',
    'gte-',
    'text-similarity',
    'realtime',
    'babbage',
    'curie',
    'davinci',
    // 老 completion 模型；不写成裸 ada，否则 canada 这类名字会被误杀
    'text-ada',
];

export function isChatModel(name) {
    const n = String(name ?? '').toLowerCase();
    if (!n) return false;
    return !NON_CHAT_KEYWORDS.some((k) => n.includes(k));
}

// 过滤模型列表，返回 { models, hidden }。
// 网关自报端点优先（magpie 这种），没自报才按名字猜（第三方服务）。
// 全被筛掉时回退原列表：宁可多显示几个，也不能给一个空下拉，
// 名字判断本来就有猜的成分，不能让它把可用服务变成不可用。
export function filterChatModels(list) {
    const arr = Array.isArray(list) ? list : [];
    const kept = [];
    let hidden = 0;
    for (const item of arr) {
        const id = typeof item === 'string' ? item : item?.id;
        if (!id) continue;
        const chat = typeof item === 'string' ? null : item.chat;
        const ok = chat === true ? true : chat === false ? false : isChatModel(id);
        if (ok) kept.push(String(id));
        else hidden++;
    }
    if (kept.length === 0) {
        const all = arr.map((i) => (typeof i === 'string' ? i : i?.id)).filter(Boolean);
        return { models: all, hidden: 0 };
    }
    return { models: kept, hidden };
}

// 自动检测：按候选地址逐个尝试，先 Bearer 鉴权，全部 401/403 时再补一轮 api-key。
// 成功返回 { models, hidden, url }（models 已滤掉非对话模型），
// 失败抛出带各次尝试原因的 Error。
export async function fetchModelList(inputUrl, apiKey) {
    const normalized = /^https?:\/\//i.test(String(inputUrl ?? '')) ? String(inputUrl) : normalizeInputUrl(inputUrl);
    const candidates = modelsUrlCandidates(normalized);
    if (candidates.length === 0) {
        throw new Error('invalid url');
    }
    const key = String(apiKey ?? '');
    const errors = [];

    for (const url of candidates) {
        try {
            const raw = parseModels(await getJson(url, { Authorization: `Bearer ${key}` }));
            if (raw.length > 0) return { ...filterChatModels(raw), url };
            errors.push(`${url}: empty model list`);
        } catch (e) {
            errors.push(`${url}: ${errMsg(e)}`);
        }
    }
    // 部分网关（Azure 风格）用 api-key 头，补一轮兜底
    for (const url of candidates) {
        try {
            const raw = parseModels(await getJson(url, { 'api-key': key }));
            if (raw.length > 0) return { ...filterChatModels(raw), url };
        } catch {
            // 静默兜底，失败原因以 Bearer 一轮为准
        }
    }
    throw new Error(errors.join('；'));
}

// 把用户填的地址换算成对话端点地址。
// 存储时统一用完整 /chat/completions，避开 openai 内置服务对「只填到 /v1」
// 这样的地址二次拼 /v1 的缺陷（会变成 /v1/v1/chat/completions）。
export function toChatCompletionsUrl(modelsUrl) {
    try {
        const u = new URL(modelsUrl);
        const path = u.pathname.replace(/\/+$/, '');
        if (path.endsWith('/models')) {
            return `${u.origin}${path.replace(/\/models$/, '/chat/completions')}`;
        }
        // 已经是完整端点，不动
        if (path.endsWith('/chat/completions')) {
            return `${u.origin}${path}`;
        }
        // 只填到 /v1、/v1beta 这类版本目录：补全端点
        if (/\/v\d+[a-z]*$/i.test(path)) {
            return `${u.origin}${path}/chat/completions`;
        }
    } catch {
        // 无法解析就原样返回，交由后续调用时的校验兼错
    }
    return modelsUrl;
}

// 当前生效的学习模式服务：优先选中项，否则取第一个
export function resolveActiveStudyService(services, id) {
    if (!Array.isArray(services) || services.length === 0) return null;
    return services.find((s) => s.id === id) ?? services[0];
}

// 已知的本地网关。magpie（github.com/yetone/magpie）固定监听 127.0.0.1:3425，
// 说 OpenAI 兼容协议，key 用 "magpie" 占位。
// 以后加别的本地网关（Ollama、LM Studio 等）往这个列表里塞一条就行。
export const LOCAL_GATEWAYS = [{ id: 'magpie', name: 'magpie', base: 'http://127.0.0.1:3425', apiKey: 'magpie' }];

// 判断一个接口地址是不是指向本地网关（magpie）。
// 思考强度用的是 magpie 自己的 reasoning 字段，第三方服务不认这个写法（不报错但会忽略），
// 所以只在本地网关上才显示、才发送，别家一律跟随对方默认。
// hostname 允许 127.0.0.1 / localhost / ::1，端口必须和网关一致。
export function isLocalGatewayUrl(url) {
    if (!url) return false;
    let u;
    try {
        u = new URL(String(url));
    } catch {
        return false;
    }
    const host = u.hostname.replace(/^\[|\]$/g, '');
    if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') return false;
    return LOCAL_GATEWAYS.some((gw) => {
        try {
            return new URL(gw.base).port === u.port;
        } catch {
            return false;
        }
    });
}

// 本地回环探测要快：网关没开时连接会立刻失败，2.5 秒足够。
// 不能用 fetchModelList 的多候选策略，那个要跑十几秒。
const PROBE_TIMEOUT = 2500;

async function probeModels(url, apiKey) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT);
    try {
        const res = await window.fetch(url, {
            method: 'GET',
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: ctrl.signal,
        });
        if (!res.ok) return null;
        return parseModels(await res.json());
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

// 探测本地网关。探到返回 { id, name, base, url, apiKey, models, hidden }，否则 null。
// models 已滤掉非对话模型，和学习模式下拉看到的是同一份。
export async function detectLocalGateway() {
    for (const gw of LOCAL_GATEWAYS) {
        const raw = await probeModels(`${gw.base}/v1/models`, gw.apiKey);
        if (raw && raw.length > 0) {
            return {
                id: gw.id,
                name: gw.name,
                base: gw.base,
                url: toChatCompletionsUrl(`${gw.base}/v1/models`),
                apiKey: gw.apiKey,
                ...filterChatModels(raw),
            };
        }
    }
    return null;
}

// 旧版配置迁移：旧版复用「服务设置」里的 OpenAI 翻译实例，
// 取选中实例（或第一个 openai 实例）转成独立的标准化条目。
// 只做一次：用户把服务全删光后重新进页面，不应该再被迁移回来。
export async function buildLegacyStudyService() {
    let result = null;
    try {
        if ((await store.get('study_legacy_migrated')) === true) return null;

        const existing = await store.get('study_services');
        if (!Array.isArray(existing) || existing.length === 0) {
            const list = (await store.get('translate_service_list')) ?? [];
            const selectedKey = await store.get('study_translate_service');
            const legacyModel = (await store.get('study_translate_model')) ?? '';

            const ordered = [selectedKey, ...list.filter((k) => k !== selectedKey)].filter(Boolean);
            for (const key of ordered) {
                const cfg = (await store.get(key)) ?? {};
                if (cfg?.service !== 'openai') continue;
                if (!cfg.requestPath) continue;
                result = {
                    id: `study_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                    name: String(cfg[INSTANCE_NAME_CONFIG_KEY] || 'OpenAI 服务'),
                    url: String(cfg.requestPath),
                    apiKey: String(cfg.apiKey ?? ''),
                    model: String(legacyModel || cfg.model || ''),
                };
                break;
            }
        }
    } catch {
        // 迁移失败不影响页面使用，返回 null 走全新配置流程
    }
    // 不管有没有找到可迁移项都标记一次，避免每次进页面重扫
    try {
        await store.set('study_legacy_migrated', true);
        await store.save();
    } catch {}
    return result;
}
