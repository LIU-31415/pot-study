import { Button, Card, CardBody, CardFooter, Chip, Tooltip } from '@nextui-org/react';
import { BaseDirectory, readTextFile } from '@tauri-apps/api/fs';
import React, { useEffect, useRef, useState } from 'react';
import { writeText } from '@tauri-apps/api/clipboard';
import { LuVolume2 } from 'react-icons/lu';
import { appWindow } from '@tauri-apps/api/window';
import toast, { Toaster } from 'react-hot-toast';
import { listen } from '@tauri-apps/api/event';
import { LuCopy } from 'react-icons/lu';
import { LuWrapText } from 'react-icons/lu';
import { useTranslation } from 'react-i18next';
import { LuLanguages } from 'react-icons/lu';
import { LuChevronDown } from 'react-icons/lu';
import { LuChevronUp } from 'react-icons/lu';
import { LuTrash2 } from 'react-icons/lu';
import { invoke } from '@tauri-apps/api';
import { atom, useAtom } from 'jotai';
import { getServiceName, getServiceSouceType, ServiceSourceType } from '../../../../utils/service_instance';
import { useConfig, useSyncAtom, useVoice, useToastStyle } from '../../../../hooks';
import { invoke_plugin } from '../../../../utils/invoke_plugin';
import * as recognizeServices from '../../../../services/recognize';
import * as builtinTtsServices from '../../../../services/tts';
import detect from '../../../../utils/lang_detect';
import { store } from '../../../../utils/store';
import { info } from 'tauri-plugin-log-api';
import { debug } from 'tauri-plugin-log-api';

export const sourceTextAtom = atom('');
export const detectLanguageAtom = atom('');
export const translateModeAtom = atom('quick');

let unlisten = null;
let unlistenStudy = null;
let timer = null;

