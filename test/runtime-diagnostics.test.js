import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeManager } from '../src/backend/runtime/RuntimeManager.js';
import { SLOT_STATES } from '../src/backend/runtime/PageSlot.js';

function createSlot(profileId, siteId, calls, page = null) {
    let token = null;
    return {
        id: `${profileId}:${siteId}:1`,
        profileId,
        siteId,
        state: SLOT_STATES.IDLE,
        lastUsedAt: 0,
        supports(modelId) {
            return modelId.startsWith(`${siteId}/`);
        },
        tryReserve() {
            if (this.state !== SLOT_STATES.IDLE) return null;
            token = `${this.id}:token`;
            this.state = SLOT_STATES.RESERVED;
            return token;
        },
        async execute(received, context, prompt, paths, modelId, meta) {
            assert.equal(received, token);
            calls.push({ profileId, siteId, prompt, modelId, meta });
            this.state = SLOT_STATES.IDLE;
            return { text: 'READY' };
        },
        async inspect(received, operation) {
            assert.equal(received, token);
            const result = await operation(page);
            this.state = SLOT_STATES.IDLE;
            return result;
        }
    };
}

function createManager() {
    const calls = [];
    const registry = {
        resolveModel(modelId) {
            const [siteId, model] = modelId.split('/');
            return siteId && model ? { siteId, modelId: model } : null;
        },
        getCacheStatus: () => ({ refreshedAt: '2026-08-20T00:00:00.000Z' }),
        getModels: siteId => [{ id: `${siteId}/model` }]
    };
    const manager = new RuntimeManager({ runtime: { maxRetries: 0, requestTimeoutMs: 1000 } }, { siteRegistry: registry });
    return { manager, calls };
}

test('diagnostic probe stays on the requested profile and site', async () => {
    const { manager, calls } = createManager();
    const standard = createSlot('google-standard', 'gemini-web', calls);
    const premium = createSlot('google-premium', 'gemini-web', calls);
    manager.profiles = [
        { id: 'google-standard', config: { sites: [{ id: 'gemini-web' }] }, slots: [standard] },
        { id: 'google-premium', config: { sites: [{ id: 'gemini-web' }] }, slots: [premium] }
    ];

    const result = await manager.probe('google-premium', 'gemini-web', 'gemini-web/model', 'READY?', 1000);

    assert.equal(result.ok, true);
    assert.equal(result.slotId, premium.id);
    assert.deepEqual(calls.map(call => call.profileId), ['google-premium']);
    assert.equal(calls[0].meta.diagnostic, true);
});

test('site inspection strips query data and does not generate content', async () => {
    const { manager, calls } = createManager();
    let focused = false;
    const page = {
        url: () => 'https://aistudio.google.com/prompts/new_chat?token=sensitive#state',
        title: async () => 'Google AI Studio',
        isClosed: () => false,
        bringToFront: async () => { focused = true; },
        locator: () => ({
            evaluateAll: async () => [{ tag: 'textarea', role: 'textbox', placeholder: 'Type something', disabled: false }]
        })
    };
    const slot = createSlot('google', 'ai-studio', calls, page);
    manager.profiles = [{ id: 'google', config: { sites: [{ id: 'ai-studio' }] }, slots: [slot] }];

    const result = await manager.inspectSite('google', 'ai-studio', 1000);

    assert.equal(result.ok, true);
    assert.equal(result.page.url, 'https://aistudio.google.com/prompts/new_chat');
    assert.equal(result.page.title, 'Google AI Studio');
    assert.equal(focused, true);
    assert.deepEqual(result.page.landmarks, [{ tag: 'textarea', role: 'textbox', placeholder: 'Type something', disabled: false }]);
    assert.equal(result.models.count, 1);
    assert.equal(calls.length, 0);
});
