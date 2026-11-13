import { Button, Popover, PopoverContent, PopoverTrigger } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';
import { LuCheck, LuChevronDown, LuChevronUp } from 'react-icons/lu';

import { PANEL_MAX_HEIGHT, TRIGGER_CLASS } from '../dropdown';

// 学习模式里的通用下拉：和模型面板同一套触发样式与展开动效，
// 只是没有搜索和星标。用它替代 NextUI 的 Select，
// 三个下拉才不会一个像输入框、一个像表单字段。
//
// items: [{ key, label, description?, icon?, dividerBefore?, canMoveUp?, canMoveDown? }]
// 传了 canMoveUp / canMoveDown 的项会带一对上下箭头，用 onMove(key, ±1) 调整顺序。
export default function StudySelect({
    value,
    items,
    onSelect,
    onMove,
    placeholder,
    isDisabled,
    width = 'var(--trigger-width)',
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const list = Array.isArray(items) ? items : [];
    const current = list.find((i) => i.key === value);

    return (
        <Popover
            isOpen={open}
            onOpenChange={setOpen}
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
                        <span className={`truncate ${current ? '' : 'text-default-500'}`}>
                            {current?.label || placeholder}
                        </span>
                        <LuChevronDown className='shrink-0 text-[15px] text-default-400' />
                    </span>
                </Button>
            </PopoverTrigger>
            {/* style 必须落在 PopoverContent 里面的这层：
                PopoverContent 把 className 给内层、把 style 给外层定位壳，
                写在外层上 maxHeight 约束不到内容 */}
            <PopoverContent className='p-0'>
                <div
                    className='flex flex-col overflow-hidden rounded-large'
                    style={{
                        // var(--trigger-width) 由 React Aria 写在浮层上；万一没写到，
                        // minWidth 保证面板不会塌成一条线
                        width,
                        minWidth: 200,
                        maxWidth: 'calc(100vw - 32px)',
                        maxHeight: PANEL_MAX_HEIGHT,
                    }}
                >
                    <div className='min-h-0 flex-1 overflow-y-auto px-1 py-1'>
                        {list.map((item) => (
                            <div key={item.key}>
                                {item.dividerBefore && <div className='my-1 h-px bg-default-100' />}
                                <div
                                    className={`group flex items-center gap-1 rounded-small pr-1.5 ${
                                        item.key === value ? 'bg-primary/10' : 'hover:bg-default-100'
                                    }`}
                                >
                                    <button
                                        type='button'
                                        onClick={() => {
                                            setOpen(false);
                                            onSelect(item.key);
                                        }}
                                        className='flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-small'
                                    >
                                        {/* 左侧固定宽度的槽：勾和图标共用它。
                                        右侧才能只留给箭头，不然三样东西挤在一头 */}
                                        <span className='flex w-4 shrink-0 items-center justify-center text-default-400'>
                                            {item.key === value ? (
                                                <LuCheck className='text-[13px] text-primary' />
                                            ) : (
                                                item.icon
                                            )}
                                        </span>
                                        <span className='min-w-0 flex-1'>
                                            <span className='block truncate'>{item.label}</span>
                                            {item.description && (
                                                <span className='block truncate text-tiny text-default-400'>
                                                    {item.description}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                    {/* 竖排一对箭头：比横排省宽度，也不跟勾抢位置。
                                    默认半透明，鼠标移上去才亮 */}
                                    {onMove && item.canMoveUp !== undefined && (
                                        <span className='flex w-5 shrink-0 flex-col items-center justify-center opacity-50 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'>
                                            <button
                                                type='button'
                                                title={t('config.study.move_up')}
                                                aria-label={t('config.study.move_up')}
                                                disabled={!item.canMoveUp}
                                                onClick={() => onMove(item.key, -1)}
                                                className='rounded-small px-0.5 leading-none text-default-400 hover:bg-default-200 hover:text-default-700 disabled:opacity-25 disabled:hover:bg-transparent'
                                            >
                                                <LuChevronUp className='text-[12px]' />
                                            </button>
                                            <button
                                                type='button'
                                                title={t('config.study.move_down')}
                                                aria-label={t('config.study.move_down')}
                                                disabled={!item.canMoveDown}
                                                onClick={() => onMove(item.key, 1)}
                                                className='rounded-small px-0.5 leading-none text-default-400 hover:bg-default-200 hover:text-default-700 disabled:opacity-25 disabled:hover:bg-transparent'
                                            >
                                                <LuChevronDown className='text-[12px]' />
                                            </button>
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
}
