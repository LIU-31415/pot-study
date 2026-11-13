import { Button, Card, CardBody, Input, Modal, ModalBody, ModalContent, ModalHeader } from '@nextui-org/react';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useRef, useState } from 'react';
import { LuLink, LuPencil, LuPlus, LuRefreshCw, LuTrash2, LuX } from 'react-icons/lu';

import ModelPicker from './ModelPicker';
import StudySelect from './StudySelect';
import { useConfig, useToastStyle } from '../../../../hooks';
import { store } from '../../../../utils/store';
import { createServiceInstanceKey, INSTANCE_NAME_CONFIG_KEY } from '../../../../utils/service_instance';
import { defaultRequestArguments } from '../../../../services/translate/openai/Config';
import {
    normalizeInputUrl,
    fetchModelList,
    buildLegacyStudyService,
    resolveActiveStudyService,
    toChatCompletionsUrl,
    detectLocalGateway,
    isLocalGatewayUrl,
} from '../../../../utils/study_service';

// 导出到翻译服务时用的默认提示词，与 openai 服务新建实例时的默认值一致
const DEFAULT_TRANSLATE_PROMPT = [
    {
        role: 'system',
        content:
            'You are a professional translation engine, please translate the text into a colloquial, professional, elegant and fluent content, without the style of machine translation. You must only translate the text content, never interpret it.',
    },
    { role: 'user', content: 'Translate into $to:\n"""\n$text\n"""' },
];

