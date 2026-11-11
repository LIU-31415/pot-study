import { appWindow } from '@tauri-apps/api/window';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { warn } from 'tauri-plugin-log-api';
import React, { useEffect } from 'react';
import { useTheme } from 'next-themes';

import { invoke } from '@tauri-apps/api/tauri';
import Screenshot from './window/Screenshot';
import Translate from './window/Translate';
import Recognize from './window/Recognize';
import Updater from './window/Updater';
import { store } from './utils/store';
import { flushAllConfigs } from './hooks/useConfig';
import Config from './window/Config';
import { useConfig } from './hooks';
import './style.css';
import './i18n';

const windowMap = {
    translate: <Translate />,
    screenshot: <Screenshot />,
    recognize: <Recognize />,
    config: <Config />,
    updater: <Updater />,
};

export default function App() {
    const [devMode] = useConfig('dev_mode', false);
    const [appTheme] = useConfig('app_theme', 'system');
    const [appLanguage] = useConfig('app_language', 'en');
    const [appFont] = useConfig('app_font', 'default');
    const [appFallbackFont] = useConfig('app_fallback_font', 'default');
    const [appFontSize] = useConfig('app_font_size', 16);
    const { setTheme } = useTheme();
    const { i18n } = useTranslation();

    useEffect(() => {
        store.load();
    }, []);

    useEffect(() => {
        const allowKeys = ['c', 'v', 'x', 'a', 'z', 'y'];
        const handler = async (e) => {
            if (e.ctrlKey && !allowKeys.includes(e.key.toLowerCase())) {
                e.preventDefault();
            }
            if (devMode !== null && devMode) {
                if (e.key === 'F12') {
                    await invoke('open_devtools');
                }
            }
            if (e.key.startsWith('F') && e.key.length > 1) {
                e.preventDefault();
            }
            if (e.key === 'Escape') {
                // 先把合并窗口里没落盘的配置写完，再关窗口
                await flushAllConfigs();
                await appWindow.close();
            }
        };
        document.addEventListener('keydown', handler);
        // 之前没有 cleanup，devMode 切换一次就多挂一个监听，按键逻辑会重复执行
        return () => {
            document.removeEventListener('keydown', handler);
        };
    }, [devMode]);

    useEffect(() => {
        if (appTheme !== null) {
            if (appTheme !== 'system') {
                setTheme(appTheme);
            } else {
                try {
                    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
                        setTheme('dark');
                    } else {
                        setTheme('light');
                    }
                    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
                        if (e.matches) {
                            setTheme('dark');
                        } else {
                            setTheme('light');
                        }
                    });
                } catch {
                    warn("Can't detect system theme.");
                }
            }
        }
    }, [appTheme]);

    useEffect(() => {
        if (appLanguage !== null) {
            i18n.changeLanguage(appLanguage);
        }
    }, [appLanguage]);

    useEffect(() => {
        if (appFont !== null && appFallbackFont !== null) {
            document.documentElement.style.fontFamily = `"${appFont === 'default' ? 'sans-serif' : appFont}","${
                appFallbackFont === 'default' ? 'sans-serif' : appFallbackFont
            }"`;
        }
        if (appFontSize !== null) {
            document.documentElement.style.fontSize = `${appFontSize}px`;
        }
    }, [appFont, appFallbackFont, appFontSize]);

    return (
        <BrowserRouter>
            {/* 全局只挂一个 Toaster：每个页面各挂一个时，切换页面会让
                还没过期的 toast 在新 Toaster 上重放一遍，看着像反复弹出 */}
            <Toaster />
            {windowMap[appWindow.label]}
        </BrowserRouter>
    );
}
