import {
    Card,
    CardBody,
    CardHeader,
    Button,
    Tooltip,
    Spinner,
    Dropdown,
    DropdownTrigger,
    DropdownMenu,
    DropdownItem,
} from '@nextui-org/react';
import { useAtomValue } from 'jotai';
import React, { useEffect, useState, useRef } from 'react';
import { LuRefreshCw, LuChevronDown, LuCopy, LuDownload, LuCheck } from 'react-icons/lu';
import { invoke } from '@tauri-apps/api/tauri';
import { save } from '@tauri-apps/api/dialog';
import { writeText } from '@tauri-apps/api/clipboard';
import { useTranslation } from 'react-i18next';

import * as builtinServices from '../../../../services/translate';
import { useConfig } from '../../../../hooks';
import { sourceTextAtom, detectLanguageAtom } from '../SourceArea';
import { sourceLanguageAtom, targetLanguageAtom } from '../LanguageArea';
import { resolveActiveStudyService } from '../../../../utils/study_service';

// 常见缩写：句号后不当作句子边界
const ABBREVIATIONS = new Set([
    'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'vs', 'etc', 'fig', 'figs',
    'eq', 'eqs', 'ref', 'refs', 'al', 'no', 'nos', 'vol', 'pp', 'cf', 'approx',
    'dept', 'univ', 'inc', 'ltd', 'co', 'corp', 'min', 'max', 'ca', 'resp',
    'eg', 'ie', 'viz', 'ed', 'eds', 'ch', 'sec', 'tab', 'supp', 'wt',
]);

export function splitSentences(text) {
    const out = [];
    if (!text) return out;
    const paragraphs = text.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);

    for (const para of paragraphs) {
        // 中文：按全角句末标点切
        if (/[\u4e00-\u9fa5]/.test(para)) {
            const parts = para
                .split(/(?<=[。！？；!?;])/)
                .map((s) => s.trim())
                .filter(Boolean);
            out.push(...parts);
            continue;
        }
        // 英文：按 . ! ? 后跟空白切，排除缩写
        const chunks = para.split(/(?<=[.!?])\s+/);
        let buf = '';
        for (const chunk of chunks) {
            buf = buf ? buf + ' ' + chunk : chunk;
            const m = buf.match(/([A-Za-z][A-Za-z.]*)\.$/);
            if (m) {
                const w = m[1].toLowerCase().replace(/\./g, '');
                if (ABBREVIATIONS.has(w)) continue;
                if (w.length === 1 && /^[A-Z]$/.test(m[1])) {
                    // 数字后的单字母大写多半是单位（0.4 T.），应切开；否则当人名首字母（John A.）合并
                    if (!/\d\s+[A-Z]\.$/.test(buf)) continue;
                }
            }
            if (buf.trim()) out.push(buf.trim());
            buf = '';
        }
        if (buf.trim()) out.push(buf.trim());
    }
    return out;
}

function parseNumbered(raw) {
    const map = new Map();
    if (!raw) return map;
    const text = raw.replace(/_+$/, '');
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*(\d+)\s*[.、)]\s*(.+)$/);
        if (m) {
            const idx = parseInt(m[1], 10);
            const val = m[2].trim();
            if (val) map.set(idx, val);
        }
    }
    return map;
}

const STUDY_SYSTEM =
    'You are a professional translation engine. Translate each numbered sentence. ' +
    'Keep the numbering exactly as given. Output one translation per line, in the same order. ' +
    'Never merge or split sentences. Do not add explanations, notes, or extra text.';

const STUDY_USER =
    'Translate the following numbered sentences into $to.\n' +
    'Keep the numbering. One line per sentence.\n\n$text';

const BATCH_SIZE = 20;
const MAX_SINGLE = 30;
const MAX_PARALLEL = 3;

