import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readOpenAIStream } from '../src/services/translate/openai/stream.js';
import {
    parseNumbered,
    getStudyError,
    buildStudyMarkdown,
    splitStudySentences,
    replaceStudySentences,
    translateStudySentences,
} from '../src/utils/study.js';

const event = (content, finish = null) =>
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: finish }] })}\n\n`;

test('编号译文保留续行、空白后的正文和 Markdown 编号', () => {
    assert.deepEqual(parseNumbered('**1.** 第一行\n第二行\n\n第三行\n2) 第二句', 2), [
        { dst: '第一行\n第二行\n第三行', error: '' },
        { dst: '第二句', error: '' },
    ]);
});

test('缺号和空译文分别标记到对应句子', () => {
    const result = parseNumbered('1. 第一条\n3. ', 3);
    assert.equal(result[0].error, '');
    assert.equal(result[1].error, 'study_missing_number');
    assert.equal(result[2].error, 'study_missing_number');
});

test('重复编号保留首个译文并标记错误', () => {
    const result = parseNumbered('1. 首个\n1. 重复\n2. 正常', 2);
    assert.equal(result[0].dst, '首个');
    assert.equal(result[0].error, 'study_duplicate_number');
    assert.equal(result[1].error, '');
});

test('越界编号不能生成看似完整的成功结果', () => {
    const result = parseNumbered('1. 一\n2. 二\n3. 多出来的', 2);
    assert.ok(result.every((item) => item.error === 'study_unexpected_number'));
});

test('正常导出保留原有格式', () => {
    const items = [
        { src: 'A', dst: '甲' },
        { src: 'B', dst: '乙' },
    ];
    assert.equal(buildStudyMarkdown(items, 'both', '未完成'), '**1.** A\n\n甲\n\n---\n\n**2.** B\n\n乙');
    assert.equal(buildStudyMarkdown(items, 'target', '未完成'), '甲\n\n乙');
});

test('导出失败句时保留原文、部分译文和失败原因', () => {
    const items = [{ src: 'Original', dst: '部分译文', error: '连接中断' }];
    for (const mode of ['both', 'target']) {
        const output = buildStudyMarkdown(items, mode, '译文未完成');
        assert.match(output, /Original/);
        assert.match(output, /部分译文/);
        assert.match(output, /译文未完成/);
        assert.match(output, /连接中断/);
    }
});

test('导出进行中的译文和空句时明确标记未完成', () => {
    const output = buildStudyMarkdown(
        [
            { src: 'A', dst: '片段', pending: true },
            { src: 'B', dst: '' },
        ],
        'target',
        '未完成'
    );
    assert.equal(output.match(/未完成/g).length, 2);
    assert.match(output, /A/);
    assert.match(output, /B/);
});

test('标准完成标记和 finish_reason=stop 均可结束流', async () => {
    for (const ending of ['data: [DONE]', event('', 'stop')]) {
        let final;
        const result = await readOpenAIStream(new Response(': keepalive\n\n' + event('完整译文') + ending), (text) => {
            final = text;
        });
        assert.equal(result, '完整译文');
        assert.equal(final, result);
    }
});

test('完成标记前的干净 EOF 必须报未完成', async () => {
    await assert.rejects(
        readOpenAIStream(new Response(event('半句译文')), () => {}),
        { code: 'study_stream_incomplete' }
    );
});

test('输出截断、过滤和流内错误均不能当作成功', async () => {
    await assert.rejects(
        readOpenAIStream(new Response(event('片段', 'length')), () => {}),
        { code: 'study_output_limit' }
    );
    await assert.rejects(
        readOpenAIStream(new Response(event('片段', 'content_filter')), () => {}),
        { code: 'study_stream_incomplete' }
    );
    await assert.rejects(
        readOpenAIStream(new Response(event('片段') + 'data: {"error":{"message":"upstream failed"}}\n\n'), () => {}),
        /upstream failed/
    );
});

test('损坏的数据行不会污染后续解析，也不能丢字后报成功', async () => {
    await assert.rejects(
        readOpenAIStream(new Response('data: {broken}\n\n' + event('后续内容') + 'data: [DONE]\n\n'), () => {}),
        { code: 'study_stream_incomplete' }
    );
});

test('UTF-8 字符和 SSE 行跨网络块时不丢字', async () => {
    const bytes = new TextEncoder().encode(event('中文🙂') + 'data: [DONE]\n\n');
    const body = new ReadableStream({
        start(controller) {
            for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
            controller.close();
        },
    });
    assert.equal(await readOpenAIStream(new Response(body), () => {}), '中文🙂');
});

test('收到完成帧后不再等待连接关闭，并取消底层响应', async () => {
    let cancelled = false;
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(event('完整') + event('', 'stop')));
        },
        cancel() {
            cancelled = true;
        },
    });
    assert.equal(await readOpenAIStream(new Response(body), () => {}), '完整');
    assert.equal(cancelled, true);
});

test('普通翻译服务的无回调流式探测仍在首个内容片段返回', async () => {
    let cancelled = false;
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(event('片段')));
        },
        cancel() {
            cancelled = true;
        },
    });
    assert.equal(await readOpenAIStream(new Response(body)), '[STREAM]');
    assert.equal(cancelled, true);
});

test('错误提示区分鉴权、限流、网络和用户停止', () => {
    assert.equal(getStudyError({ status: 401 }), 'study_auth_error');
    assert.equal(getStudyError({ status: 403 }), 'study_auth_error');
    assert.equal(getStudyError({ status: 429 }), 'study_rate_limit');
    assert.equal(getStudyError(new TypeError('fetch failed')), 'study_network_error');
    assert.equal(getStudyError(new DOMException('Aborted', 'AbortError')), 'study_stopped');
    assert.equal(getStudyError(new Error('HTTP 500')), 'HTTP 500');
    assert.equal(getStudyError({ code: 42, message: 'Gateway error' }), 'Gateway error');
});

test('PDF 段内断行合并，空行分段、普通连字符和软连字符分别处理', () => {
    assert.deepEqual(splitStudySentences('The surface is highly\nhydrophobic. It is stable.\n\nNext paragraph'), [
        'The surface is highly hydrophobic.',
        'It is stable.',
        'Next paragraph',
    ]);
    assert.deepEqual(splitStudySentences('water-\nparticle interactions.\n\nHydro\u00ad\nphobic particles.'), [
        'water-particle interactions.',
        'Hydrophobic particles.',
    ]);
    assert.deepEqual(splitStudySentences('颗粒表面保持\n疏水。下一句。'), ['颗粒表面保持疏水。', '下一句。']);
});

test('手动合并和拆分只使修改的句子失效', () => {
    const pairs = [
        { src: 'A', dst: '甲' },
        { src: 'B', dst: '乙' },
        { src: 'C', dst: '丙' },
    ];
    const merged = replaceStudySentences(pairs, 0, 2, ['A B']);
    assert.equal(merged[0].dst, '');
    assert.deepEqual(merged[1], pairs[2]);
    const split = replaceStudySentences(pairs, 1, 1, ['B1', 'B2']);
    assert.deepEqual(
        split.map((pair) => pair.src),
        ['A', 'B1', 'B2', 'C']
    );
    assert.equal(split[0].dst, '甲');
    assert.equal(split[3].dst, '丙');
    assert.equal(pairs[1].dst, '乙');
    assert.equal(replaceStudySentences(pairs, 1, 1, []), pairs);
});

test('局部重试只请求指定句子，保留其他译文与来源', async () => {
    const pairs = [
        { src: 'A', dst: '甲', resultModel: 'old' },
        { src: 'B', dst: '', error: 'failed' },
        { src: 'C', dst: '丙' },
    ];
    const requests = [];
    const result = await translateStudySentences({
        pairs,
        indices: [1],
        signal: new AbortController().signal,
        onUpdate() {},
        request: async (text, setResult) => {
            requests.push(text);
            setResult('1. 新译文_');
            return '1. 新译文';
        },
    });
    assert.deepEqual(requests, ['1. B']);
    assert.deepEqual(result[0], pairs[0]);
    assert.deepEqual(result[2], pairs[2]);
    assert.equal(result[1].dst, '新译文');
    assert.equal(result[1].error, '');
    assert.equal(pairs[1].dst, '');
});

test('长文最多三个请求并行，单批失败不影响其他批', async () => {
    const pairs = Array.from({ length: 61 }, (_, index) => ({ src: `S${index}`, dst: '' }));
    let active = 0;
    let peak = 0;
    let calls = 0;
    const result = await translateStudySentences({
        pairs,
        indices: pairs.map((_, index) => index),
        signal: new AbortController().signal,
        onUpdate() {},
        request: async (text) => {
            calls++;
            peak = Math.max(peak, ++active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active--;
            if (text.startsWith('1. S20\n')) throw new Error('HTTP 500');
            return text
                .split('\n')
                .map((_, index) => `${index + 1}. 译文`)
                .join('\n');
        },
    });
    assert.equal(calls, 4);
    assert.equal(peak, 3);
    assert.equal(result.filter((pair) => pair.error).length, 20);
    assert.ok(result.slice(0, 20).every((pair) => pair.dst && !pair.error));
    assert.ok(result.slice(40).every((pair) => pair.dst && !pair.error));
});

test('停止后保留已收到内容，尚未开始的批次不再请求', async () => {
    const controller = new AbortController();
    const pairs = Array.from({ length: 81 }, (_, index) => ({ src: `S${index}`, dst: '' }));
    let calls = 0;
    const result = await translateStudySentences({
        pairs,
        indices: pairs.map((_, index) => index),
        signal: controller.signal,
        onUpdate() {},
        request: async (_text, setResult) => {
            calls++;
            setResult('1. 已收到的片段_');
            controller.abort();
            throw new DOMException('Aborted', 'AbortError');
        },
    });
    assert.equal(calls, 1);
    assert.equal(result[0].dst, '已收到的片段');
    assert.ok(result.every((pair) => !pair.pending && pair.error === 'study_stopped'));
});

test('忽略取消信号的晚到响应也不能被接受为成功', async () => {
    const controller = new AbortController();
    const result = await translateStudySentences({
        pairs: [{ src: 'A', dst: '' }],
        indices: [0],
        signal: controller.signal,
        onUpdate() {},
        request: async () => {
            controller.abort();
            return '1. 晚到的结果';
        },
    });
    assert.equal(result[0].dst, '');
    assert.equal(result[0].error, 'study_stopped');
});
