import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRequest } from '../src/server/api/openai/parse.js';

const options = {
    tempDir: process.cwd(),
    imageLimit: 5,
    backendName: 'runtime',
    getSupportedModels: () => ({ data: [{ id: 'gemini-web/gemini-3.1-pro' }] }),
    getImagePolicy: () => 'optional',
    requestId: 'test',
    logger: { info() {} }
};

test('every model preserves ordered conversation history', async () => {
    const result = await parseRequest({
        model: 'gemini-web/gemini-3.1-pro',
        messages: [
            { role: 'system', content: 'Be precise.' },
            { role: 'user', content: 'Question one' },
            { role: 'assistant', content: 'Answer one' },
            { role: 'user', content: 'Question two' }
        ]
    }, options);

    assert.equal(result.success, true);
    assert.equal(result.data.systemInstruction, 'Be precise.');
    assert.match(result.data.prompt, /^System: Be precise\./);
    assert.match(result.data.prompt, /User: Question one/);
    assert.match(result.data.prompt, /Assistant: Answer one/);
    assert.match(result.data.prompt, /User: Question two/);
    assert.doesNotMatch(result.data.conversationPrompt, /System:/);
});

test('v4 rejects requests without canonical model ID', async () => {
    const result = await parseRequest({ messages: [{ role: 'user', content: 'Hello' }] }, options);
    assert.equal(result.success, false);
    assert.match(result.error.error, /必须提供规范模型 ID/);
});
