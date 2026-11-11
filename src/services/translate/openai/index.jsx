import { fetch, Body } from '@tauri-apps/api/http';
import { Language } from './info';
import { defaultRequestArguments } from './Config';

export async function translate(text, from, to, options) {
    const { config, setResult, detect, signal } = options;

    let { service, requestPath, model, apiKey, stream, promptList, requestArguments } = config;

    if (!/https?:\/\/.+/.test(requestPath)) {
        requestPath = `https://${requestPath}`;
    }
    const apiUrl = new URL(requestPath);

    // in openai like api, /v1 is not required
    if (service === 'openai' && !apiUrl.pathname.endsWith('/chat/completions')) {
        // not openai like, populate completion endpoint
        apiUrl.pathname += apiUrl.pathname.endsWith('/') ? '' : '/';
        apiUrl.pathname += 'v1/chat/completions';
    }

    // 兼容旧版
    if (promptList === undefined) {
        promptList = [
            {
                role: 'system',
                content:
                    'You are a professional translation engine, please translate the text into a colloquial, professional, elegant and fluent content, without the style of machine translation. You must only translate the text content, never interpret it.',
            },
            { role: 'user', content: `Translate into $to:\n"""\n$text\n"""` },
        ];
    }

    promptList = promptList.map((item) => {
        return {
            ...item,
            content: item.content
                .replaceAll('$text', text)
                .replaceAll('$from', from)
                .replaceAll('$to', to)
                .replaceAll('$detect', Language[detect]),
        };
    });

    const headers =
        service === 'openai'
            ? {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${apiKey}`,
              }
            : {
                  'Content-Type': 'application/json',
                  'api-key': apiKey,
              };
    const body = {
        ...JSON.parse(requestArguments ?? defaultRequestArguments),
        stream: stream,
        messages: promptList,
    };
    if (service === 'openai') {
        body['model'] = model;
    }
    if (stream) {
        const res = await window.fetch(apiUrl.href, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            // 调用方可以传 AbortSignal：重译、切模型、关窗口时取消在跑的流，
            // 否则服务端不结束的话这个请求会一直占着内存
            signal: signal,
        });
        if (res.ok) {
            let target = '';
            const reader = res.body.getReader();
            // 必须复用同一个 TextDecoder 并开 stream 模式：
            // 每个网络块单独解码时，中文字符被拆到两个块会变成乱码
            const decoder = new TextDecoder();
            // SSE 是按行走的协议：空行分隔事件，以 ':' 开头的是注释（magpie 转发慢模型时
            // 会先发 ': keepalive' 保活），只有 'data:' 开头的行才是负载。
            // 旧实现用 split('data:') 切块，把注释行当成「被截断的 JSON 前半截」存进 temp，
            // 之后每一块都拼在它后面，解析从此永久失败、译文恒为空。
            const handleLine = (line) => {
                const text = line.replace(/\r$/, '');
                if (!text || text.startsWith(':')) return false;
                if (!text.startsWith('data:')) return false;
                const payload = text.slice(5).trim();
                if (!payload || payload === '[DONE]') return false;
                let result;
                try {
                    result = JSON.parse(payload);
                } catch {
                    // 单行坏数据直接丢掉，不能污染后续行
                    return false;
                }
                // 结束帧的 choices 是空数组，可选链避免 TypeError
                const delta = result?.choices?.[0]?.delta?.content;
                if (!delta) return false;
                target += delta;
                if (setResult) {
                    setResult(target + '_');
                    return false;
                }
                return true;
            };
            try {
                // 行缓冲：一个事件可能被拆到两个网络块，最后一段不完整的留到下一块再拼
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                        // 收尾：最后一段可能没有换行结尾，补解析一次再返回，
                        // 否则丢掉的正是最后一个 token
                        if (buffer && handleLine(buffer)) return '[STREAM]';
                        setResult?.(target.trim());
                        return target.trim();
                    }
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() ?? '';
                    for (const line of lines) {
                        if (handleLine(line)) return '[STREAM]';
                    }
                }
            } finally {
                reader.releaseLock();
            }
        } else {
            throw `Http Request Error\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`;
        }
    } else {
        let res = await fetch(apiUrl.href, {
            method: 'POST',
            headers: headers,
            body: Body.json(body),
        });
        if (res.ok) {
            let result = res.data;
            const { choices } = result;
            if (choices) {
                let target = choices[0].message.content.trim();
                if (target) {
                    if (target.startsWith('"')) {
                        target = target.slice(1);
                    }
                    if (target.endsWith('"')) {
                        target = target.slice(0, -1);
                    }
                    return target.trim();
                } else {
                    throw JSON.stringify(choices);
                }
            } else {
                throw JSON.stringify(result);
            }
        } else {
            throw `Http Request Error\nHttp Status: ${res.status}\n${JSON.stringify(res.data)}`;
        }
    }
}

export * from './Config';
export * from './info';
