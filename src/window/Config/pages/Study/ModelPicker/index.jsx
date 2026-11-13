import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import React, { useMemo, useState } from 'react';
import { LuCheck, LuChevronDown, LuSearch, LuStar } from 'react-icons/lu';

import { PANEL_MAX_HEIGHT, TRIGGER_CLASS } from '../dropdown';

// 模型多到一定程度才值得给搜索框，少的时候多一个输入框只是噪音
const SEARCH_THRESHOLD = 12;

function ModelRow({ name, selected, starred, onPick, onToggleStar }) {
    const { t } = useTranslation();
    return (
        <div
            className={`flex items-center gap-1 rounded-small pr-1 ${
                selected ? 'bg-primary/10' : 'hover:bg-default-100'
            }`}
        >
            <button
                type='button'
                onClick={() => onPick(name)}
                className='flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1.5 text-left text-small'
            >
                <span className='min-w-0 flex-1 truncate'>{name}</span>
                {selected && <LuCheck className='shrink-0 text-[13px] text-primary' />}
            </button>
            <button
                type='button'
                title={t('config.study.star_toggle')}
                onClick={() => onToggleStar(name)}
                className={`shrink-0 rounded-small p-1 text-[14px] transition-colors ${
                    starred ? 'text-warning' : 'text-default-300 hover:text-default-500'
                }`}
            >
                <LuStar fill={starred ? 'currentColor' : 'none'} />
            </button>
        </div>
    );
}

// 模型选择面板：星标模型置顶，其余按字母序，可搜索。
// 用 Popover 自己画列表而不是 NextUI Select：Select 的选项里嵌按钮会抢走
// 选中行为，星标就点不动了。
export default function ModelPicker({
    models,
    value,
    starred,
    hiddenCount,
    error,
    placeholder,
    onPick,
    onToggleStar,
    isDisabled,
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');

    const list = Array.isArray(models) ? models : [];
    const starList = Array.isArray(starred) ? starred : [];

    const { pinned, rest, pinnedSet } = useMemo(() => {
        const inList = new Set(list);
        // 星标里可能有别的服务的模型名，只显示当前列表里存在的
        const pin = starList.filter((m) => inList.has(m));
        const set = new Set(pin);
        return { pinned: pin, rest: list.filter((m) => !set.has(m)), pinnedSet: set };
    }, [list, starList]);

    const q = query.trim().toLowerCase();
    const match = (m) => !q || m.toLowerCase().includes(q);
    const shownPinned = pinned.filter(match);
    const shownRest = rest.filter(match);
    const nothing = shownPinned.length === 0 && shownRest.length === 0;

    const close = () => {
        setOpen(false);
        setQuery('');
    };

    const pick = (m) => {
        onPick(m);
        close();
    };

    return (
        <div className='w-full min-w-0'>
            <Popover
                isOpen={open}
                onOpenChange={(v) => (v ? setOpen(true) : close())}
                placement='bottom-start'
                offset={6}
            >
                <PopoverTrigger>
                    <Button
                        variant='flat'
                        disableRipple
                        isDisabled={isDisabled}
                        className={TRIGGER_CLASS}
                    >
                        <span className='flex w-full min-w-0 items-center justify-between gap-2'>
                            <span className='flex min-w-0 items-center gap-1.5'>
                                {value && pinnedSet.has(value) && (
                                    <LuStar
                                        className='shrink-0 text-[12px] text-warning'
                                        fill='currentColor'
                                    />
                                )}
                                <span className={`truncate ${value ? '' : 'text-default-500'}`}>
                                    {value || placeholder}
                                </span>
                            </span>
                            <LuChevronDown className='shrink-0 text-[15px] text-default-400' />
                        </span>
                    </Button>
                </PopoverTrigger>
                {/* style 必须落在 PopoverContent 里面这层：
                    PopoverContent 把 className 给内层、style 给外层定位壳，
                    写外层上 maxHeight 约束不到内容 */}
                <PopoverContent className='p-0'>
                    <div
                        className='flex w-[320px] flex-col overflow-hidden rounded-large'
                        style={{ maxHeight: PANEL_MAX_HEIGHT }}
                    >
                        <div className='flex min-h-0 w-full flex-col'>
                            {list.length >= SEARCH_THRESHOLD && (
                                <div className='shrink-0 p-2 pb-1'>
                                    <Input
                                        size='sm'
                                        variant='flat'
                                        autoFocus
                                        value={query}
                                        onValueChange={setQuery}
                                        placeholder={t('config.study.model_search')}
                                        startContent={<LuSearch className='text-[14px] text-default-400' />}
                                        classNames={{ inputWrapper: 'h-8 min-h-8' }}
                                    />
                                </div>
                            )}

                            <div
                                className='min-h-0 flex-1 overflow-y-auto px-1 py-1'
                                style={{ maxHeight: 'min(230px, 45vh)' }}
                            >
                                {nothing && (
                                    <p className='px-2 py-3 text-center text-tiny text-default-400'>
                                        {t('config.study.model_no_match')}
                                    </p>
                                )}
                                {shownPinned.length > 0 && (
                                    <p className='px-2 pt-1 pb-1 text-tiny text-default-400'>
                                        {t('config.study.model_pinned')}
                                    </p>
                                )}
                                {shownPinned.map((m) => (
                                    <ModelRow
                                        key={`pin-${m}`}
                                        name={m}
                                        selected={m === value}
                                        starred
                                        onPick={pick}
                                        onToggleStar={onToggleStar}
                                    />
                                ))}
                                {shownPinned.length > 0 && shownRest.length > 0 && (
                                    <div className='my-1 h-px bg-default-100' />
                                )}
                                {shownPinned.length > 0 && shownRest.length > 0 && (
                                    <p className='px-2 pt-1 pb-1 text-tiny text-default-400'>
                                        {t('config.study.model_all')}
                                    </p>
                                )}
                                {shownRest.map((m) => (
                                    <ModelRow
                                        key={`rest-${m}`}
                                        name={m}
                                        selected={m === value}
                                        starred={false}
                                        onPick={pick}
                                        onToggleStar={onToggleStar}
                                    />
                                ))}
                            </div>

                            {hiddenCount > 0 && (
                                <div className='shrink-0 border-t border-default-100 px-3 py-2'>
                                    <p className='text-tiny leading-relaxed text-default-400'>
                                        {t('config.study.model_hidden', { n: hiddenCount })}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </PopoverContent>
            </Popover>

            {/* 拉不到列表时下拉是禁用的，错误只能放外面，否则用户看不到原因 */}
            {error && (
                <p className='mt-1.5 text-tiny leading-relaxed text-danger break-all'>
                    {t('config.study.model_error_hint')} {error}
                </p>
            )}
        </div>
    );
}
