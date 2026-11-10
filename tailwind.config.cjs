// tailwind.config.js
const { nextui } = require('@nextui-org/react');

/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        // ...
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
        './node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}',
    ],
    theme: {
        extend: {},
    },
    darkMode: 'class',
    plugins: [
        nextui({
            themes: {
                dark: {
                    colors: {
                        background: '#202020',
                        foreground: '#e7e7e7',
                        content1: '#282828',
                        content2: '#303030',
                        content3: '#383838',
                        content4: '#404040',
                        default: {
                            DEFAULT: '#484848',
                            50: '#282828',
                            100: '#383838',
                            200: '#484848',
                            300: '#585858',
                            400: '#686868',
                            500: '#a7a7a7',
                            600: '#b7b7b7',
                            700: '#c7c7c7',
                            800: '#d7d7d7',
                            900: '#e7e7e7',
                        },
                        primary: {
                            DEFAULT: '#49cee9',
                            foreground: '#181818',
                        },
                    },
                },
                light: {
                    colors: {
                        background: '#ffffff',
                        foreground: '#1d1d1f',
                        content1: '#f7f7f8',
                        content2: '#f2f2f4',
                        content3: '#e8e8ec',
                        content4: '#dedee3',
                        default: {
                            DEFAULT: '#8e8e93',
                            50: '#f7f7f8',
                            100: '#eeeef0',
                            200: '#e2e2e6',
                            300: '#c9c9cf',
                            400: '#a8a8ae',
                            500: '#8e8e93',
                            600: '#6e6e73',
                            700: '#4a4a4f',
                            800: '#2c2c2e',
                            900: '#1d1d1f',
                        },
                        primary: {
                            foreground: '#ffffff',
                            DEFAULT: '#5b5bd6',
                        },
                    },
                },
            },
        }),
    ],
};
