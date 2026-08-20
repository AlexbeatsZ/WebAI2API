import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeManager } from '../src/backend/runtime/RuntimeManager.js';
import { PageSlot, SLOT_STATES } from '../src/backend/runtime/PageSlot.js';

function slot(manager, id, result, state = SLOT_STATES.IDLE) {
    let token = null;
    return {
        id,
        state,
        lastUsedAt: 0,
        supports: () => true,
        tryReserve(taskId) {
            if (this.state !== SLOT_STATES.IDLE) return null;
            token = `${id}:${taskId}`;
            this.state = SLOT_STATES.RESERVED;
            return token;
        },
        async execute(received) {
            assert.equal(received, token);
            this.state = SLOT_STATES.RUNNING;
            this.lastUsedAt = Date.now();
            const value = typeof result === 'function' ? result() : result;
            this.state = SLOT_STATES.IDLE;
            manager.notifyAvailability();
            return value;
        }
    };
}

test('a page slot reservation is atomic', () => {
    const pageSlot = new PageSlot({ id: 'profile' }, 'gemini-web', 0, {}, () => {});
    pageSlot.page = { isClosed: () => false };
    pageSlot.state = SLOT_STATES.IDLE;
    assert.ok(pageSlot.tryReserve('first'));
    assert.equal(pageSlot.tryReserve('second'), null);
});

test('retryable failures move to another slot', async () => {
    const manager = new RuntimeManager({ runtime: { maxRetries: 1, requestTimeoutMs: 1000 } }, { siteRegistry: { resolveModel: () => ({}) } });
    const failed = slot(manager, 'failed', { error: 'changed page', retryable: true });
    const healthy = slot(manager, 'healthy', { text: 'completed' });
    healthy.lastUsedAt = 1;
    manager.profiles = [{ slots: [failed, healthy] }];
    const result = await manager.generate({}, 'prompt', [], 'gemini-web/model', { id: 'task' });
    assert.equal(result.text, 'completed');
});

test('an offline profile does not block another profile', async () => {
    const manager = new RuntimeManager({ runtime: { maxRetries: 0, requestTimeoutMs: 1000 } }, { siteRegistry: { resolveModel: () => ({}) } });
    const offline = slot(manager, 'profile-a', { text: 'wrong' }, SLOT_STATES.OFFLINE);
    const healthy = slot(manager, 'profile-b', { text: 'isolated' });
    manager.profiles = [{ slots: [offline] }, { slots: [healthy] }];
    const result = await manager.generate({}, 'prompt', [], 'gemini-web/model', { id: 'task' });
    assert.equal(result.text, 'isolated');
});

test('least recently used idle slots share sequential work', async () => {
    const manager = new RuntimeManager({ runtime: { maxRetries: 0, requestTimeoutMs: 1000 } }, { siteRegistry: { resolveModel: () => ({}) } });
    const first = slot(manager, 'first', { text: 'first' });
    const second = slot(manager, 'second', { text: 'second' });
    manager.profiles = [{ slots: [first, second] }];
    assert.equal((await manager.generate({}, 'one', [], 'gemini-web/model', { id: 'one' })).text, 'first');
    assert.equal((await manager.generate({}, 'two', [], 'gemini-web/model', { id: 'two' })).text, 'second');
});