function newId() {
    return `study_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// 服务下拉里的两个操作项，不是真服务，所以用不会和 id 撞的前缀
const ADD_SERVICE_KEY = '__add_service__';
const ADD_LOCAL_KEY = '__add_local__';

// 模型名去掉供应商前缀：agi-tongji-edu/GLM-5.3-Flash → GLM-5.3-Flash
function shortModel(m) {
    return (
        String(m ?? '')
            .split('/')
            .pop() || ''
    );
}

export default function Study() {
    const { t } = useTranslation();
    const toastStyle = useToastStyle();
    const [studyServices, setStudyServices] = useConfig('study_services', []);
    const [studyServiceId, setStudyServiceId] = useConfig('study_service_id', '');
    // 单向导出目标：翻译服务列表
    const [translateServiceList, setTranslateServiceList] = useConfig('translate_service_list', []);
    // 星标模型：一份列表跨服务共用，换服务不用重新标
    // 常用预设：{ sid, model } 组合，可以跨服务，点一下就连服务带模型一起切过去
    const [pinnedModels, setPinnedModels] = useConfig('study_pinned_models', []);

    const [models, setModels] = useState([]);
    // 被过滤掉的非对话模型数量，只在模型面板底部提示一句
    const [hiddenModels, setHiddenModels] = useState(0);
    // 模型列表请求序号：服务切得快时，先发的慢响应不能覆盖后发的
    const modelReqRef = useRef(0);
    const [modelLoading, setModelLoading] = useState(false);
    const [modelError, setModelError] = useState('');

    // 服务表单弹窗：只用来新增或编辑一条服务，选服务走页面上的下拉
    const [formOpen, setFormOpen] = useState(false);
    const [editingId, setEditingId] = useState('');
    const [fName, setFName] = useState('');
    const [fUrl, setFUrl] = useState('');
    const [fKey, setFKey] = useState('');
    const [fChecking, setFChecking] = useState(false);
    const [fStatus, setFStatus] = useState(null); // { ok: boolean, text: string }

    // 删除二次确认（3 秒内再点一次生效）
    const [pendingDelete, setPendingDelete] = useState('');

    // 本地网关探测：页面打开时静默探一次，探到只给提示，不动当前生效项
    const [localFound, setLocalFound] = useState(null);
    const [localChecking, setLocalChecking] = useState(false);
    // 探测是异步的，回调里要读最新的服务列表，不能用闭包里的旧值
    const servicesRef = useRef([]);
    // 导出 in-flight 标记，防连点
    const exportingRef = useRef(false);
    // 刚检测到的模型列表：保存后 active 变化会触发自动加载，
    // 没有这个缓存就会把同一次检测的 GET 再发一遍
    const lastDetectedRef = useRef(null);

    const services = studyServices ?? [];
    const active = resolveActiveStudyService(services, studyServiceId);
    // 思考强度只对本地 magpie 网关开放：reasoning 是它的私有字段，
    // 第三方服务不认（不报错但会忽略），所以那些服务上不显示这个选项，跟随对方默认
    const reasoningAvailable = isLocalGatewayUrl(active?.url);
    servicesRef.current = services;

    // 旧版配置（复用翻译服务列表）首次进入时一次性迁移
    useEffect(() => {
        (async () => {
            if (services.length > 0) return;
            const entry = await buildLegacyStudyService();
            if (entry) {
                setStudyServices([entry]);
                setStudyServiceId(entry.id);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 静默探测本地网关：探不到什么都不显示，不打扰用户；
    // 已经配过同一个地址也不提示，避免重复添加的噪声
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const gw = await detectLocalGateway();
            if (cancelled || !gw) return;
            if (servicesRef.current.some((s) => s.url === gw.url)) return;
            setLocalFound(gw);
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const loadModels = async (entry) => {
        if (!entry?.url) return;
        // 每次请求领一个号，回来后只有仍是最新那次才允许写界面，
        // 否则 A 服务慢、B 服务快时，A 的晚到结果会把 B 的列表冲掉
        const reqId = ++modelReqRef.current;
        // 刚在「检测并保存」里拿过同一地址的模型列表，直接用，
        // 否则保存后 active 变化会马上再拉一次，白白多一次 GET
        const cached = lastDetectedRef.current;
        if (
            cached &&
            cached.url === entry.url &&
            cached.apiKey === (entry.apiKey ?? '') &&
            Date.now() - cached.ts < 30000
        ) {
            lastDetectedRef.current = null; // 用一次就作废，避免后续误用
            setModels(cached.models);
            setHiddenModels(cached.hidden ?? 0);
            setModelError('');
            setModelLoading(false);
            return;
        }
        setModelLoading(true);
        setModelError('');
        try {
            const { models: arr, hidden } = await fetchModelList(entry.url, entry.apiKey);
            if (reqId !== modelReqRef.current) return;
            setModels(arr);
            setHiddenModels(hidden ?? 0);
        } catch (e) {
            if (reqId !== modelReqRef.current) return;
            setModels([]);
            setHiddenModels(0);
            setModelError(String(e?.message ?? e));
        } finally {
            if (reqId === modelReqRef.current) setModelLoading(false);
        }
    };

    useEffect(() => {
        if (active) {
            loadModels(active);
        } else {
            setModels([]);
            setHiddenModels(0);
            setModelError('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?.id, active?.url, active?.apiKey]);

    // 模型选择写回当前服务条目
    const pickModel = (model) => {
        if (!active) return;
        setStudyServices(services.map((s) => (s.id === active.id ? { ...s, model } : s)));
    };

    // 星标切换：收藏的是「哪个服务 + 哪个模型」，所以能跨服务当预设用
    const togglePin = (sid, model) => {
        const list = pinnedModels ?? [];
        const exists = list.some((p) => p.sid === sid && p.model === model);
        setPinnedModels(exists ? list.filter((p) => !(p.sid === sid && p.model === model)) : [...list, { sid, model }]);
    };

    // 点常用胶囊：服务和模型一起切
    const applyPin = (pin) => {
        if (!services.some((s) => s.id === pin.sid)) return;
        setStudyServiceId(pin.sid);
        setStudyServices(services.map((s) => (s.id === pin.sid ? { ...s, model: pin.model } : s)));
    };

    // 思考强度写回当前服务条目：'off' 关闭思考，其余给 effort，空串表示跟随模型默认
    const pickReasoning = (reasoningEffort) => {
        if (!active) return;
        setStudyServices(services.map((s) => (s.id === active.id ? { ...s, reasoningEffort } : s)));
    };

    const resetForm = () => {
        setEditingId('');
        setFName('');
        setFUrl('');
        setFKey('');
        setFStatus(null);
    };

    const openAdd = () => {
        resetForm();
        setFormOpen(true);
    };

    const openEdit = (entry) => {
        setEditingId(entry.id);
        setFName(entry.name ?? '');
        setFUrl(entry.url ?? '');
        setFKey(entry.apiKey ?? '');
        setFStatus(null);
        setFormOpen(true);
    };

    const closeForm = () => {
        resetForm();
        setFormOpen(false);
    };

    // 保存条目；detectedModels 传 undefined 表示没做检测（直接保存）
    const saveEntry = (url, key, detectedModels) => {
        let name = fName.trim();
        if (!name) {
            try {
                name = new URL(url).host;
            } catch {
                name = 'OpenAI 服务';
            }
        }
        const old = editingId ? services.find((s) => s.id === editingId) : null;
        let model = old?.model ?? '';
        if (detectedModels) {
            if (!model || !detectedModels.includes(model)) {
                model = detectedModels[0] ?? '';
            }
        }
        const entry = old
            ? { ...old, name, url, apiKey: key, model }
            : { id: newId(), name, url, apiKey: key, model: detectedModels?.[0] ?? '' };
        const next = old ? services.map((s) => (s.id === editingId ? entry : s)) : [...services, entry];
        setStudyServices(next);
        setStudyServiceId(entry.id);
        if (detectedModels) setModels(detectedModels);
        closeForm();
    };

    const checkAndSave = async () => {
        const url = normalizeInputUrl(fUrl);
        if (!url) {
            setFStatus({ ok: false, text: t('config.study.url_invalid') });
            return;
        }
        setFChecking(true);
        setFStatus(null);
        try {
            const { models: arr, hidden, url: usedUrl } = await fetchModelList(url, fKey);
            if (arr.length === 0) throw new Error('empty model list');
            const finalUrl = toChatCompletionsUrl(usedUrl);
            // 把刚拿到的列表留给 loadModels，避免保存后又拉一遍
            lastDetectedRef.current = {
                url: finalUrl,
                apiKey: fKey,
                models: arr,
                hidden: hidden ?? 0,
                ts: Date.now(),
            };
            saveEntry(finalUrl, fKey, arr);
        } catch (e) {
            setFStatus({
                ok: false,
                text: `${t('config.study.detect_fail')}${String(e?.message ?? e)}`,
            });
        } finally {
            setFChecking(false);
        }
    };

    const saveDirectly = () => {
        const url = normalizeInputUrl(fUrl);
        if (!url) {
            setFStatus({ ok: false, text: t('config.study.url_invalid') });
            return;
        }
        // 也要换算成完整端点：直接存 /v1 会被 openai 服务再拼一次，
        // 变成 /v1/v1/chat/completions，每句都失败
        saveEntry(toChatCompletionsUrl(url), fKey, undefined);
    };

    // 服务顺序只影响下拉里的排列，不动当前生效项；
    // 想让常用的服务排到最上面时用它
    const moveService = (id, dir) => {
        const from = services.findIndex((s) => s.id === id);
        const to = from + dir;
        if (from < 0 || to < 0 || to >= services.length) return;
        const next = [...services];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        setStudyServices(next);
    };

    const removeEntry = (id) => {
        if (pendingDelete !== id) {
            setPendingDelete(id);
            setTimeout(() => {
                setPendingDelete((p) => (p === id ? '' : p));
            }, 3000);
            return;
        }
        const next = services.filter((s) => s.id !== id);
        setStudyServices(next);
        setPendingDelete('');
        if (active?.id === id) {
            setStudyServiceId(next[0]?.id ?? '');
        }
    };

    // 把当前学习服务写成一条翻译服务实例（单向：只往翻译服务写，不回头改学习模式）
    const exportToService = async () => {
        // 连点会重复执行完整查重与写入，用 in-flight 标记挡住
        if (exportingRef.current) return;
        exportingRef.current = true;
        try {
            await doExport();
        } finally {
            exportingRef.current = false;
        }
    };

    const doExport = async () => {
        if (!active?.url) {
            toast(t('config.study.export_no_url'), { duration: 3000, style: toastStyle });
            return;
        }
        const list = translateServiceList ?? [];

        // 地址和模型都相同就不重复创建，避免点几次攒出一堆重复实例。
        // 并行读：实例多时串行 await 会把按钮的响应拖成上百毫秒
        const cfgs = await Promise.all(list.map(async (k) => [k, (await store.get(k)) ?? {}]));
        const dup = cfgs.find(
            ([, cfg]) => cfg.requestPath === active.url && (cfg.model ?? '') === (active.model ?? '')
        );
        if (dup) {
            const [dupKey, dupCfg] = dup;
            toast(
                t('config.study.export_exists', {
                    name: dupCfg[INSTANCE_NAME_CONFIG_KEY] || dupKey,
                }),
                { duration: 4000, style: toastStyle }
            );
            return;
        }

        const key = createServiceInstanceKey('openai');
        // 实例名只取模型名的最后一段：agi-tongji-edu/Kimi-K3.1-Pro → Kimi-K3.1-Pro
        // 服务名（magpie）或完整路径在服务列表里都认不出具体是哪个模型
        const shortName = String(active.model || '')
            .split('/')
            .pop();
        await store.set(key, {
            [INSTANCE_NAME_CONFIG_KEY]: shortName || active.name || 'OpenAI',
            service: 'openai',
            requestPath: active.url,
            model: active.model ?? '',
            apiKey: active.apiKey ?? '',
            stream: false,
            promptList: DEFAULT_TRANSLATE_PROMPT,
            requestArguments: defaultRequestArguments,
        });
        await store.save();

        // 列表为空时它就是唯一可用的服务；否则追加到末尾，不改变列表顺序。
        // 注意：翻译窗口会渲染列表里所有启用的服务，不是只跑第一项。
        setTranslateServiceList(list.length === 0 ? [key] : [...list, key]);
        toast(t('config.study.export_done', { name: active.name }), {
            duration: 4000,
            style: toastStyle,
        });
    };

    // 模型面板的列表：拉不到时至少把当前配置的模型列出来，否则面板是空的、
    // 连当前值都看不见；拉到了但当前值不在里面（旧配置选了已下架的模型）也补进去
    const modelOptions = (() => {
        const arr = models ?? [];
        if (arr.length === 0) return active?.model ? [active.model] : [];
        if (active?.model && !arr.includes(active.model)) return [active.model, ...arr];
        return arr;
    })();

    // 添加本地网关：已探测到就直接加，没探测到先探一次。
    // 已有别的服务时不切换生效项，只把新条目加进列表——
    // 擅自改用户正在用的服务会很难排查。
    const addLocalGateway = async () => {
        let gw = localFound;
        if (!gw) {
            setLocalChecking(true);
            // 探测最长 2.5 秒，下拉已经关上了，不给提示就是干等
            const tid = toast.loading(t('config.study.local_probing'), { style: toastStyle });
            try {
                gw = await detectLocalGateway();
            } finally {
                toast.dismiss(tid);
                setLocalChecking(false);
            }
            if (!gw) {
                toast(t('config.study.local_not_found'), { duration: 6000, style: toastStyle });
                return;
            }
            setLocalFound(gw);
        }
        const existing = services.find((s) => s.url === gw.url);
        if (existing) {
            setStudyServiceId(existing.id);
            toast(t('config.study.local_exists', { name: existing.name }), {
                duration: 3000,
                style: toastStyle,
            });
            return;
        }
        const entry = {
            id: newId(),
            name: gw.name,
            url: gw.url,
            apiKey: gw.apiKey,
            model: gw.models[0] ?? '',
        };
        // 用户是在下拉里明确点了「添加本地网关」，加完就切过去用它；
        // 顺带把刚探到的列表缓存起来，切过去时不必再拉一遍
        lastDetectedRef.current = {
            url: gw.url,
            apiKey: gw.apiKey,
            models: gw.models,
            hidden: gw.hidden ?? 0,
            ts: Date.now(),
        };
        setStudyServices([...services, entry]);
        setStudyServiceId(entry.id);
        setModels(gw.models);
        setHiddenModels(gw.hidden ?? 0);
        toast(t('config.study.local_added', { name: gw.name }), {
            duration: 3000,
            style: toastStyle,
        });
    };

    const modalTitle = editingId ? t('config.study.edit_service_title') : t('config.study.add_service_title');

    // 常用预设里可能残留已删服务，渲染前滤掉
    const pinnedList = (pinnedModels ?? []).filter((p) => services.some((s) => s.id === p.sid));

    return (
        <>
            <Card className='mb-[10px]'>
                <CardBody>
                    <div className='mb-3'>
                        <h3 className='my-auto'>{t('config.study.service')}</h3>
                        <p className='text-small text-default-500 mt-1'>{t('config.study.service_hint')}</p>
                    </div>

                    {/* 常用预设：收藏的模型跨服务列在这里，点一下连服务一起切 */}
                    {pinnedList.length > 0 && (
                        <div className='mb-4'>
                            <div className='mb-1 flex h-6 items-center'>
                                <p className='text-tiny text-default-500'>{t('config.study.pinned_title')}</p>
                            </div>
                            <div className='flex flex-wrap gap-1.5'>
                                {pinnedList.map((pin) => {
                                    const isActive = pin.sid === active?.id && pin.model === active?.model;
                                    const svcName = services.find((s) => s.id === pin.sid)?.name ?? '';
                                    return (
                                        <div
                                            key={`${pin.sid}::${pin.model}`}
                                            className={`group flex items-center gap-1 rounded-full border py-2 pl-3 pr-1.5 text-tiny transition-colors ${
                                                isActive
                                                    ? 'border-primary/40 bg-primary/10 text-primary'
                                                    : 'border-default-200 text-default-600 hover:border-default-400'
                                            }`}
                                        >
                                            <button
                                                type='button'
                                                onClick={() => applyPin(pin)}
                                                className='flex min-w-0 items-center gap-1'
                                            >
                                                <span className='max-w-[160px] truncate'>{shortModel(pin.model)}</span>
                                                {!isActive && svcName && (
                                                    <span className='max-w-[90px] truncate text-default-400'>
                                                        {svcName}
                                                    </span>
                                                )}
                                            </button>
                                            <button
                                                type='button'
                                                title={t('config.study.pinned_remove')}
                                                aria-label={t('config.study.pinned_remove')}
                                                onClick={() => togglePin(pin.sid, pin.model)}
                                                className='rounded-full p-1 text-default-300 opacity-0 transition-opacity hover:text-danger group-hover:opacity-100'
                                            >
                                                <LuX className='text-[11px]' />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* 服务选择：加服务、探本地网关都收在下拉里，
                        不再为了加一条服务先开一个管理弹窗 */}
                    <div className='flex items-end gap-2'>
                        <div className='flex-1 min-w-0'>
                            <div className='mb-1 flex h-6 items-center'>
                                <p className='text-tiny text-default-500'>{t('config.study.service_select')}</p>
                            </div>
                            <StudySelect
                                value={active?.id ?? ''}
                                placeholder={t('config.study.no_service')}
                                isDisabled={localChecking}
                                items={[
                                    ...services.map((s, i) => ({
                                        key: s.id,
                                        label: s.name || s.id,
                                        description: s.url,
                                        // 只有一个服务时不显示箭头，免得两个箭头全是灰的像坏了
                                        ...(services.length > 1
                                            ? {
                                                  canMoveUp: i > 0,
                                                  canMoveDown: i < services.length - 1,
                                              }
                                            : {}),
                                    })),
                                    {
                                        key: ADD_SERVICE_KEY,
                                        label: t('config.study.add_service_title'),
                                        icon: <LuPlus className='text-[14px]' />,
                                        dividerBefore: true,
                                    },
                                    {
                                        key: ADD_LOCAL_KEY,
                                        label: localChecking
                                            ? t('config.study.local_probing')
                                            : t('config.study.add_local_item'),
                                        icon: <LuLink className='text-[14px]' />,
                                    },
                                ]}
                                onSelect={(v) => {
                                    if (v === ADD_SERVICE_KEY) {
                                        openAdd();
                                        return;
                                    }
                                    if (v === ADD_LOCAL_KEY) {
                                        addLocalGateway();
                                        return;
                                    }
                                    setStudyServiceId(v);
                                }}
                                onMove={moveService}
                            />
                        </div>
                        {active && (
                            <>
                                <Button
                                    isIconOnly
                                    variant='flat'
                                    aria-label={t('config.study.edit_service_title')}
                                    title={t('config.study.edit_service_title')}
                                    className='shrink-0'
                                    onPress={() => openEdit(active)}
                                >
                                    <LuPencil className='text-[15px]' />
                                </Button>
                                <Button
                                    isIconOnly
                                    variant='flat'
                                    aria-label={t('config.study.delete_service')}
                                    title={
                                        pendingDelete === active.id
                                            ? t('config.study.delete_confirm')
                                            : t('config.study.delete_service')
                                    }
                                    className='shrink-0'
                                    color={pendingDelete === active.id ? 'danger' : 'default'}
                                    onPress={() => removeEntry(active.id)}
                                >
                                    <LuTrash2 className='text-[15px]' />
                                </Button>
                            </>
                        )}
                    </div>

                    <div className='mt-4'>
                        {/* 刷新放标题行，不占输入框宽度：不然模型框比思考强度框窄一截，
                            两个框右边界对不上，看着就不像一组 */}
                        <div className='mb-1 flex h-6 items-center justify-between gap-2'>
                            <p className='text-tiny text-default-500'>{t('config.study.model')}</p>
                            <Button
                                isIconOnly
                                size='sm'
                                variant='light'
                                aria-label={t('config.study.refresh_models')}
                                title={t('config.study.refresh_models')}
                                className='h-6 w-6 min-w-6 text-default-400 data-[hover=true]:text-default-600'
                                onPress={() => active && loadModels(active)}
                                isLoading={modelLoading}
                            >
                                <LuRefreshCw className='text-[13px]' />
                            </Button>
                        </div>
                        <ModelPicker
                            models={modelOptions}
                            value={active?.model ?? ''}
                            starred={(pinnedModels ?? []).filter((p) => p.sid === active?.id).map((p) => p.model)}
                            hiddenCount={hiddenModels}
                            error={modelError}
                            placeholder={
                                modelLoading
                                    ? t('config.study.loading_models')
                                    : modelError
                                      ? t('config.study.model_error')
                                      : t('config.study.pick_model')
                            }
                            onPick={pickModel}
                            onToggleStar={(m) => active && togglePin(active.id, m)}
                            isDisabled={modelOptions.length === 0}
                        />
                    </div>

                    {/* 手填入口：只在模型列表拿不到时出现。列表正常时面板已经能选全部，
                        再放一个同值输入框只会让人问「这是干啥的」。加载中不显示，避免闪烁 */}
                    {models.length === 0 && !modelLoading && (
                        <Input
                            label={t('config.study.model_manual')}
                            className='mt-2'
                            size='sm'
                            value={active?.model ?? ''}
                            onValueChange={(v) => pickModel(v)}
                            placeholder='GLM-5.3-Flash'
                            description={t('config.study.model_manual_hint')}
                        />
                    )}

                    {/* 和模型行同一套骨架：外部小标题 + 灰底输入框，
                        不然两行一个标题在框里一个在框外，看着就不是一组 */}
                    {reasoningAvailable && (
                        <div className='mt-4'>
                            <div className='mb-1 flex h-6 items-center'>
                                <p className='text-tiny text-default-500'>{t('config.study.reasoning')}</p>
                            </div>
                            <StudySelect
                                value={active?.reasoningEffort || 'default'}
                                width='220px'
                                isDisabled={!active}
                                items={[
                                    { key: 'default', label: t('config.study.reasoning_default') },
                                    { key: 'off', label: t('config.study.reasoning_off') },
                                    { key: 'low', label: 'low' },
                                    { key: 'medium', label: 'medium' },
                                    { key: 'high', label: 'high' },
                                    { key: 'max', label: 'max' },
                                ]}
                                onSelect={(v) => pickReasoning(v === 'default' ? '' : v)}
                            />
                            <p className='text-tiny text-default-400 mt-1.5 leading-relaxed'>
                                {t('config.study.reasoning_hint')}
                            </p>
                        </div>
                    )}
                </CardBody>
            </Card>

            {/* 单向导出：把当前模型写成一条翻译服务，不反向回写学习模式 */}
            <Card>
                <CardBody className='py-3'>
                    <div className='flex items-center justify-between gap-3'>
                        <div className='min-w-0'>
                            <p className='text-small'>{t('config.study.export_title')}</p>
                            <p className='text-tiny text-default-400 mt-0.5'>{t('config.study.export_hint')}</p>
                        </div>
                        <Button
                            size='sm'
                            variant='flat'
                            className='shrink-0 rounded-full'
                            isDisabled={!active}
                            onPress={exportToService}
                        >
                            {t('config.study.export_button')}
                        </Button>
                    </div>
                </CardBody>
            </Card>

            <Modal
                isOpen={formOpen}
                onOpenChange={(open) => {
                    if (open) setFormOpen(true);
                    else closeForm();
                }}
                scrollBehavior='inside'
                placement='center'
            >
                <ModalContent className='max-h-[75vh]'>
                    <ModalHeader>{modalTitle}</ModalHeader>
                    <ModalBody className='pb-6'>
                        <div className='flex flex-col gap-3'>
                            <p className='text-tiny text-default-400'>{t('config.study.openai_only')}</p>
                            <Input
                                size='sm'
                                label={t('config.study.service_name')}
                                value={fName}
                                onValueChange={setFName}
                            />
                            <Input
                                size='sm'
                                label={t('config.study.service_url')}
                                value={fUrl}
                                onValueChange={setFUrl}
                            />
                            <Input
                                size='sm'
                                type='password'
                                label={t('config.study.api_key')}
                                value={fKey}
                                onValueChange={setFKey}
                            />
                            <div className='flex flex-wrap items-center gap-2 mt-1'>
                                <Button
                                    size='sm'
                                    color='primary'
                                    isLoading={fChecking}
                                    onPress={checkAndSave}
                                >
                                    {t('config.study.detect')}
                                </Button>
                                <Button
                                    size='sm'
                                    variant='light'
                                    className='text-default-500'
                                    onPress={saveDirectly}
                                >
                                    {t('config.study.save_directly')}
                                </Button>
                            </div>
                            {fStatus && (
                                <p className={`text-tiny ${fStatus.ok ? 'text-success' : 'text-danger'} break-all`}>
                                    {fStatus.text}
                                </p>
                            )}
                        </div>
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    );
}
