import { type, arch as archFn, version } from '@tauri-apps/api/os';
import { getVersion } from '@tauri-apps/api/app';

export let osType = '';
export let arch = '';
export let osVersion = '';
export let appVersion = '';

export async function initEnv() {
    // 四个查询互不依赖，并行取：原来串行 await 等于把四次 IPC 排队
    const [t, a, v, av] = await Promise.all([
        type(),
        archFn(),
        version(),
        getVersion(),
    ]);
    osType = t;
    arch = a;
    osVersion = v;
    appVersion = av;
}
