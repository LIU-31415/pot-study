export async function readOpenAIStream(response, setResult) {
    if (!response.body) throw new Error('Translation stream has no body');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let target = '';
    let completed = false;
    let invalidData = false;

    const handleLine = (line) => {
        const text = line.replace(/\r$/, '');
        if (!text.startsWith('data:')) return;
        const payload = text.slice(5).trim();
        if (!payload) return;
        if (payload === '[DONE]') {
            completed = true;
            return;
        }
        let result;
        try {
            result = JSON.parse(payload);
        } catch {
            invalidData = true;
            return;
        }
        if (result?.error) {
            const error = result.error;
            throw new Error(error.message || error.code || JSON.stringify(error));
        }
        const choice = result?.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string') {
            target += delta;
            setResult?.(target + '_');
        }
        if (!setResult && target) return;
        const reason = choice?.finish_reason;
        if (reason === 'stop') completed = true;
        else if (reason) {
            const error = new Error(`Translation stream ended with finish_reason=${reason}`);
            error.code = reason === 'length' ? 'study_output_limit' : 'study_stream_incomplete';
            throw error;
        }
    };

    try {
        let buffer = '';
        while (!completed) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            for (const line of lines) {
                handleLine(line);
                // 无回调的调用方用首个内容片段探测流式能力。
                if (!setResult && target) return '[STREAM]';
                if (completed) break;
            }
            if (done) {
                if (buffer) handleLine(buffer);
                if (!setResult && target) return '[STREAM]';
                break;
            }
        }
        if (!completed || invalidData) {
            const error = new Error('Translation stream ended before a complete response was received');
            error.code = 'study_stream_incomplete';
            throw error;
        }
        setResult?.(target.trim());
        return target.trim();
    } finally {
        // 完成帧、探测和异常都可能早于连接关闭，要释放底层响应。
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}
