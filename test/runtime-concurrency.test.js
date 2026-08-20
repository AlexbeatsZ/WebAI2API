import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeManager } from '../src/backend/runtime/RuntimeManager.js';
import { SLOT_STATES } from '../src/backend/runtime/PageSlot.js';

function fakeSlot(id, active) {
    let token = null;
    return {
        id,
        state: SLOT_STATES.IDLE,
        lastUsedAt: 0,
        supports: () => true,
        tryReserve() {
            if (this.state !== SLOT_STATES.IDLE) return null;
            token = `${id}-token`;
            this.state = SLOT_STATES.RESERVED;
            return token;
        },
        async execute(received) {
            assert.equal(received, token);
            this.state = SLOT_STATES.RUNNING;
            active.add(id);
            assert.equal(active.size <= 4, true);
            await new Promise(resolve => setTimeout(resolve, 15));
            active.delete(id);
            this.state = SLOT_STATES.IDLE;
            manager.notifyAvailability();
            return { text: id };
        }
    };
}

let manager;
test('four simultaneous requests reserve four independent page slots', async () => {
    const active = new Set();
    manager = new RuntimeManager({ runtime: { maxRetries: 0, requestTimeoutMs: 1000 } }, {
        siteRegistry: { resolveModel: () => ({}) }
    });
    const slots = Array.from({ length: 4 }, (_, index) => fakeSlot(`slot-${index + 1}`, active));
    manager.profiles = [{ slots }];
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) =>
        manager.generate({}, `prompt-${index}`, [], 'gemini-web/model', { id: `task-${index}` })
    ));
    assert.deepEqual(new Set(results.map(result => result.text)).size, 4);
});
