import { useCallback, useEffect } from 'react';
import { listen, emit } from '@tauri-apps/api/event';
import { useGetState } from './useGetState';
import { store } from '../utils/store';

export const useConfig = (key, defaultValue, options = {}) => {
    const [property, setPropertyState, getProperty] = useGetState(null);
    const { sync = true } = options;

    // 同步到Store (State -> Store)
    // 不做 debounce：配置项都是离散操作（开关、下拉、输入框），
    // 原实现延迟 500ms 落盘，改完立刻关窗口就会丢配置。
    const syncToStore = useCallback((v) => {
        store.set(key, v);
        store.save();
        let eventKey = key.replaceAll('.', '_').replaceAll('@', ':');
        emit(`${eventKey}_changed`, v);
    }, []);

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

    const setProperty = useCallback((v, forceSync = false) => {
        setPropertyState(v);
        const isSync = forceSync || sync;
        isSync && syncToStore(v);
    }, []);

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

    return [property, setProperty, getProperty];
};

export const deleteKey = (key) => {
    if (store.has(key)) {
        store.delete(key);
        store.save();
    }
};
