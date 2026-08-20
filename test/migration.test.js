import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyConfig } from '../scripts/migrate-config.js';

test('legacy instances migrate without changing profile directories or proxies', () => {
    const result = migrateLegacyConfig({
        server: { port: 3000, auth: '' },
        browser: { proxy: { enable: false } },
        backend: {
            pool: {
                waitTimeout: 120000,
                instances: [
                    {
                        name: 'Meta',
                        userDataMark: 'Meta',
                        proxy: { enable: true, type: 'http', host: 'host.docker.internal', port: 7897 },
                        workers: [
                            { name: 'Gemini', type: 'gemini_text' },
                            { name: 'ChatGPT', type: 'chatgpt_text' }
                        ]
                    },
                    {
                        name: 'ChatGPT',
                        proxy: { enable: true, type: 'socks5', host: 'host.docker.internal', port: 7897 },
                        workers: [{ name: 'ChatGPT-1', type: 'chatgpt_text' }]
                    }
                ]
            }
        },
        queue: { queueBuffer: 2, imageLimit: 5 }
    });

    assert.equal(result.version, 4);
    assert.equal(result.browserProfiles[0].id, 'meta');
    assert.equal(result.browserProfiles[0].userDataDir, 'camoufoxUserData_Meta');
    assert.deepEqual(result.browserProfiles[0].sites, [
        { id: 'gemini-web', pages: 1 },
        { id: 'chatgpt-web', pages: 1 }
    ]);
    assert.equal(result.browserProfiles[1].userDataDir, 'camoufoxUserData');
    assert.equal(result.browserProfiles[1].proxy.type, 'socks5');
    assert.equal(result.backend.pool, undefined);
});
