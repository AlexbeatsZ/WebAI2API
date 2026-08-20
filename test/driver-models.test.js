import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBlockedState, normalizeModelLabel } from '../src/backend/adapter/ai_studio.js';

test('AI Studio model labels produce stable, usable IDs', () => {
    assert.equal(normalizeModelLabel('Gemini 3.1 Pro').id, 'gemini-3.1-pro');
    const first = normalizeModelLabel('Experimental Reasoning Model');
    const second = normalizeModelLabel('  Experimental   Reasoning Model  ');
    assert.equal(first.id, second.id);
    assert.match(first.id, /^ui-experimental-reasoning-model-[a-f0-9]{8}$/);
    assert.equal(first.capabilities.reasoning, true);
});

test('AI Studio region redirect is classified before DOM selectors run', async () => {
    const result = await detectBlockedState({
        url: () => 'https://ai.google.dev/gemini-api/docs/available-regions',
        locator: () => { throw new Error('DOM should not be inspected for a known redirect'); }
    });
    assert.deepEqual(result, {
        error: 'AI Studio 在当前网络出口不可用',
        code: 'region_unavailable'
    });
});
