import { splitSentences } from './sentence.js';

export function parseNumbered(raw, count) {
    const result = Array.from({ length: count }, () => ({ dst: '', error: 'study_missing_number' }));
    const seen = new Set();
    let current = -1;
    let unexpected = false;
    for (const line of String(raw ?? '').split('\n')) {
        if (/^\s*```/.test(line)) continue;
        const match = line.match(/^\s*(?:\*\*)?(\d+)\s*[.、)](?:\*\*)?\s*(.*)$/);
        if (match) {
            const index = Number(match[1]) - 1;
            current = -1;
            if (index < 0 || index >= count) {
                unexpected = true;
                continue;
            }
            if (seen.has(index)) {
                result[index].error = 'study_duplicate_number';
                continue;
            }
            seen.add(index);
            current = index;
            result[index] = { dst: match[2].trim(), error: '' };
        } else if (current >= 0 && line.trim()) {
            result[current].dst += (result[current].dst ? '\n' : '') + line.trim();
        }
    }
    for (const item of result) {
        if (unexpected) item.error = 'study_unexpected_number';
        else if (!item.dst && !item.error) item.error = 'study_missing_number';
    }
    return result;
}

export function getStudyError(error) {
    if (error?.name === 'AbortError') return 'study_stopped';
    if (typeof error?.code === 'string' && error.code.startsWith('study_')) return error.code;
    if (error?.status === 401 || error?.status === 403) return 'study_auth_error';
    if (error?.status === 429) return 'study_rate_limit';
    if (error instanceof TypeError) return 'study_network_error';
    return error?.message || String(error);
}

export function splitStudySentences(text) {
    const paragraphs = [];
    for (const block of String(text ?? '')
        .replace(/\r\n?/g, '\n')
        .split(/\n[ \t]*\n+/)) {
        for (const section of block.split(/\n(?=[ \t]*(?:[-*•]|\d+[.)])\s)/)) {
            const joined = section
                .replace(/\u00ad[ \t]*\n[ \t]*/g, '')
                .replace(/([A-Za-z])-[ \t]*\n[ \t]*(?=[A-Za-z])/g, '$1-')
                .replace(/([\u4e00-\u9fff])[ \t]*\n[ \t]*(?=[\u4e00-\u9fff])/g, '$1')
                .replace(/[ \t]*\n[ \t]*/g, ' ')
                .replace(/\u00ad/g, '')
                .trim();
            if (joined) paragraphs.push(joined);
        }
    }
    return splitSentences(paragraphs.join('\n'));
}

export function replaceStudySentences(pairs, index, count, sentences) {
    if (!sentences.length) return pairs;
    const next = pairs.slice();
    next.splice(index, count, ...sentences.map((src) => ({ src, dst: '', error: '', pending: false })));
    return next;
}

export async function translateStudySentences({ pairs, indices, request, signal, onUpdate }) {
    const result = pairs.map((pair) => ({ ...pair }));
    if (!indices.length) return result;
    for (const index of indices) {
        result[index] = { ...result[index], dst: '', error: '', pending: true };
    }
    onUpdate(result, true);
    const batchSize = indices.length <= 30 ? 30 : 20;
    const batches = [];
    for (let start = 0; start < indices.length; start += batchSize) {
        batches.push(indices.slice(start, start + batchSize));
    }
    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, batches.length) }, async () => {
        while (cursor < batches.length && !signal.aborted) {
            const batch = batches[cursor++];
            const text = batch.map((index, number) => `${number + 1}. ${result[index].src}`).join('\n');
            try {
                const output = await request(text, (value) => {
                    if (signal.aborted) return;
                    const parsed = parseNumbered(value.replace(/_$/, ''), batch.length);
                    batch.forEach((index, number) => {
                        result[index].dst = parsed[number].dst;
                    });
                    onUpdate(result, false);
                });
                if (signal.aborted) break;
                const parsed = parseNumbered(output, batch.length);
                batch.forEach((index, number) => {
                    Object.assign(result[index], parsed[number], { pending: false });
                });
            } catch (error) {
                for (const index of batch) {
                    result[index].error = signal.aborted ? 'study_stopped' : getStudyError(error);
                    result[index].pending = false;
                }
            }
            onUpdate(result, true);
        }
    });
    await Promise.all(workers);
    for (const index of indices) {
        if (result[index].pending) {
            result[index].pending = false;
            result[index].error = 'study_stopped';
        }
    }
    onUpdate(result, true);
    return result;
}

export function buildStudyMarkdown(items, mode, incompleteLabel) {
    return items
        .map((item, index) => {
            const incomplete = item.pending || item.error || !item.dst;
            const status = incomplete ? `> **${incompleteLabel}**${item.error ? ` · ${item.error}` : ''}\n\n` : '';
            const translation = status + (item.dst || '');
            if (mode === 'target') {
                return incomplete ? `${item.src}\n\n${translation}`.trim() : translation;
            }
            return `**${index + 1}.** ${item.src}\n\n${translation}`;
        })
        .filter(Boolean)
        .join(mode === 'target' ? '\n\n' : '\n\n---\n\n');
}