export default function SourceArea(props) {
    const { pluginList, serviceInstanceConfigMap } = props;
    const [appFontSize] = useConfig('app_font_size', 16);
    const [sourceText, setSourceText, syncSourceText] = useSyncAtom(sourceTextAtom);
    const [detectLanguage, setDetectLanguage] = useAtom(detectLanguageAtom);
    const [translateMode, setTranslateMode] = useAtom(translateModeAtom);
    const [incrementalTranslate] = useConfig('incremental_translate', false);
    const [dynamicTranslate] = useConfig('dynamic_translate', false);
    const [deleteNewline] = useConfig('translate_delete_newline', false);
    const [recognizeLanguage] = useConfig('recognize_language', 'auto');
    const [recognizeServiceList] = useConfig('recognize_service_list', ['system', 'tesseract']);
    const [ttsServiceList] = useConfig('tts_service_list', ['lingva_tts']);
    const [hideWindow] = useConfig('translate_hide_window', false);
    const [hideSource] = useConfig('hide_source', false);
    const [ttsPluginInfo, setTtsPluginInfo] = useState();
    const [windowType, setWindowType] = useState('[SELECTION_TRANSLATE]');
    const toastStyle = useToastStyle();
    const { t } = useTranslation();
    const textAreaRef = useRef();
    const [sourceExpanded, setSourceExpanded] = useState(false);
    const [hasOverflow, setHasOverflow] = useState(false);
    const speak = useVoice();

    const handleNewText = async (text) => {
        text = text.trim();
        if (hideWindow) {
            appWindow.hide();
        } else {
            appWindow.show();
            appWindow.setFocus();
        }
        // 清空检测语言
        setDetectLanguage('');
        if (text === '[INPUT_TRANSLATE]') {
            setWindowType('[INPUT_TRANSLATE]');
            appWindow.show();
            appWindow.setFocus();
            setSourceText('', true);
        } else if (text === '[IMAGE_TRANSLATE]') {
            setWindowType('[IMAGE_TRANSLATE]');
            const base64 = await invoke('get_base64');
            const serviceInstanceKey = recognizeServiceList[0];
            if (getServiceSouceType(serviceInstanceKey) === ServiceSourceType.PLUGIN) {
                if (recognizeLanguage in pluginList['recognize'][getServiceName(serviceInstanceKey)].language) {
                    const pluginConfig = serviceInstanceConfigMap[serviceInstanceKey];

                    let [func, utils] = await invoke_plugin('recognize', getServiceName(serviceInstanceKey));
                    func(
                        base64,
                        pluginList['recognize'][getServiceName(serviceInstanceKey)].language[recognizeLanguage],
                        {
                            config: pluginConfig,
                            utils,
                        }
                    ).then(
                        (v) => {
                            let newText = v.trim();
                            if (deleteNewline) {
                                newText = v.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                            } else {
                                newText = v.trim();
                            }
                            if (incrementalTranslate) {
                                setSourceText((old) => {
                                    return old + ' ' + newText;
                                });
                            } else {
                                setSourceText(newText);
                            }
                            detect_language(newText).then(() => {
                                syncSourceText();
                            });
                        },
                        (e) => {
                            setSourceText(e.toString());
                        }
                    );
                } else {
                    setSourceText('Language not supported');
                }
            } else {
                if (recognizeLanguage in recognizeServices[getServiceName(serviceInstanceKey)].Language) {
                    const instanceConfig = serviceInstanceConfigMap[serviceInstanceKey];
                    recognizeServices[getServiceName(serviceInstanceKey)]
                        .recognize(
                            base64,
                            recognizeServices[getServiceName(serviceInstanceKey)].Language[recognizeLanguage],
                            {
                                config: instanceConfig,
                            }
                        )
                        .then(
                            (v) => {
                                let newText = v.trim();
                                if (deleteNewline) {
                                    newText = v.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                                } else {
                                    newText = v.trim();
                                }
                                if (incrementalTranslate) {
                                    setSourceText((old) => {
                                        return old + ' ' + newText;
                                    });
                                } else {
                                    setSourceText(newText);
                                }
                                detect_language(newText).then(() => {
                                    syncSourceText();
                                });
                            },
                            (e) => {
                                setSourceText(e.toString());
                            }
                        );
                } else {
                    setSourceText('Language not supported');
                }
            }
        } else {
            setWindowType('[SELECTION_TRANSLATE]');
            let newText = text.trim();
            if (deleteNewline) {
                newText = text.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
            } else {
                newText = text.trim();
            }
            if (incrementalTranslate) {
                setSourceText((old) => {
                    return old + ' ' + newText;
                });
            } else {
                setSourceText(newText);
            }
            detect_language(newText).then(() => {
                syncSourceText();
            });
        }
    };

    const keyDown = (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            detect_language(sourceText).then(() => {
                syncSourceText();
            });
        }
        if (event.key === 'Escape') {
            appWindow.close();
        }
    };

    const handleSpeak = async () => {
        const instanceKey = ttsServiceList[0];
        let detected = detectLanguage;
        if (detected === '') {
            detected = await detect(sourceText);
            setDetectLanguage(detected);
        }
        if (getServiceSouceType(instanceKey) === ServiceSourceType.PLUGIN) {
            if (!(detected in ttsPluginInfo.language)) {
                throw new Error('Language not supported');
            }
            const pluginConfig = serviceInstanceConfigMap[instanceKey];
            let [func, utils] = await invoke_plugin('tts', getServiceName(instanceKey));
            let data = await func(sourceText, ttsPluginInfo.language[detected], {
                config: pluginConfig,
                utils,
            });
            speak(data);
        } else {
            if (!(detected in builtinTtsServices[getServiceName(instanceKey)].Language)) {
                throw new Error('Language not supported');
            }
            const instanceConfig = serviceInstanceConfigMap[instanceKey];
            let data = await builtinTtsServices[getServiceName(instanceKey)].tts(
                sourceText,
                builtinTtsServices[getServiceName(instanceKey)].Language[detected],
                {
                    config: instanceConfig,
                }
            );
            speak(data);
        }
    };

    useEffect(() => {
        if (hideWindow !== null) {
            if (unlisten) {
                unlisten.then((f) => {
                    f();
                });
            }
            if (unlistenStudy) {
                unlistenStudy.then((f) => {
                    f();
                });
            }
            unlisten = listen('new_text', (event) => {
                appWindow.setFocus();
                setTranslateMode('quick');
                // 空载荷不清空内容：焦点在翻译窗口上时取不到新选区，后端会沿用旧文字，
                // 这里再防一层，避免任何情况下把已有译文抹掉
                if (event.payload && String(event.payload).trim()) {
                    handleNewText(event.payload);
                }
            });
            unlistenStudy = listen('new_text_study', (event) => {
                appWindow.setFocus();
                setTranslateMode('study');
                if (event.payload && String(event.payload).trim()) {
                    handleNewText(event.payload);
                }
            });
        }
    }, [hideWindow]);

    useEffect(() => {
        if (ttsServiceList && getServiceSouceType(ttsServiceList[0]) === ServiceSourceType.PLUGIN) {
            readTextFile(`plugins/tts/${getServiceName(ttsServiceList[0])}/info.json`, {
                dir: BaseDirectory.AppConfig,
            }).then((infoStr) => {
                setTtsPluginInfo(JSON.parse(infoStr));
            });
        }
    }, [ttsServiceList]);

    useEffect(() => {
        if (
            deleteNewline !== null &&
            incrementalTranslate !== null &&
            recognizeLanguage !== null &&
            recognizeServiceList !== null &&
            hideWindow !== null
        ) {
            invoke('get_text').then(async (v) => {
                try {
                    const m = await invoke('get_translate_mode');
                    setTranslateMode(m === 'study' ? 'study' : 'quick');
                } catch {}
                handleNewText(v);
            });
        }
    }, [deleteNewline, incrementalTranslate, recognizeLanguage, recognizeServiceList, hideWindow]);

    // 原文默认只占一行，把空间让给译文；[INPUT_TRANSLATE] 是自己输入的，保持展开
    const sourceForceExpanded = windowType === '[INPUT_TRANSLATE]';
    const sourceIsExpanded = sourceExpanded || sourceForceExpanded;

    useEffect(() => {
        const el = textAreaRef.current;
        if (!el) return;
        const lineHeight = Math.round(appFontSize * 1.6);
        el.style.height = '0px';
        const contentHeight = el.scrollHeight;
        if (sourceIsExpanded) {
            el.style.height = contentHeight + 'px';
        } else {
            el.style.height = lineHeight + 'px';
        }
        el.style.overflowY = 'hidden';
        setHasOverflow(contentHeight > lineHeight + 2);
    }, [sourceText, sourceIsExpanded, appFontSize]);

    const detect_language = async (text) => {
        // 检测失败（断网、接口不可用）不能挡住翻译：
        // 之前这里 reject 会让外层 .then 不执行，译文永远不更新，也看不出为什么
        try {
            setDetectLanguage(await detect(text));
        } catch {
            // 保留上一次的检测结果，继续走翻译
        }
    };

    // 定时器必须放在 ref 里：写成普通局部变量每次 render 都会重置成 null，
    // 连续输入时旧定时器就清不掉，会发多次检测和翻译请求
    const sourceTextChangeTimer = useRef(null);
    const changeSourceText = async (text) => {
        setDetectLanguage('');
        await setSourceText(text);
        if (dynamicTranslate) {
            if (sourceTextChangeTimer.current) {
                clearTimeout(sourceTextChangeTimer.current);
            }
            sourceTextChangeTimer.current = setTimeout(() => {
                detect_language(text).then(() => {
                    syncSourceText();
                });
            }, 1000);
        }
    }

    const transformVarName = function (str) {
        let str2 = str;

        // snake_case to SNAKE_CASE
        if (/_[a-z]/.test(str2)) {
            str2 = str2.split('_').map(it => it.toLocaleUpperCase()).join('_');
        }
        if (str2 !== str) {
            return str2;
        }

        // SNAKE_CASE to kebab-case
        if (/^[A-Z]+(_[A-Z]+)*$/.test(str2)) {
            str2 = str2.split('_').map(it => it.toLocaleLowerCase()).join('-');
        }
        if (str2 !== str) {
            return str2;
        }

        // kebab-case to dot.notation
        if (/-/.test(str2)) {
            str2 = str2.split('-').map(it => it.toLocaleLowerCase()).join('.');
        }
        if (str2 !== str) {
            return str2;
        }

        // dot.notation to space separated
        if (/\.[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/(\.)([a-z])/g, (_, _2, it) => ' ' + it);
        }
        if (str2 !== str) {
            return str2;
        }

        // space separated to Title Case
        if (/\s[a-z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([a-z])/g, (_, it) => ' ' + it.toLocaleUpperCase());
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // Title Case to CamelCase
        if (/\s[A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/\s([A-Z])/g, (_, it) => it);
            str2 = str2.substring(0, 1).toLocaleLowerCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // CamelCase to PascalCase
        if (/^[a-z]+[A-Z]+/.test(str2)) {
            str2 = str2.substring(0, 1).toLocaleUpperCase() + str2.substring(1);
        }
        if (str2 !== str) {
            return str2;
        }

        // PascalCase to snake_case
        if (/[^\s][A-Z]/.test(str2)) {
            str2 = str2.replaceAll(/[A-Z]/g, (it, offset) => {
                return (offset == 0 ? '' : '_') + it.toLocaleLowerCase();
            });
        }

        return str2;
    }
    useEffect(() => {
        textAreaRef.current.addEventListener("keydown", async (event) => {
            if (event.altKey && event.shiftKey && event.code === 'KeyU') {
                const originText = textAreaRef.current.value;
                const selectionStart = textAreaRef.current.selectionStart;
                const selectionEnd = textAreaRef.current.selectionEnd;
                const selectionText = originText.substring(selectionStart, selectionEnd);

                const convertedText = transformVarName(selectionText);
                const targetText = originText.substring(0, selectionStart) + convertedText + originText.substring(selectionEnd);

                await changeSourceText(targetText);
                textAreaRef.current.selectionStart = selectionStart;
                textAreaRef.current.selectionEnd = selectionStart + convertedText.length;
            }
        });
    }, [textAreaRef]);


    return (
        <div className={hideSource && windowType !== '[INPUT_TRANSLATE]' && 'hidden'}>
            <Card
                shadow='none'
                className='bg-content1 rounded-[14px] mt-[1px] pb-0'
            >
                <Toaster />
                <CardBody className='bg-content1 p-[14px] pb-0 max-h-[40vh] overflow-y-auto'>
                    <textarea
                        autoFocus
                        ref={textAreaRef}
                        className='leading-[1.6] text-default-700 bg-content1 resize-none outline-none'
                        style={{ fontSize: `${appFontSize}px` }}
                        value={sourceText}
                        onKeyDown={keyDown}
                        onChange={(e) => {
                            const v = e.target.value;
                            changeSourceText(v);
                        }}
                    />
                </CardBody>

                <CardFooter className='bg-content1 rounded-none rounded-b-[14px] flex justify-between px-[12px] py-[5px]'>
                    <div className='flex justify-start'>
                        <div className='flex items-center gap-[2px] mr-[6px] [&_button]:!rounded-full [&_button]:!text-default-500 [&_button]:data-[hover=true]:!bg-content2'>
                            <Tooltip content={t('translate.speak')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        handleSpeak().catch((e) => {
                                            toast.error(e.toString(), { style: toastStyle });
                                        });
                                    }}
                                >
                                    <LuVolume2 className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.copy')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        writeText(sourceText);
                                    }}
                                >
                                    <LuCopy className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('translate.delete_newline')}>
                                <Button
                                    isIconOnly
                                    variant='light'
                                    size='sm'
                                    onPress={() => {
                                        const newText = sourceText.replace(/\-\s+/g, '').replace(/\s+/g, ' ');
                                        setSourceText(newText);
                                        detect_language(newText).then(() => {
                                            syncSourceText();
                                        });
                                    }}
                                >
                                    <LuWrapText className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            <Tooltip content={t('common.clear')}>
                                <Button
                                    variant='light'
                                    size='sm'
                                    isIconOnly
                                    isDisabled={sourceText === ''}
                                    onPress={() => {
                                        // 只改本地值不够：atom 还留着旧内容，
                                        // 译文区会继续显示上一段的翻译结果
                                        setSourceText('');
                                        syncSourceText('');
                                    }}
                                >
                                    <LuTrash2 className='text-[16px]' />
                                </Button>
                            </Tooltip>
                            {hasOverflow && !sourceForceExpanded && (
                                <Tooltip
                                    content={
                                        sourceIsExpanded
                                            ? t('translate.collapse_source')
                                            : t('translate.expand_source')
                                    }
                                >
                                    <Button
                                        isIconOnly
                                        variant='light'
                                        size='sm'
                                        onPress={() => setSourceExpanded((v) => !v)}
                                    >
                                        {sourceIsExpanded ? (
                                            <LuChevronUp className='text-[16px]' />
                                        ) : (
                                            <LuChevronDown className='text-[16px]' />
                                        )}
                                    </Button>
                                </Tooltip>
                            )}
                        </div>
                        {detectLanguage !== '' && (
                            <Chip
                                size='sm'
                                color='secondary'
                                variant='flat'
                                className='my-auto bg-secondary-50 text-secondary-600'
                            >
                                {t(`languages.${detectLanguage}`)}
                            </Chip>
                        )}
                    </div>
                    <Tooltip content={t('translate.translate')}>
                        <Button
                            size='sm'
                            color='primary'
                            variant='light'
                            isIconOnly
                            className='text-[14px] font-bold rounded-full'
                            startContent={<LuLanguages className='text-[16px]' />}
                            onPress={() => {
                                detect_language(sourceText).then(() => {
                                    syncSourceText();
                                });
                            }}
                        />
                    </Tooltip>
                </CardFooter>
            </Card>
        </div>
    );
}
