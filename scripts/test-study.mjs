import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readOpenAIStream } from '../src/services/translate/openai/stream.js';
import { parseNumbered, getStudyError, buildStudyMarkdown } from '../src/utils/study.js';

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
    const items = [{ src: 'A', dst: '甲' }, { src: 'B', dst: '乙' }];
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
    const output = buildStudyMarkdown([{ src: 'A', dst: '片段', pending: true }, { src: 'B', dst: '' }], 'target', '未完成');
    assert.equal(output.match(/未完成/g).length, 2);
    assert.match(output, /A/);
    assert.match(output, /B/);
});

test('标准完成标记和 finish_reason=stop 均可结束流', async () => {
    for (const ending of ['data: [DONE]', event('', 'stop')]) {
        let final;
        const result = await readOpenAIStream(new Response(': keepalive\n\n' + event('完整译文') + ending), (text) => { final = text; });
        assert.equal(result, '完整译文');
        assert.equal(final, result);
    }
});

test('完成标记前的干净 EOF 必须报未完成', async () => {
    await assert.rejects(readOpenAIStream(new Response(event('半句译文')), () => {}), { code: 'study_stream_incomplete' });
});

test('输出截断、过滤和流内错误均不能当作成功', async () => {
    await assert.rejects(readOpenAIStream(new Response(event('片段', 'length')), () => {}), { code: 'study_output_limit' });
    await assert.rejects(readOpenAIStream(new Response(event('片段', 'content_filter')), () => {}), { code: 'study_stream_incomplete' });
    await assert.rejects(readOpenAIStream(new Response(event('片段') + 'data: {"error":{"message":"upstream failed"}}\n\n'), () => {}), /upstream failed/);
});

test('损坏的数据行不会污染后续解析，也不能丢字后报成功', async () => {
    await assert.rejects(readOpenAIStream(new Response('data: {broken}\n\n' + event('后续内容') + 'data: [DONE]\n\n'), () => {}), { code: 'study_stream_incomplete' });
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
        start(controller) { controller.enqueue(new TextEncoder().encode(event('完整') + event('', 'stop'))); },
        cancel() { cancelled = true; },
    });
    assert.equal(await readOpenAIStream(new Response(body), () => {}), '完整');
    assert.equal(cancelled, true);
});

test('普通翻译服务的无回调流式探测仍在首个内容片段返回', async () => {
    let cancelled = false;
    const body = new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode(event('片段'))); },
        cancel() { cancelled = true; },
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
