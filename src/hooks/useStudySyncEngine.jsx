// 双向同步引擎的窗口挂载点。在翻译窗口与设置窗口根组件各调用一次。
// 两份引擎同时活着是预期内的：syncTranslateToStudy / syncStudyToTranslate
// 本身幂等（已同步则返回 null、不写不发），重复触发只是空转。
// 提示 toast 依赖页面已渲染的 <Toaster />（与各服务设置页的用法一致）。
import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

import { useConfig } from './useConfig';
import { useToastStyle } from './useToastStyle';
import { syncTranslateToStudy, syncStudyToTranslate, eventKeyOf, saveSyncNotice } from '../utils/study_sync';

export const useStudySyncEngine = () => {
    const { t } = useTranslation();
    const toastStyle = useToastStyle();
    const [translateServiceInstanceList] = useConfig('translate_service_list', []);
    // 翻译模式当前激活服务 = 列表第一位
    const activeKey = (translateServiceInstanceList ?? [])[0];

    const latest = useRef({ t, toastStyle });
    latest.current = { t, toastStyle };

    const runAndNotifyRef = useRef(async () => {});
    runAndNotifyRef.current = async (direction) => {
        try {
            const result =
                direction === 'to_study'
                    ? await syncTranslateToStudy()
                    : await syncStudyToTranslate();
            if (!result) return;
            await saveSyncNotice(result);
            const { t: tr, toastStyle: style } = latest.current;
            const base =
                result.direction === 'to_study'
                    ? tr('config.study.sync_toast_to_study', { name: result.name })
                    : tr('config.study.sync_toast_to_translate', { name: result.name });
            const suffix = result.replaced
                ? tr('config.study.sync_replaced', { name: result.replaced })
                : '';
            toast(`${base}${suffix}`, { style, duration: 4000 });
        } catch {
            // 同步失败不阻塞主流程，等下一次配置事件再试
        }
    };

    // 一类触发源：翻译服务列表（选择/排序变化）、学习模式配置（选择/字段变化）
    useEffect(() => {
        let disposed = false;
        const unlistens = [];
        (async () => {
            const jobs = [
                ['translate_service_list_changed', 'to_study'],
                ['study_services_changed', 'to_translate'],
                ['study_service_id_changed', 'to_translate'],
            ];
            for (const [event, direction] of jobs) {
                const un = await listen(event, () => runAndNotifyRef.current(direction));
                if (disposed) {
                    un();
                } else {
                    unlistens.push(un);
                }
            }
        })();
        return () => {
            disposed = true;
            unlistens.forEach((u) => u());
        };
    }, []);

    // 二类触发源：激活实例自身的配置保存（如在服务设置里改了模型）
    useEffect(() => {
        if (!activeKey) return undefined;
        let disposed = false;
        let unlistenFn = null;
        (async () => {
            const un = await listen(eventKeyOf(activeKey), () =>
                runAndNotifyRef.current('to_study')
            );
            if (disposed) {
                un();
            } else {
                unlistenFn = un;
            }
        })();
        return () => {
            disposed = true;
            if (unlistenFn) {
                unlistenFn();
            }
        };
    }, [activeKey]);
};
