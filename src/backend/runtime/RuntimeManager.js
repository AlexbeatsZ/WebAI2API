import { BrowserProfile } from './BrowserProfile.js';
import { SLOT_STATES } from './PageSlot.js';
import { siteRegistry } from '../sites/SiteRegistry.js';
import { logger } from '../../utils/logger.js';

export class RuntimeManager {
    constructor(config, options = {}) {
        this.config = config;
        this.siteRegistry = options.siteRegistry || siteRegistry;
        this.profiles = [];
        this.initialized = false;
        this.waiters = new Set();
    }

    notifyAvailability = () => {
        for (const resolve of this.waiters) resolve();
        this.waiters.clear();
    };

    async initAll() {
        if (this.initialized) return;
        await this.siteRegistry.load(this.config.backend?.adapter || {});
        const loginArg = process.argv.find(arg => arg.startsWith('-login='));
        const loginProfileId = loginArg?.split('=')[1] || null;
        const configs = loginProfileId
            ? this.config.browserProfiles.filter(profile => profile.id === loginProfileId)
            : this.config.browserProfiles;
        if (loginProfileId && configs.length === 0) throw new Error(`找不到浏览器配置: ${loginProfileId}`);

        for (const profileConfig of configs) {
            const profile = new BrowserProfile(this.config, profileConfig, this.siteRegistry, this.notifyAvailability);
            this.profiles.push(profile);
            try {
                await profile.init();
            } catch (error) {
                profile.state = 'offline';
                profile.lastError = error.message;
                logger.error('运行时', `[${profile.id}] 启动失败`, { error: error.message });
            }
        }
        if (!this.profiles.some(profile => profile.slots.length > 0)) throw new Error('没有浏览器配置成功启动');
        this.initialized = true;
    }

    get slots() {
        return this.profiles.flatMap(profile => profile.slots);
    }

    async waitForAvailability(remainingMs) {
        await new Promise(resolve => {
            const timer = setTimeout(() => {
                this.waiters.delete(done);
                resolve();
            }, Math.max(1, remainingMs));
            const done = () => {
                clearTimeout(timer);
                this.waiters.delete(done);
                resolve();
            };
            this.waiters.add(done);
        });
    }

    async acquire(modelId, taskId, excluded, deadline) {
        while (Date.now() < deadline) {
            const compatible = this.slots.filter(slot => slot.supports(modelId) && !excluded.has(slot.id));
            if (compatible.length === 0) return null;
            const idle = compatible
                .filter(slot => slot.state === SLOT_STATES.IDLE)
                .sort((a, b) => a.lastUsedAt - b.lastUsedAt);
            for (const slot of idle) {
                const token = slot.tryReserve(taskId);
                if (token) return { slot, token };
            }
            await this.waitForAvailability(deadline - Date.now());
        }
        return null;
    }

    async generate(ctx, prompt, paths, modelId, meta = {}) {
        if (!this.siteRegistry.resolveModel(modelId)) {
            return { error: `模型不可用: ${modelId}`, code: 'model_unavailable', retryable: false };
        }
        const maxAttempts = Math.max(1, Math.min(this.config.runtime.maxRetries + 1, this.slots.filter(slot => slot.supports(modelId)).length));
        const excluded = new Set();
        const deadline = Date.now() + this.config.runtime.requestTimeoutMs;
        let lastResult = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const reservation = await this.acquire(modelId, meta.id, excluded, deadline);
            if (!reservation) break;
            const { slot, token } = reservation;
            const result = await slot.execute(token, ctx, prompt, paths, modelId, {
                ...meta,
                requestTimeoutMs: Math.max(1000, deadline - Date.now())
            });
            if (!result?.error) return result;
            lastResult = result;
            if (result.retryable === false) return result;
            excluded.add(slot.id);
        }
        return lastResult || { error: `没有可用页面可处理 ${modelId}`, code: 'site_capacity_unavailable', retryable: true };
    }

    getModels() {
        const siteIds = new Set(this.config.browserProfiles.flatMap(profile => profile.sites.map(site => site.id)));
        const data = [...siteIds].flatMap(siteId => this.siteRegistry.getModels(siteId));
        return { object: 'list', data: [...new Map(data.map(model => [model.id, model])).values()] };
    }

    getImagePolicy(modelId) {
        const model = this.getModels().data.find(item => item.id === modelId);
        return model?.image_policy || 'optional';
    }

    getModelType() {
        return 'conversation';
    }

    async getCookies(profileId, domain) {
        const profile = profileId ? this.profiles.find(item => item.id === profileId) : this.profiles[0];
        if (!profile?.context) throw new Error(`浏览器配置不存在或未运行: ${profileId || ''}`);
        const cookies = await profile.context.cookies(domain ? [domain] : undefined);
        return { profile: profile.id, cookies };
    }

    snapshot() {
        const profiles = this.profiles.map(profile => profile.snapshot());
        const slots = profiles.flatMap(profile => profile.slots);
        return {
            profiles,
            slots,
            capacity: {
                healthy: slots.filter(slot => slot.state !== SLOT_STATES.OFFLINE).length,
                idle: slots.filter(slot => slot.state === SLOT_STATES.IDLE).length,
                running: slots.filter(slot => slot.state === SLOT_STATES.RUNNING || slot.state === SLOT_STATES.RESERVED).length,
                total: slots.length
            }
        };
    }

    async restartProfile(profileId) {
        const profile = this.profiles.find(item => item.id === profileId);
        if (!profile) throw new Error(`浏览器配置不存在: ${profileId}`);
        await profile.restart();
        return profile.snapshot();
    }

    getVncInfo(profileId) {
        const profile = this.profiles.find(item => item.id === profileId);
        return profile?.display?.info() || null;
    }

    async refreshModels(siteId) {
        for (const slot of this.slots.filter(item => item.siteId === siteId)) {
            const token = slot.tryReserve(`model-refresh:${siteId}`);
            if (token) return slot.inspect(token, page => this.siteRegistry.refreshModels(siteId, page));
        }
        throw new Error(`网站当前没有空闲页面: ${siteId}`);
    }

    getSites() {
        return this.siteRegistry.getSites().map(site => ({ ...site, cache: this.siteRegistry.getCacheStatus(site.id) }));
    }

    async close() {
        await Promise.all(this.profiles.map(profile => profile.close()));
        this.initialized = false;
    }
}
