import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrowserProfilesConfig, validateServerConfig } from '../src/config/validator.js';

test('browser profiles cannot share one login directory', () => {
    const result = validateBrowserProfilesConfig([
        { id: 'one', userDataDir: 'Profile', sites: [{ id: 'gemini-web', pages: 1 }] },
        { id: 'two', userDataDir: 'profile', sites: [{ id: 'ai-studio', pages: 1 }] }
    ]);
    assert.equal(result.valid, false);
    assert.match(result.errors.join('\n'), /不能与其他浏览器配置共享/);
});

test('runtime limits submitted by the console are bounded', () => {
    const result = validateServerConfig({ requestTimeoutMs: 999, maxRetries: 11 });
    assert.equal(result.valid, false);
    assert.equal(result.errors.length, 2);
});
