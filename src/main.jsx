import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { appWindow } from '@tauri-apps/api/window';
import { NextUIProvider } from '@nextui-org/react';
import ReactDOM from 'react-dom/client';
import React from 'react';

import { initStore } from './utils/store';
import { initEnv } from './utils/env';
import App from './App';
import { error as logError } from 'tauri-plugin-log-api';

if (import.meta.env.PROD) {
    document.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });
}

// [dev] 把前端运行时错误写进日志，用于定位白屏
window.addEventListener('error', (e) => {
    logError(`[render] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}\nSTACK: ${(e.error && e.error.stack) || 'n/a'}`);
});
window.addEventListener('unhandledrejection', (e) => {
    logError(`[promise] ${String(e.reason)}`);
});

initStore().then(async () => {
    await initEnv();
    const rootElement = document.getElementById('root');
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <NextUIProvider>
            <NextThemesProvider attribute='class'>
                <App />
            </NextThemesProvider>
        </NextUIProvider>
    );
});
