import test from 'node:test';
import assert from 'node:assert/strict';
import { readAssistantSnapshot } from '../src/backend/adapter/chatgpt_text.js';

test('ChatGPT DOM observer reads the newest assistant response', () => {
    const previousDocument = globalThis.document;
    const assistant = (text) => ({
        innerText: text,
        textContent: text,
        querySelectorAll: () => [{ innerText: text, textContent: text }]
    });
    globalThis.document = {
        querySelectorAll: () => [
            assistant('ChatGPT said: old answer'),
            assistant('ChatGPT said: WEB2API_CHATGPT_OK')
        ]
    };
    try {
        assert.deepEqual(readAssistantSnapshot(), {
            count: 2,
            text: 'WEB2API_CHATGPT_OK'
        });
    } finally {
        globalThis.document = previousDocument;
    }
});
