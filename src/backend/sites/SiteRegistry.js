import fs from 'fs';
import path from 'path';
import { registry as adapterRegistry } from '../registry.js';
import { logger } from '../../utils/logger.js';
import { SITE_CATALOG, getSiteDefinition } from './catalog.js';

function outputType(model) {
    if (Array.isArray(model.capabilities?.output)) return model.capabilities.output;
    if (model.type === 'video') return ['video'];
    if (model.type === 'text') return ['text'];
    return ['image'];
}

function inputType(model) {
    if (Array.isArray(model.capabilities?.input)) return model.capabilities.input;
    return model.imagePolicy === 'forbidden' ? ['text'] : ['text', 'image'];
}

function mergeUnique(a = [], b = []) {
    return [...new Set([...a, ...b])];
}

function canonicalModel(siteId, model, adapterId) {
    return {
        id: `${siteId}/${model.id}`,
        modelId: model.id,
        label: model.label || model.codeName || model.id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: siteId,
        adapterId,
        image_policy: model.imagePolicy || 'optional',
        capabilities: {
            input: inputType(model),
            output: outputType(model),
            reasoning: model.capabilities?.reasoning ?? /thinking|reasoning|\bpro\b/i.test(model.id)
        },
        availability: model.availability || 'unknown'
    };
}

export class SiteRegistry {
    constructor(options = {}) {
        this.adapterRegistry = options.adapterRegistry || adapterRegistry;
        this.cachePath = options.cachePath || path.join(process.cwd(), 'data', 'model-cache.json');
        this.cache = {};
        this.loaded = false;
    }

    async load(adapterConfig = {}) {
        if (this.loaded) return;
        await this.adapterRegistry.loadAll();
        this.adapterRegistry.setAdapterConfig(adapterConfig);
        try {
            if (fs.existsSync(this.cachePath)) this.cache = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        } catch (error) {
            logger.warn('站点', `模型缓存无法读取: ${error.message}`);
            this.cache = {};
        }
        this.loaded = true;
    }

    getSites() {
        return Object.entries(SITE_CATALOG).map(([id, definition]) => ({
            id,
            name: definition.name,
            available: definition.adapters.some(adapterId => this.adapterRegistry.hasAdapter(adapterId)),
            models: this.getModels(id).length
        }));
    }

    getAdapters(siteId) {
        const definition = getSiteDefinition(siteId);
        if (!definition) return [];
        return definition.adapters
            .map(id => ({ id, manifest: this.adapterRegistry.getAdapter(id) }))
            .filter(item => item.manifest);
    }

    getModels(siteId) {
        const merged = new Map();
        for (const { id: adapterId, manifest } of this.getAdapters(siteId)) {
            for (const model of manifest.models || []) {
                if (!this.adapterRegistry.isModelEnabled(adapterId, model.id)) continue;
                const next = canonicalModel(siteId, model, adapterId);
                const previous = merged.get(model.id);
                if (!previous) {
                    merged.set(model.id, next);
                } else {
                    previous.capabilities.input = mergeUnique(previous.capabilities.input, next.capabilities.input);
                    previous.capabilities.output = mergeUnique(previous.capabilities.output, next.capabilities.output);
                    previous.capabilities.reasoning ||= next.capabilities.reasoning;
                }
            }
        }

        const cached = this.cache[siteId]?.models || [];
        for (const model of cached) {
            const discovered = canonicalModel(siteId, { ...model, availability: 'available' }, model.adapterId || this.getAdapters(siteId)[0]?.id);
            const previous = merged.get(model.id);
            if (!previous) {
                merged.set(model.id, discovered);
            } else {
                previous.label = discovered.label;
                previous.availability = 'available';
                previous.capabilities.input = mergeUnique(previous.capabilities.input, discovered.capabilities.input);
                previous.capabilities.output = mergeUnique(previous.capabilities.output, discovered.capabilities.output);
                previous.capabilities.reasoning ||= discovered.capabilities.reasoning;
            }
        }
        return [...merged.values()].map(({ adapterId, modelId, ...publicModel }) => publicModel);
    }

    parseCanonicalId(canonicalId) {
        if (typeof canonicalId !== 'string') return null;
        const slash = canonicalId.indexOf('/');
        if (slash <= 0 || slash === canonicalId.length - 1 || canonicalId.indexOf('/', slash + 1) !== -1) return null;
        return { siteId: canonicalId.slice(0, slash), modelId: canonicalId.slice(slash + 1) };
    }

    resolveModel(canonicalId) {
        const parsed = this.parseCanonicalId(canonicalId);
        if (!parsed || !getSiteDefinition(parsed.siteId)) return null;
        for (const { id: adapterId, manifest } of this.getAdapters(parsed.siteId)) {
            const model = (manifest.models || []).find(item => item.id === parsed.modelId);
            if (model && this.adapterRegistry.isModelEnabled(adapterId, model.id)) {
                return { ...parsed, adapterId, manifest, model };
            }
        }
        const cached = (this.cache[parsed.siteId]?.models || []).find(item => item.id === parsed.modelId);
        if (cached) {
            const adapter = this.getAdapters(parsed.siteId).find(item => item.id === cached.adapterId) || this.getAdapters(parsed.siteId)[0];
            if (adapter) return { ...parsed, adapterId: adapter.id, manifest: adapter.manifest, model: cached };
        }
        return null;
    }

    supports(siteId, canonicalId) {
        const parsed = this.parseCanonicalId(canonicalId);
        return parsed?.siteId === siteId && Boolean(this.resolveModel(canonicalId));
    }

    getTargetUrl(siteId, config, profileConfig) {
        const adapter = this.getAdapters(siteId)[0];
        if (!adapter) return 'about:blank';
        return typeof adapter.manifest.getTargetUrl === 'function'
            ? adapter.manifest.getTargetUrl(config, profileConfig)
            : adapter.manifest.targetUrl || 'about:blank';
    }

    getNavigationHandlers(siteId) {
        return this.getAdapters(siteId).flatMap(({ manifest }) => manifest.navigationHandlers || []);
    }

    async generate(siteId, context, prompt, imagePaths, canonicalId, meta = {}) {
        const resolved = this.resolveModel(canonicalId);
        if (!resolved || resolved.siteId !== siteId) {
            return { error: `模型不可用: ${canonicalId}`, code: 'model_unavailable', retryable: false };
        }
        return resolved.manifest.generate(context, prompt, imagePaths, resolved.modelId, {
            ...meta,
            site: siteId,
            adapter: resolved.adapterId,
            model: resolved.modelId,
            modelLabel: resolved.model.label || resolved.model.codeName || resolved.modelId
        });
    }

    async refreshModels(siteId, page) {
        const discovered = [];
        for (const { id: adapterId, manifest } of this.getAdapters(siteId)) {
            if (typeof manifest.discoverModels !== 'function') continue;
            try {
                const models = await manifest.discoverModels(page);
                for (const model of models || []) discovered.push({ ...model, adapterId });
            } catch (error) {
                logger.debug('站点', `[${siteId}] 模型发现失败: ${error.message}`);
            }
        }
        if (discovered.length === 0) return this.getModels(siteId);
        this.cache[siteId] = { refreshedAt: new Date().toISOString(), models: discovered };
        fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
        fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
        return this.getModels(siteId);
    }

    getCacheStatus(siteId) {
        return this.cache[siteId] || { refreshedAt: null, models: [] };
    }
}

export const siteRegistry = new SiteRegistry();
