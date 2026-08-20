import crypto from 'crypto';
import { createCursor } from '../engine/launcher.js';
import { tryGotoWithCheck } from '../utils/page.js';
import { logger } from '../../utils/logger.js';

export const SLOT_STATES = Object.freeze({
    IDLE: 'idle',
    RESERVED: 'reserved',
    RUNNING: 'running',
    RECOVERING: 'recovering',
    OFFLINE: 'offline'
});

export class PageSlot {
    constructor(profile, siteId, index, siteRegistry, onAvailability) {
        this.profile = profile;
        this.profileId = profile.id;
        this.siteId = siteId;
        this.index = index;
        this.id = `${profile.id}:${siteId}:${index + 1}`;
        this.siteRegistry = siteRegistry;
        this.onAvailability = onAvailability;
        this.page = null;
        this.state = SLOT_STATES.OFFLINE;
        this.reservationToken = null;
        this.currentTaskId = null;
        this.failureCount = 0;
        this.lastError = null;
        this.lastUsedAt = 0;
        this.recovering = null;
    }

    async init(page) {
        this.page = page;
        this.page.authState = { isHandlingAuth: false };
        const cursorMode = this.profile.globalConfig.browser?.humanizeCursor;
        this.page._humanizeCursorMode = cursorMode;
        if (cursorMode === true) this.page.cursor = createCursor(this.page);

        for (const handler of this.siteRegistry.getNavigationHandlers(this.siteId)) {
            this.page.on('framenavigated', async () => {
                try { await handler(this.page); } catch { }
            });
        }
        this.page.once('close', () => {
            if (!this.profile.closing) this.recover().catch(() => {});
        });

        const target = this.siteRegistry.getTargetUrl(this.siteId, this.profile.globalConfig, this.profile.config);
        const result = await tryGotoWithCheck(this.page, target, { timeout: 60000 });
        if (result.error) this.lastError = result.error;
        if (this.index === 0) await this.siteRegistry.refreshModels(this.siteId, this.page).catch(() => {});
        this.state = SLOT_STATES.IDLE;
        this.onAvailability?.();
        return this;
    }

    supports(canonicalModelId) {
        return this.siteRegistry.supports(this.siteId, canonicalModelId);
    }

    tryReserve(taskId) {
        if (this.state !== SLOT_STATES.IDLE || !this.page || this.page.isClosed()) return null;
        const token = crypto.randomUUID();
        this.state = SLOT_STATES.RESERVED;
        this.reservationToken = token;
        this.currentTaskId = taskId || null;
        return token;
    }

    async execute(token, context, prompt, imagePaths, modelId, meta = {}) {
        if (token !== this.reservationToken || this.state !== SLOT_STATES.RESERVED) {
            throw new Error(`页面槽 ${this.id} 的预留令牌无效`);
        }
        this.state = SLOT_STATES.RUNNING;
        this.lastUsedAt = Date.now();
        let shouldRecover = false;
        try {
            const result = await this.siteRegistry.generate(this.siteId, {
                ...context,
                page: this.page,
                config: this.profile.globalConfig,
                proxyConfig: this.profile.config.resolvedProxy,
                userDataDir: this.profile.config.resolvedUserDataDir
            }, prompt, imagePaths, modelId, { ...meta, profile: this.profileId, slot: this.id });

            if (result?.error && result.retryable !== false) {
                this.failureCount++;
                this.lastError = result.error;
                shouldRecover = this.failureCount >= 3 || this.page.isClosed();
            } else if (!result?.error) {
                this.failureCount = 0;
                this.lastError = null;
            }
            return result;
        } catch (error) {
            this.failureCount++;
            this.lastError = error.message;
            shouldRecover = true;
            return { error: error.message, retryable: true };
        } finally {
            this.reservationToken = null;
            this.currentTaskId = null;
            if (shouldRecover) await this.recover();
            else {
                this.state = SLOT_STATES.IDLE;
                this.onAvailability?.();
            }
        }
    }

    async inspect(token, operation) {
        if (token !== this.reservationToken || this.state !== SLOT_STATES.RESERVED) {
            throw new Error(`页面槽 ${this.id} 的预留令牌无效`);
        }
        this.state = SLOT_STATES.RUNNING;
        try {
            return await operation(this.page);
        } finally {
            this.reservationToken = null;
            this.currentTaskId = null;
            this.lastUsedAt = Date.now();
            this.state = SLOT_STATES.IDLE;
            this.onAvailability?.();
        }
    }

    async recover() {
        if (this.profile.closing) return;
        if (this.recovering) return this.recovering;
        this.state = SLOT_STATES.RECOVERING;
        this.recovering = (async () => {
            try {
                if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
                const page = await this.profile.context.newPage();
                await this.init(page);
                this.failureCount = 0;
                logger.info('运行时', `[${this.id}] 页面已恢复`);
            } catch (error) {
                this.lastError = error.message;
                this.state = SLOT_STATES.OFFLINE;
                logger.error('运行时', `[${this.id}] 页面恢复失败`, { error: error.message });
            } finally {
                this.recovering = null;
                this.onAvailability?.();
            }
        })();
        return this.recovering;
    }

    snapshot() {
        return {
            id: this.id,
            profileId: this.profileId,
            siteId: this.siteId,
            index: this.index + 1,
            state: this.state,
            taskId: this.currentTaskId,
            failures: this.failureCount,
            lastError: this.lastError,
            lastUsedAt: this.lastUsedAt || null
        };
    }
}
