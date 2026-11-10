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
    } else if (path === '' ) {
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

function parseModels(data) {
    const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
    return list
        .map((m) => (typeof m === 'string' ? m : m?.id))
        .filter(Boolean)
        .sort((a, b) => String(a).localeCompare(String(b)));
}

// 自动检测：按候选地址逐个尝试，先 Bearer 鉴权，全部 401/403 时再补一轮 api-key。
// 成功返回 { models, url }，失败抛出带各次尝试原因的 Error。
export async function fetchModelList(inputUrl, apiKey) {
    const normalized = /^https?:\/\//i.test(String(inputUrl ?? ''))
        ? String(inputUrl)
        : normalizeInputUrl(inputUrl);
    const candidates = modelsUrlCandidates(normalized);
    if (candidates.length === 0) {
        throw new Error('invalid url');
    }
    const key = String(apiKey ?? '');
    const errors = [];

    for (const url of candidates) {
        try {
            const models = parseModels(await getJson(url, { Authorization: `Bearer ${key}` }));
            if (models.length > 0) return { models, url };
            errors.push(`${url}: empty model list`);
        } catch (e) {
            errors.push(`${url}: ${errMsg(e)}`);
        }
    }
    // 部分网关（Azure 风格）用 api-key 头，补一轮兜底
    for (const url of candidates) {
        try {
            const models = parseModels(await getJson(url, { 'api-key': key }));
            if (models.length > 0) return { models, url };
        } catch {
            // 静默兜底，失败原因以 Bearer 一轮为准
        }
    }
    throw new Error(errors.join('；'));
}

// 把探测命中的 models 地址换算成对话端点地址。
// 存储时统一用完整 /chat/completions，避开 openai 内置服务对「只填到 /v1」
// 这样的地址二次拼 /v1 的缺陷（会变成 /v1/v1/chat/completions）。
export function toChatCompletionsUrl(modelsUrl) {
    try {
        const u = new URL(modelsUrl);
        const path = u.pathname.replace(/\/+$/, '');
        if (path.endsWith('/models')) {
            return `${u.origin}${path.replace(/\/models$/, '/chat/completions')}`;
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
