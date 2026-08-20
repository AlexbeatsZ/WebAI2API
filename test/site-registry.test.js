import test from 'node:test';
import assert from 'node:assert/strict';
import { SiteRegistry } from '../src/backend/sites/SiteRegistry.js';

function fakeAdapterRegistry() {
    const adapters = new Map([
        ['gemini_text', {
            id: 'gemini_text',
            models: [{ id: 'same-model', type: 'text', imagePolicy: 'optional' }],
            generate: async () => ({ text: 'ok' })
        }],
        ['gemini', {
            id: 'gemini',
            models: [{ id: 'same-model', type: 'image', imagePolicy: 'optional' }],
            generate: async () => ({ image: 'image' })
        }]
    ]);
    return {
        loadAll: async () => {},
        setAdapterConfig() {},
        hasAdapter: id => adapters.has(id),
        getAdapter: id => adapters.get(id),
        isModelEnabled: () => true
    };
}

test('site registry emits one canonical model and merges capabilities', async () => {
    const registry = new SiteRegistry({ adapterRegistry: fakeAdapterRegistry(), cachePath: 'missing-cache.json' });
    await registry.load();
    const models = registry.getModels('gemini-web');
    assert.equal(models.length, 1);
    assert.equal(models[0].id, 'gemini-web/same-model');
    assert.deepEqual(models[0].capabilities.output.sort(), ['image', 'text']);
    assert.equal(models.some(model => model.id === 'same-model'), false);
    assert.equal(registry.resolveModel('same-model'), null);
});
