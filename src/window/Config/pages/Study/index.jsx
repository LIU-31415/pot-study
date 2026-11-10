import {
    Button,
    Card,
    CardBody,
    Input,
    Modal,
    ModalBody,
    ModalContent,
    ModalHeader,
    Radio,
    RadioGroup,
    Select,
    SelectItem,
} from '@nextui-org/react';
import { Toaster, toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useEffect, useState } from 'react';
import {
    LuChevronLeft,
    LuPencil,
    LuPlus,
    LuRefreshCw,
    LuSettings2,
    LuTrash2,
    LuX,
} from 'react-icons/lu';

import { useConfig, useToastStyle } from '../../../../hooks';
import {
    normalizeInputUrl,
    fetchModelList,
    buildLegacyStudyService,
    resolveActiveStudyService,
    toChatCompletionsUrl,
    detectLocalGateway,
} from '../../../../utils/study_service';

function newId() {
    return `study_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export default function Study() {
    const { t } = useTranslation();
    const toastStyle = useToastStyle();
    const [studyServices, setStudyServices] = useConfig('study_services', []);
    const [studyServiceId, setStudyServiceId] = useConfig('study_service_id', '');

    const [models, setModels] = useState([]);
    const [modelLoading, setModelLoading] = useState(false);
    const [modelError, setModelError] = useState('');

    // 服务管理弹窗：列表视图 / 表单视图
    const [managerOpen, setManagerOpen] = useState(false);
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

    const services = studyServices ?? [];
    const active = resolveActiveStudyService(services, studyServiceId);
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
        setModelLoading(true);
        setModelError('');
        try {
            const { models: arr } = await fetchModelList(entry.url, entry.apiKey);
            setModels(arr);
        } catch (e) {
            setModels([]);
            setModelError(String(e?.message ?? e));
        } finally {
            setModelLoading(false);
        }
    };

    useEffect(() => {
        if (active) {
            loadModels(active);
        } else {
            setModels([]);
            setModelError('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active?.id, active?.url, active?.apiKey]);

    // 模型选择写回当前服务条目
    const pickModel = (model) => {
        if (!active) return;
        setStudyServices(
            services.map((s) => (s.id === active.id ? { ...s, model } : s))
        );
    };

    const resetForm = () => {
        setEditingId('');
        setFName('');
        setFUrl('');
        setFKey('');
        setFStatus(null);
        setFormOpen(false);
    };

    const openAdd = () => {
        resetForm();
        setFormOpen(true);
        setManagerOpen(true);
    };

    const openEdit = (entry) => {
        setEditingId(entry.id);
        setFName(entry.name ?? '');
        setFUrl(entry.url ?? '');
        setFKey(entry.apiKey ?? '');
        setFStatus(null);
        setFormOpen(true);
        setManagerOpen(true);
    };

    const openManager = () => {
        resetForm();
        setManagerOpen(true);
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
        const next = old
            ? services.map((s) => (s.id === editingId ? entry : s))
            : [...services, entry];
        setStudyServices(next);
        setStudyServiceId(entry.id);
        if (detectedModels) setModels(detectedModels);
        resetForm();
        setManagerOpen(false);
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
            const { models: arr, url: usedUrl } = await fetchModelList(url, fKey);
            if (arr.length === 0) throw new Error('empty model list');
            saveEntry(toChatCompletionsUrl(usedUrl), fKey, arr);
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
        saveEntry(url, fKey, undefined);
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

    const modelOptions =
        models.length > 0 ? models : active?.model ? [active.model] : [];

    // 手动重探：页面打开后才启动网关的情况
    const checkLocalGateway = async () => {
        setLocalChecking(true);
        try {
            const gw = await detectLocalGateway();
            if (gw) {
                setLocalFound(gw);
            } else {
                toast(t('config.study.local_not_found'), { duration: 6000, style: toastStyle });
            }
        } finally {
            setLocalChecking(false);
        }
    };

    // 添加探到的本地网关。已有别的服务时不切换生效项，
    // 只把新条目加进列表——擅自改用户正在用的服务会很难排查。
    const addLocalGateway = (gw) => {
        const existing = services.find((s) => s.url === gw.url);
        if (existing) {
            setStudyServiceId(existing.id);
            setLocalFound(null);
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
        setStudyServices([...services, entry]);
        if (services.length === 0) {
            setStudyServiceId(entry.id);
        }
        setModels(gw.models);
        setLocalFound(null);
        toast(t('config.study.local_added', { name: gw.name }), {
            duration: 3000,
            style: toastStyle,
        });
    };

    const modalTitle = formOpen
        ? editingId
            ? t('config.study.edit_service_title')
            : t('config.study.add_service_title')
        : t('config.study.manager_title');

    return (
        <>
            <Toaster />
            <Card className='mb-[10px]'>
                <CardBody>
                    <div className='mb-3'>
                        <h3 className='my-auto'>{t('config.study.service')}</h3>
                        <p className='text-small text-default-500 mt-1'>
                            {t('config.study.service_hint')}
                        </p>
                    </div>

                    {/* 本地网关：探到了给一条可添加的提示，探不到给个手动检测入口 */}
                    {localFound ? (
                        <div className='mb-3 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2.5 flex items-center justify-between gap-2'>
                            <div className='min-w-0'>
                                <p className='text-small font-medium truncate'>
                                    {t('config.study.local_found', { name: localFound.name })}
                                </p>
                                <p className='text-tiny text-default-400 truncate'>
                                    {localFound.base} ·{' '}
                                    {t('config.study.local_models', {
                                        n: localFound.models.length,
                                    })}
                                </p>
                            </div>
                            <div className='flex items-center gap-1 shrink-0'>
                                <Button
                                    size='sm'
                                    color='primary'
                                    variant='flat'
                                    className='rounded-full'
                                    onPress={() => addLocalGateway(localFound)}
                                >
                                    {t('config.study.local_add')}
                                </Button>
                                <Button
                                    size='sm'
                                    isIconOnly
                                    variant='light'
                                    className='rounded-full text-default-400'
                                    onPress={() => setLocalFound(null)}
                                >
                                    <LuX className='text-[14px]' />
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <div className='mb-3 flex items-center gap-2 flex-wrap'>
                            <Button
                                size='sm'
                                variant='bordered'
                                className='rounded-full'
                                isLoading={localChecking}
                                onPress={checkLocalGateway}
                            >
                                {t('config.study.detect_local')}
                            </Button>
                            <span className='text-tiny text-default-400'>
                                {t('config.study.local_hint')}
                            </span>
                        </div>
                    )}

                    {services.length === 0 ? (
                        <div className='py-6 flex flex-col items-center gap-3'>
                            <p className='text-center text-default-500 text-small'>
                                {t('config.study.no_service')}
                            </p>
                            <Button
                                color='primary'
                                size='sm'
                                startContent={<LuPlus className='text-[15px]' />}
                                onPress={openAdd}
                            >
                                {t('config.study.add_service_title')}
                            </Button>
                        </div>
                    ) : (
                        <>
                            <div className='flex items-center gap-2 rounded-xl border border-default-200 px-3 py-2.5'>
                                <div className='min-w-0 flex-1'>
                                    <p className='text-small font-medium truncate'>
                                        {active?.name || '-'}
                                    </p>
                                    <p className='text-tiny text-default-400 truncate'>
                                        {active?.url || ''}
                                    </p>
                                </div>
                                <Button
                                    size='sm'
                                    variant='flat'
                                    className='shrink-0'
                                    startContent={<LuSettings2 className='text-[14px]' />}
                                    onPress={openManager}
                                >
                                    {t('config.study.manage')}
                                </Button>
                            </div>

                            <div className='mt-4 flex items-end gap-2'>
                                <Select
                                    label={t('config.study.model')}
                                    className='flex-1'
                                    selectedKeys={active?.model ? [active.model] : []}
                                    onSelectionChange={(keys) => {
                                        const v = Array.from(keys)[0];
                                        if (v) pickModel(String(v));
                                    }}
                                    isDisabled={modelOptions.length === 0}
                                    placeholder={
                                        modelLoading
                                            ? t('config.study.loading_models')
                                            : modelError
                                            ? t('config.study.model_error')
                                            : t('config.study.pick_model')
                                    }
                                >
                                    {modelOptions.map((m) => (
                                        <SelectItem key={String(m)}>{String(m)}</SelectItem>
                                    ))}
                                </Select>
                                <Button
                                    isIconOnly
                                    variant='flat'
                                    className='mb-0.5'
                                    onPress={() => active && loadModels(active)}
                                    isLoading={modelLoading}
                                >
                                    <LuRefreshCw className='text-[16px]' />
                                </Button>
                            </div>

                            {modelError && (
                                <p className='text-tiny text-danger mt-2 break-all'>
                                    {t('config.study.model_error_hint')} {modelError}
                                </p>
                            )}
                        </>
                    )}
                </CardBody>
            </Card>

            <Modal
                isOpen={managerOpen}
                onOpenChange={(open) => {
                    if (!open) resetForm();
                    setManagerOpen(open);
                }}
                scrollBehavior='inside'
                placement='center'
            >
                <ModalContent className='max-h-[75vh]'>
                    <ModalHeader className='flex items-center gap-1'>
                        {formOpen && (
                            <Button
                                isIconOnly
                                size='sm'
                                variant='light'
                                className='-ml-1 h-7 w-7 min-w-7'
                                onPress={resetForm}
                            >
                                <LuChevronLeft className='text-[16px]' />
                            </Button>
                        )}
                        {modalTitle}
                    </ModalHeader>
                    <ModalBody className='pb-6'>
                        {formOpen ? (
                            <div className='flex flex-col gap-3'>
                                <p className='text-tiny text-default-400'>
                                    {t('config.study.openai_only')}
                                </p>
                                <Input
                                    size='sm'
                                    label={t('config.study.service_name')}
                                    placeholder={t('config.study.service_name_placeholder')}
                                    value={fName}
                                    onValueChange={setFName}
                                />
                                <Input
                                    size='sm'
                                    label={t('config.study.service_url')}
                                    placeholder={t('config.study.service_url_placeholder')}
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
                                    <p
                                        className={`text-tiny ${
                                            fStatus.ok ? 'text-success' : 'text-danger'
                                        } break-all`}
                                    >
                                        {fStatus.text}
                                    </p>
                                )}
                            </div>
                        ) : (
                            <>
                                <RadioGroup
                                    value={active?.id ?? ''}
                                    onValueChange={(v) => {
                                        setStudyServiceId(String(v));
                                    }}
                                    classNames={{ wrapper: 'gap-2' }}
                                >
                                    {services.map((s) => (
                                        <div key={s.id} className='flex items-center gap-0.5'>
                                            <Radio
                                                value={s.id}
                                                description={s.url}
                                                classNames={{ base: 'flex-1' }}
                                            >
                                                {s.name || s.id}
                                            </Radio>
                                            <Button
                                                isIconOnly
                                                size='sm'
                                                variant='light'
                                                className='h-7 w-7 min-w-7'
                                                onPress={() => openEdit(s)}
                                            >
                                                <LuPencil className='text-[13px]' />
                                            </Button>
                                            <Button
                                                isIconOnly
                                                size='sm'
                                                variant='light'
                                                className='h-7 w-7 min-w-7'
                                                color={
                                                    pendingDelete === s.id ? 'danger' : 'default'
                                                }
                                                title={
                                                    pendingDelete === s.id
                                                        ? t('config.study.delete_confirm')
                                                        : ''
                                                }
                                                onPress={() => removeEntry(s.id)}
                                            >
                                                <LuTrash2 className='text-[13px]' />
                                            </Button>
                                        </div>
                                    ))}
                                </RadioGroup>
                                <Button
                                    size='sm'
                                    variant='flat'
                                    className='mt-2 self-start'
                                    startContent={<LuPlus className='text-[14px]' />}
                                    onPress={openAdd}
                                >
                                    {t('config.study.add_service_title')}
                                </Button>
                            </>
                        )}
                    </ModalBody>
                </ModalContent>
            </Modal>
        </>
    );
}