export default function StudyArea() {
    const sourceText = useAtomValue(sourceTextAtom);
    const sourceLanguage = useAtomValue(sourceLanguageAtom);
    const targetLanguage = useAtomValue(targetLanguageAtom);
    const detectLanguage = useAtomValue(detectLanguageAtom);
    const [appFontSize] = useConfig('app_font_size', 16);
    const [secondLanguage] = useConfig('translate_second_language', 'en');
    const [studyServices] = useConfig('study_services', []);
    const [studyServiceId, setStudyServiceId] = useConfig('study_service_id', '');
    // 复制/导出的内容形态：both = 原文+译文，target = 仅译文
    const [copyMode, setCopyMode] = useConfig('study_copy_mode', 'both');
    // 同 selected/pairs：onPress 可能拿到旧闭包，导出前从 ref 读当前值
    const copyModeRef = useRef('both');
    useEffect(() => {
        copyModeRef.current = copyMode === 'target' ? 'target' : 'both';
    }, [copyMode]);
    const { t } = useTranslation();

    // 学习模式的服务独立配置（OpenAI 兼容格式），不再复用翻译服务列表
    const studyList = studyServices ?? [];
    const active = resolveActiveStudyService(studyList, studyServiceId);
    const name = active?.id ?? '';

    const [pairs, setPairs] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [batchInfo, setBatchInfo] = useState('');
    const [selected, setSelected] = useState(() => new Set());
    const [copied, setCopied] = useState(false);
    // 导出时读 ref，避开按钮 onPress 可能缓存旧闭包的问题
    const selectedRef = useRef(selected);
    const pairsRef = useRef([]);
    useEffect(() => {
        selectedRef.current = selected;
    }, [selected]);
    useEffect(() => {
        pairsRef.current = pairs;
    }, [pairs]);
    const runId = useRef(0);
    const lastRenderRef = useRef(0);

    const runTranslate = async (sentences) => {
        const id = ++runId.current;
        setError('');
        setIsLoading(true);

        const total = sentences.length;
        const batches = [];
        if (total <= MAX_SINGLE) {
            batches.push({ start: 0, count: total });
        } else {
            for (let i = 0; i < total; i += BATCH_SIZE) {
                batches.push({ start: i, count: Math.min(BATCH_SIZE, total - i) });
            }
        }
        setBatchInfo(
            batches.length > 1 ? t('translate.study_batches', { n: batches.length }) : ''
        );

        const acc = sentences.map((s) => ({ src: s, dst: '', error: '' }));
        setPairs(acc.map((p) => ({ ...p })));

        const translateBatch = async (batch) => {
            const items = sentences.slice(batch.start, batch.start + batch.count);
            try {
                const LanguageEnum = builtinServices['openai'].Language;

                let to = targetLanguage;
                // 检测结果与目标语言相同、检测失败、或还没检测出来，都改用第二语言：
                // 否则中文输入会“翻译”成中文，看上去像没翻译
                if (
                    sourceLanguage === 'auto' &&
                    (!detectLanguage ||
                        detectLanguage === 'failed' ||
                        targetLanguage === detectLanguage)
                ) {
                    to = secondLanguage;
                }
                if (!(sourceLanguage in LanguageEnum) || !(to in LanguageEnum)) {
                    throw new Error('Language not supported');
                }

                const numbered = items.map((s, i) => `${i + 1}. ${s}`).join('\n');
                const cfg = {
                    service: 'openai',
                    requestPath: active?.url ?? '',
                    apiKey: active?.apiKey ?? '',
                    model: active?.model ?? '',
                    stream: true,
                    promptList: [
                        { role: 'system', content: STUDY_SYSTEM },
                        { role: 'user', content: STUDY_USER },
                    ],
                };

                await builtinServices['openai'].translate(
                    numbered,
                    LanguageEnum[sourceLanguage],
                    LanguageEnum[to],
                    {
                        config: cfg,
                        detect: detectLanguage,
                        setResult: (v) => {
                            if (runId.current !== id) return;
                            const map = parseNumbered(v);
                            items.forEach((s, i) => {
                                const gi = batch.start + i;
                                acc[gi].dst = map.get(i + 1) || '';
                                acc[gi].error = '';
                            });
                            // 节流：流式碎片来得很快，每 120ms 最多重渲一次
                            const now = Date.now();
                            if (now - lastRenderRef.current < 120) return;
                            lastRenderRef.current = now;
                            setPairs(acc.map((p) => ({ ...p })));
                        },
                    }
                );
                // 本批结束，强制渲染一次，避免节流漏掉最后一段
                if (runId.current === id) {
                    lastRenderRef.current = 0;
                    setPairs(acc.map((p) => ({ ...p })));
                }
            } catch (e) {
                if (runId.current !== id) return;
                for (let i = 0; i < batch.count; i++) {
                    acc[batch.start + i].error = t('translate.study_failed');
                }
                setPairs(acc.map((p) => ({ ...p })));
                throw e;
            }
        };

        try {
            let cursor = 0;
            const workers = Array(Math.min(MAX_PARALLEL, batches.length))
                .fill(0)
                .map(async () => {
                    while (cursor < batches.length) {
                        // 任务已过期（换文/重译）就别再取新批，省 token
                        if (runId.current !== id) return;
                        const b = batches[cursor++];
                        try {
                            await translateBatch(b);
                        } catch (e) {
                            // 单批失败不影响其他批
                        }
                    }
                });
            await Promise.all(workers);
        } finally {
            if (runId.current === id) setIsLoading(false);
        }
    };

    useEffect(() => {
        if (!sourceText || !sourceText.trim()) {
            // 让在途请求失效，避免旧译文被写回
            runId.current++;
            setPairs([]);
            setSelected(new Set());
            setIsLoading(false);
            setBatchInfo('');
            return undefined;
        }
        if (!sourceLanguage || !targetLanguage || !name) return undefined;
        // 源语言是 auto 时必须等检测结果：没检测出来就往下走，
        // to 会算成当前目标语言（中文），结果变成「中文改写中文」
        if (sourceLanguage === 'auto' && !detectLanguage) return undefined;
        const sentences = splitSentences(sourceText);
        if (sentences.length === 0) {
            runId.current++;
            setPairs([]);
            setSelected(new Set());
            setIsLoading(false);
            setBatchInfo('');
            return undefined;
        }
        setPairs(sentences.map((s) => ({ src: s, dst: '' })));
        setSelected(new Set());
        runTranslate(sentences);
        // 组件卸载（切回快捷模式）或在依赖变化时让在途批次失效，
        // 否则剩下的批次还会继续发请求，白烧 token
        return () => {
            runId.current++;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sourceText, sourceLanguage, targetLanguage, name, active?.model, detectLanguage]);

    const serviceLabel = active?.name || '-';
    const modelLabel = active?.model || '';

    // 导出：选中了就只导选中的，没选就导全部
    const buildMarkdown = (items) => {
        if (copyModeRef.current === 'target') {
            return items
                .map((p) => p.dst || '')
                .filter(Boolean)
                .join('\n\n');
        }
        return items.map((p, i) => `**${i + 1}.** ${p.src}\n\n${p.dst || ''}`).join('\n\n---\n\n');
    };

    const exportItems = () => {
        const sel = selectedRef.current;
        const all = pairsRef.current;
        return sel.size > 0 ? all.filter((_, i) => sel.has(i)) : all;
    };

    const toggleSelect = (i) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(i)) next.delete(i);
            else next.add(i);
            return next;
        });
    };

    const handleCopy = async () => {
        const items = exportItems();
        if (!items.length) return;
        try {
            // 用 Tauri 的剪贴板，避开 WebView2 的权限请求弹框
            await writeText(buildMarkdown(items));
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {}
    };

    const handleSave = async () => {
        const items = exportItems();
        if (!items.length) return;
        const d = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const name = `${t(
            copyModeRef.current === 'target'
                ? 'translate.study_export_prefix'
                : 'translate.study_export_prefix_both'
        )}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`;
        try {
            const path = await save({
                defaultPath: name,
                filters: [{ name: 'Markdown', extensions: ['md'] }],
            });
            if (!path) return;
            await invoke('save_text_file', { path, content: buildMarkdown(items) });
        } catch {}
    };

    return (
        <>
        <Card shadow='none' className='bg-content1 rounded-[14px]'>
            <CardHeader className='flex justify-between pl-0 pr-2 pt-2.5 pb-1 bg-content1 rounded-t-[14px]'>
                <div className='flex items-center gap-2 pl-2 text-[13px] text-default-500 min-w-0'>
                    {studyList.length > 1 ? (
                        <Dropdown>
                            <DropdownTrigger>
                                <Button
                                    size='sm'
                                    variant='light'
                                    className='h-[24px] min-w-0 px-1 text-[13px] text-default-500 rounded-full'
                                    endContent={<LuChevronDown className='text-[13px]' />}
                                >
                                    {modelLabel || serviceLabel}
                                </Button>
                            </DropdownTrigger>
                            <DropdownMenu
                                aria-label='study service'
                                selectionMode='single'
                                selectedKeys={[name]}
                                onAction={(k) => {
                                    setStudyServiceId(String(k));
                                }}
                            >
                                {studyList.map((s) => (
                                    <DropdownItem key={s.id}>{s.name || s.id}</DropdownItem>
                                ))}
                            </DropdownMenu>
                        </Dropdown>
                    ) : (
                        <span className='truncate'>{modelLabel || serviceLabel}</span>
                    )}
                    <span className='text-default-300'>·</span>
                    <span>{t('translate.study_sentences', { n: pairs.length })}</span>
                    {batchInfo && (
                        <>
                            <span className='text-default-300'>·</span>
                            <span>{batchInfo}</span>
                        </>
                    )}
                    {isLoading && <Spinner size='sm' color='default' />}
                </div>
                <div className='flex items-center gap-1 shrink-0'>
                    {/* 复制/导出的内容形态：切换后立即影响下一次复制与保存 */}
                    <div className='flex items-center rounded-full bg-default-100 p-[2px] text-[11px] shrink-0 mr-0.5'>
                        <button
                            type='button'
                            className={`px-[7px] py-[1px] rounded-full transition-colors ${
                                copyMode === 'target'
                                    ? 'text-default-500'
                                    : 'bg-content1 text-foreground shadow-sm'
                            }`}
                            onClick={() => setCopyMode('both')}
                        >
                            {t('translate.study_copy_both')}
                        </button>
                        <button
                            type='button'
                            className={`px-[7px] py-[1px] rounded-full transition-colors ${
                                copyMode === 'target'
                                    ? 'bg-content1 text-foreground shadow-sm'
                                    : 'text-default-500'
                            }`}
                            onClick={() => setCopyMode('target')}
                        >
                            {t('translate.study_copy_target')}
                        </button>
                    </div>
                    <Tooltip
                        content={
                            selected.size > 0
                                ? t('translate.study_copy_selected', { n: selected.size })
                                : t('translate.study_copy_all')
                        }
                    >
                        <Button
                            isIconOnly
                            variant='light'
                            size='sm'
                            className='rounded-full'
                            onPress={handleCopy}
                        >
                            {copied ? (
                                <LuCheck className='text-[15px] text-success' />
                            ) : (
                                <LuCopy className='text-[15px]' />
                            )}
                        </Button>
                    </Tooltip>
                    <Tooltip
                        content={
                            selected.size > 0
                                ? t('translate.study_save_selected', { n: selected.size })
                                : t('translate.study_save_all')
                        }
                    >
                        <Button
                            isIconOnly
                            variant='light'
                            size='sm'
                            className='rounded-full'
                            onPress={handleSave}
                        >
                            <LuDownload className='text-[15px]' />
                        </Button>
                    </Tooltip>
                    <Tooltip content={t('translate.translate')}>
                        <Button
                            isIconOnly
                            variant='light'
                            size='sm'
                            className='rounded-full'
                            onPress={() => {
                                const sentences = pairs.map((p) => p.src);
                                if (sentences.length) runTranslate(sentences);
                            }}
                        >
                            <LuRefreshCw className='text-[15px]' />
                        </Button>
                    </Tooltip>
                </div>
            </CardHeader>
            <CardBody className='bg-content1 px-3 pt-2 pb-0.5'>
                {error ? (
                    <div className='text-[13px] text-danger py-2 break-all'>{error}</div>
                ) : studyList.length === 0 ? (
                    <div className='flex items-center justify-between gap-2 py-2'>
                        <span className='text-[13px] text-default-400'>
                            {t('translate.study_no_service')}
                        </span>
                        <Button
                            size='sm'
                            variant='flat'
                            color='primary'
                            className='shrink-0 rounded-full'
                            onPress={() => {
                                invoke('open_config_window').catch(() => {});
                            }}
                        >
                            {t('config.study.label')}
                        </Button>
                    </div>
                ) : (
                    <div className='flex flex-col'>
                        {pairs.map((p, i) => (
                            <div
                                key={i}
                                onClick={() => toggleSelect(i)}
                                className={`my-0.5 py-2 px-2 -mx-2 rounded-lg border-b last:border-0 cursor-pointer transition-colors ${
                                    selected.has(i)
                                        ? 'bg-primary/10 border-transparent'
                                        : 'border-default-100 hover:bg-default-100/60'
                                }`}
                            >
                                <div
                                    className='text-default-700 leading-[1.65]'
                                    style={{ fontSize: `${appFontSize}px` }}
                                >
                                    {p.src}
                                </div>
                                <div
                                    className={`leading-[1.65] mt-1 ${
                                        p.error ? 'text-danger' : 'text-default-500'
                                    }`}
                                    style={{ fontSize: `${appFontSize}px` }}
                                >
                                    {p.error || p.dst || (isLoading ? '…' : '')}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardBody>
        </Card>
        <div className='h-[10px] shrink-0' />
        </>
    );
}
