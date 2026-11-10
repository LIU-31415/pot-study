// 学习模式 × 正常翻译模式 的服务配置双向同步引擎。
// 设计要点：
// - 幂等：每次应用前先比对当前状态，已同步则不动，防止两窗口双向回环
// - 冲突不破坏：被替换的旧配置只降位（取消选中 / 移出激活位），永远不删除
// - 标准（OpenAI 兼容）服务才双向同步；非标准翻译服务不写入学习模式（单向豁免）
// - 同步开关默认关闭，且只由用户手动开启；引擎不做任何自动开启动作
import { store } from './store';
import { emit } from '@tauri-apps/api/event';
import { createServiceInstanceKey, INSTANCE_NAME_CONFIG_KEY } from './service_instance';
import { resolveActiveStudyService } from './study_service';

export const SYNC_ENABLED_KEY = 'study_sync_enabled';

async function readConfig(key, def) {
    const v = await store.get(key);
    return v === null || v === undefined ? def : v;
}

// 与 useConfig 的同步行为保持一致：写 store + 发事件，跨窗口生效
async function writeConfig(key, value) {
    await store.set(key, value);
    await store.save();
    const eventKey = key.replaceAll('.', '_').replaceAll('@', ':');
    await emit(`${eventKey}_changed`, value);
}

export function eventKeyOf(key) {
    return `${key.replaceAll('.', '_').replaceAll('@', ':')}_changed`;
}

// 把同步结果落成结构化通知，供学习模式页的横幅展示（关闭即清除）
export async function saveSyncNotice(result) {
    if (!result) return;
    await writeConfig('study_sync_notice', { ...result, ts: Date.now() });
}

// 镜像 OpenAI 实例时使用的默认翻译 prompt（与 openai 服务默认配置一致）
const DEFAULT_TRANSLATE_PROMPT = [
    {
        role: 'system',
        content:
            'You are a professional translation engine, please translate the text into a colloquial, professional, elegant and fluent content, without the style of machine translation. You must only translate the text content, never interpret it.',
    },
    { role: 'user', content: 'Translate into $to:\n"""\n$text\n"""' },
];
const DEFAULT_REQUEST_ARGUMENTS = JSON.stringify({
    temperature: 0.1,
    top_p: 0.99,
    frequency_penalty: 0,
    presence_penalty: 0,
});

function sameStudyVsInstance(entry, cfg) {
    if (!entry || !cfg) return false;
    return (
        String(entry.url ?? '') === String(cfg.requestPath ?? '') &&
        String(entry.apiKey ?? '') === String(cfg.apiKey ?? '') &&
        String(entry.model ?? '') === String(cfg.model ?? '')
    );
}

function newStudyId() {
    return `study_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ———— 翻译模式 → 学习模式 ————
// 触发时机：翻译服务列表变化（含激活位移动）、激活实例配置保存。
// 仅标准（service === 'openai'）服务参与；其余返回 null，学习模式原配置不动。
// 返回 { direction: 'to_study', name, replaced } 或 null（未开启 / 非标准 / 已同步）。
export async function syncTranslateToStudy() {
    if ((await readConfig(SYNC_ENABLED_KEY, false)) !== true) return null;

    const list = (await readConfig('translate_service_list', [])).filter(Boolean);
    const activeKey = list[0];
    if (!activeKey) return null;
    const cfg = await readConfig(activeKey, {});
    if (cfg?.service !== 'openai') return null;

    const services = await readConfig('study_services', []);
    const entry = services.find((s) => s.linkedInstance === activeKey) ?? null;
    const desired = {
        id: entry?.id ?? newStudyId(),
        name: entry?.name || String(cfg[INSTANCE_NAME_CONFIG_KEY] || 'OpenAI 服务'),
        url: String(cfg.requestPath ?? ''),
        apiKey: String(cfg.apiKey ?? ''),
        model: String(cfg.model ?? ''),
        linkedInstance: activeKey,
    };

    let applied = false;
    if (!entry) {
        await writeConfig('study_services', [...services, desired]);
        applied = true;
    } else if (!sameStudyVsInstance(entry, cfg)) {
        await writeConfig(
            'study_services',
            services.map((s) => (s.id === entry.id ? desired : s))
        );
        applied = true;
    }

    const currentId = await readConfig('study_service_id', '');
    let replaced = null;
    if (currentId !== desired.id) {
        if (currentId) {
            const prev = services.find((s) => s.id === currentId);
            replaced = prev?.name ?? null; // 旧配置停用（取消选中），保留在列表中
        }
        await writeConfig('study_service_id', desired.id);
        applied = true;
    }
    return applied ? { direction: 'to_study', name: desired.name, replaced } : null;
}

// ———— 学习模式 → 翻译模式 ————
// 触发时机：study_services / study_service_id 变化。
// 没有镜像实例时创建一个 openai@xxx 并置顶激活；已有则更新字段并确保激活。
// 返回 { direction: 'to_translate', name, replaced } 或 null。
export async function syncStudyToTranslate() {
    if ((await readConfig(SYNC_ENABLED_KEY, false)) !== true) return null;

    const services = await readConfig('study_services', []);
    const activeId = await readConfig('study_service_id', '');
    const entry = resolveActiveStudyService(services, activeId);
    if (!entry || !entry.url) return null;

    const list = (await readConfig('translate_service_list', [])).filter(Boolean);
    let linked =
        entry.linkedInstance && list.includes(entry.linkedInstance)
            ? entry.linkedInstance
            : '';

    let updated = false;
    if (linked) {
        const cfg = await readConfig(linked, {});
        if (cfg && !sameStudyVsInstance(entry, cfg)) {
            // 只覆盖同步负责的字段，prompt 等用户自定义内容不动
            await writeConfig(linked, {
                ...cfg,
                requestPath: entry.url,
                apiKey: entry.apiKey,
                model: entry.model,
            });
            updated = true;
        }
    } else {
        // 尚无镜像实例：按 openai 服务默认结构创建一个
        const instanceKey = createServiceInstanceKey('openai');
        await writeConfig(instanceKey, {
            [INSTANCE_NAME_CONFIG_KEY]: entry.name,
            service: 'openai',
            requestPath: entry.url,
            model: entry.model ?? '',
            apiKey: entry.apiKey ?? '',
            stream: false,
            promptList: DEFAULT_TRANSLATE_PROMPT,
            requestArguments: DEFAULT_REQUEST_ARGUMENTS,
        });
        // 回填映射（会触发一次 study_services 事件，引擎重入后幂等即停）
        await writeConfig(
            'study_services',
            services.map((s) => (s.id === entry.id ? { ...s, linkedInstance: instanceKey } : s))
        );
        linked = instanceKey;
        updated = true;
    }

    // 激活 = 移到列表首位；原激活服务降位保留，不删除
    if (list[0] !== linked) {
        const previousKey = list[0];
        let replaced = null;
        if (previousKey && previousKey !== linked) {
            const prevCfg = await readConfig(previousKey, {});
            replaced = String(prevCfg?.[INSTANCE_NAME_CONFIG_KEY] || previousKey);
        }
        const nextList = [linked, ...list.filter((k) => k !== linked)];
        await writeConfig('translate_service_list', nextList);
        return { direction: 'to_translate', name: entry.name, replaced };
    }
    // 字段有更新但激活位未变，也要如实上报
    return updated ? { direction: 'to_translate', name: entry.name, replaced: null } : null;
}
