import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModelLabel } from '../src/backend/adapter/ai_studio.js';

test('AI Studio model labels produce stable, usable IDs', () => {
    assert.equal(normalizeModelLabel('Gemini 3.1 Pro').id, 'gemini-3.1-pro');
    const first = normalizeModelLabel('Experimental Reasoning Model');
    const second = normalizeModelLabel('  Experimental   Reasoning Model  ');
    assert.equal(first.id, second.id);
    assert.match(first.id, /^ui-experimental-reasoning-model-[a-f0-9]{8}$/);
    assert.equal(first.capabilities.reasoning, true);
});
