import test from 'node:test';
import assert from 'node:assert/strict';
import { createGlobalRouter } from '../src/server/api/index.js';

function responseRecorder() {
    return {
        status: null,
        headers: null,
        body: '',
        writeHead(status, headers) {
            this.status = status;
            this.headers = headers;
        },
        end(body = '') {
            this.body = body;
        }
    };
}

function createContext(runtime, safeMode = false) {
    return {
        authToken: 'secret',
        config: { version: 4 },
        queueManager: {},
        tempDir: '',
        loginMode: false,
        getSafeMode: () => ({ enabled: safeMode, reason: safeMode ? 'private detail' : null }),
        getRuntimeManager: () => runtime
    };
}

test('public health reports only sanitized readiness data', async () => {
    const runtime = {
        initialized: true,
        snapshot: () => ({ capacity: { healthy: 4, idle: 3, running: 1, total: 4 } })
    };
    const route = createGlobalRouter(createContext(runtime));
    const response = responseRecorder();

    await route({ method: 'GET', url: '/health', headers: { host: 'localhost' } }, response);

    assert.equal(response.status, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.status, 'ready');
    assert.equal(body.capacity.healthy, 4);
    assert.equal('reason' in body, false);
});

test('health is degraded when runtime entered safe mode', async () => {
    const runtime = {
        initialized: true,
        snapshot: () => ({ capacity: { healthy: 4, idle: 4, running: 0, total: 4 } })
    };
    const route = createGlobalRouter(createContext(runtime, true));
    const response = responseRecorder();

    await route({ method: 'GET', url: '/health', headers: { host: 'localhost' } }, response);

    assert.equal(response.status, 503);
    assert.equal(JSON.parse(response.body).safeMode, true);
});
