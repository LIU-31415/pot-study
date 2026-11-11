import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@nextui-org/react';
import {
    LuBookOpen,
    LuCloud,
    LuHistory,
    LuInfo,
    LuKeyboard,
    LuLanguages,
    LuPuzzle,
    LuScanLine,
    LuSettings2,
} from 'react-icons/lu';
import { useTranslation } from 'react-i18next';
import React from 'react';

export default function SideBar() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();

    function setStyle(pathname) {
        return location.pathname.includes(pathname) ? 'flat' : 'light';
    }

    const items = [
        { path: '/general', label: t('config.general.label'), icon: <LuSettings2 /> },
        { path: '/translate', label: t('config.translate.label'), icon: <LuLanguages /> },
        { path: '/study', label: t('config.study.label'), icon: <LuBookOpen /> },
        { path: '/service', label: t('config.service.label'), icon: <LuPuzzle /> },
        { path: '/recognize', label: t('config.recognize.label'), icon: <LuScanLine /> },
        { path: '/hotkey', label: t('config.hotkey.label'), icon: <LuKeyboard /> },
        { path: '/history', label: t('config.history.label'), icon: <LuHistory /> },
        { path: '/backup', label: t('config.backup.label'), icon: <LuCloud /> },
        { path: '/about', label: t('config.about.label'), icon: <LuInfo /> },
    ];

    return (
        <div className='mx-[12px] overflow-y-auto'>
            {items.map((item) => (
                <Button
                    key={item.path}
                    fullWidth
                    size='lg'
                    variant={setStyle(item.path)}
                    className='mb-[5px]'
                    onPress={() => {
                        navigate(item.path);
                    }}
                    startContent={<span className='text-[20px]'>{item.icon}</span>}
                >
                    <div className='w-full'>{item.label}</div>
                </Button>
            ))}
        </div>
    );
}
