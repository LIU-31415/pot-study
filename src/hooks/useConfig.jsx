import { useCallback, useEffect, useRef } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { useGetState } from './useGetState';
import { store } from '../utils/store';

// 写入落盘的合并窗口。文本框每敲一个字符都会调 setter，
// 不合并的话每次按键都写一遍 config.json，还会触发 fs-watch
// 让所有窗口重新加载配置；完全不做延迟又会在「改完立刻关窗口」时丢配置。
const DEFAULT_DEBOUNCE = 200;

export const useConfig = (key, defaultValue, options = {}) => {
    const [property, setPropertyState, getProperty] = useGetState(null);
    const { sync = true, debounceMs = DEFAULT_DEBOUNCE } = options;

    const timerRef = useRef(null);
    const pendingRef = useRef(undefined);
    const flushRef = useRef(() => {});

    // 同步到Store (State -> Store)
    const writeStore = useCallback((v) => {
        store.set(key, v);
        store.save();
        let eventKey = key.replaceAll('.', '_').replaceAll('@', ':');
        emit(`${eventKey}_changed`, v);
    }, []);

    // 把还没落盘的值立刻写掉
    flushRef.current = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (pendingRef.current !== undefined) {
            const v = pendingRef.current;
            pendingRef.current = undefined;
            writeStore(v);
        }
    };

    const syncToStore = useCallback(
        (v) => {
            if (!debounceMs) {
                writeStore(v);
                return;
            }
            pendingRef.current = v;
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                flushRef.current();
            }, debounceMs);
        },
        [debounceMs]
    );

    // 同步到State (Store -> State)
    const syncToState = useCallback((v) => {
        if (v !== null) {
            setPropertyState(v);
        } else {
            store.get(key).then((v) => {
                if (v === null) {
                    setPropertyState(defaultValue);
                    store.set(key, defaultValue);
                    store.save();
                } else {
                    setPropertyState(v);
                }
            });
        }
    }, []);

    const setProperty = useCallback(
        (v, forceSync = false) => {
            setPropertyState(v);
            const isSync = forceSync || sync;
            isSync && syncToStore(v);
        },
        [sync, syncToStore]
    );

    // 初始化
    useEffect(() => {
        syncToState(null);
        const eventKey = key.replaceAll('.', '_').replaceAll('@', ':');
        const unlisten = listen(`${eventKey}_changed`, (e) => {
            syncToState(e.payload);
        });
        return () => {
            unlisten.then((f) => {
                f();
            });
        };
    }, []);

    // 组件卸载（切页面、关弹窗）时把待写值补上，避免配置丢在防抖窗口里
    useEffect(() => {
        return () => {
            flushRef.current();
        };
    }, []);

    return [property, setProperty, getProperty];
};

export const deleteKey = (key) => {
    if (store.has(key)) {
        store.delete(key);
        store.save();
    }
};
