import { useCallback, useEffect, useRef } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { useGetState } from './useGetState';
import { store } from '../utils/store';

// 写入落盘的合并窗口。文本框每敲一个字符都会调 setter，
// 不合并的话每次按键都写一遍 config.json，还会触发 fs-watch
// 让所有窗口重新加载配置；完全不做延迟又会在「改完立刻关窗口」时丢配置。
const DEFAULT_DEBOUNCE = 200;

// 所有 useConfig 的待写队列：关窗口前统一冲一次。
// React 卸载时的补写只在组件正常卸载时跑，原生关闭窗口不会等它
const flushRegistry = new Set();

export const flushAllConfigs = async () => {
    const tasks = Array.from(flushRegistry).map((f) => f());
    await Promise.allSettled(tasks);
};

export const useConfig = (key, defaultValue, options = {}) => {
    const [property, setPropertyState, getProperty] = useGetState(null);
    const { sync = true, debounceMs = DEFAULT_DEBOUNCE } = options;

    const timerRef = useRef(null);
    const pendingRef = useRef(undefined);
    const flushRef = useRef(() => {});

    // 同步到Store (State -> Store)
    const writeStore = useCallback((v) => {
        store.set(key, v);
        let eventKey = key.replaceAll('.', '_').replaceAll('@', ':');
        // 组件卸载时还会 flush 一次，那会儿窗口可能在销毁，广播失败不能影响落盘
        try {
            emit(`${eventKey}_changed`, v)?.catch?.(() => {});
        } catch {
            // ignore
        }
        return store.save();
    }, []);

    // 把还没落盘的值立刻写掉，返回保存 Promise
    flushRef.current = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        if (pendingRef.current !== undefined) {
            const v = pendingRef.current;
            pendingRef.current = undefined;
            return writeStore(v);
        }
        return Promise.resolve();
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

    // 组件卸载（切页面、关弹窗）时把待写值补上；
    // 同时登记到全局队列，供窗口关闭前统一 flush
    useEffect(() => {
        const fn = () => flushRef.current();
        flushRegistry.add(fn);
        return () => {
            fn();
            flushRegistry.delete(fn);
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
