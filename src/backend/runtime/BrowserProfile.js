import fs from 'fs';
import { initBrowserBase } from '../engine/launcher.js';
import { DisplaySession } from './DisplaySession.js';
import { PageSlot, SLOT_STATES } from './PageSlot.js';
import { logger } from '../../utils/logger.js';

export class BrowserProfile {
    constructor(globalConfig, config, siteRegistry, onAvailability) {
        this.globalConfig = globalConfig;
        this.config = config;
        this.id = config.id;
        this.name = config.name;
        this.siteRegistry = siteRegistry;
        this.onAvailability = onAvailability;
        this.context = null;
        this.browserHandle = null;
        this.display = null;
        this.slots = [];
        this.state = 'offline';
        this.lastError = null;
        this.closing = false;
        this.restarting = null;
        this.crashTimer = null;
    }

    async init() {
        this.closing = false;
        this.state = 'starting';
        try {
            fs.mkdirSync(this.config.resolvedUserDataDir, { recursive: true });
            this.display = new DisplaySession(this.id, {
                enabled: this.globalConfig.browser?.perProfileDisplay !== false,
                headless: this.globalConfig.browser?.headless === true
            });
            await this.display.start();

            this.browserHandle = await initBrowserBase(this.globalConfig, {
                profileId: this.id,
                userDataDir: this.config.resolvedUserDataDir,
                proxyConfig: this.config.resolvedProxy,
                virtualDisplay: this.display.display
            });
            this.context = this.browserHandle.context;
            const ownedContext = this.context;
            ownedContext.once('close', () => this.handleContextClose(ownedContext));

            const total = this.config.sites.reduce((sum, site) => sum + site.pages, 0);
            const pages = [this.browserHandle.page];
            while (pages.length < total) pages.push(await this.context.newPage());
            this.slots = [];
            let pageIndex = 0;
            for (const site of this.config.sites) {
                for (let index = 0; index < site.pages; index++) {
                    const slot = new PageSlot(this, site.id, index, this.siteRegistry, this.onAvailability);
                    this.slots.push(slot);
                    try {
                        await slot.init(pages[pageIndex++]);
                    } catch (error) {
                        slot.state = SLOT_STATES.OFFLINE;
                        slot.lastError = error.message;
                    }
                }
            }
            this.state = this.slots.some(slot => slot.state === SLOT_STATES.IDLE) ? 'online' : 'degraded';
            this.lastError = null;
            logger.info('运行时', `[${this.id}] 已启动 ${this.slots.length} 个并发页`);
            this.onAvailability?.();
            return this;
        } catch (error) {
            this.closing = true;
            this.lastError = error.message;
            this.state = 'offline';
            if (this.browserHandle) await this.browserHandle.close().catch(() => {});
            if (this.display) await this.display.stop().catch(() => {});
            this.context = null;
            this.browserHandle = null;
            this.slots = [];
            throw error;
        }
    }

    handleContextClose(closedContext) {
        // A context can emit close after an explicit restart has already installed its
        // replacement. Only the currently owned context is allowed to trigger recovery.
        if (this.context !== closedContext || this.closing || this.state === 'starting') return;
        this.state = 'offline';
        for (const slot of this.slots) slot.state = SLOT_STATES.OFFLINE;
        this.onAvailability?.();
        clearTimeout(this.crashTimer);
        this.crashTimer = setTimeout(() => {
            this.crashTimer = null;
            this.restart().catch(error => {
                this.lastError = error.message;
                logger.error('运行时', `[${this.id}] 浏览器自动恢复失败`, { error: error.message });
            });
        }, 2000);
    }

    async restart() {
        if (this.restarting) return this.restarting;
        this.restarting = (async () => {
            await this.close();
            try {
                await this.init();
            } catch (error) {
                this.state = 'offline';
                this.lastError = error.message;
                throw error;
            } finally {
                this.restarting = null;
                this.onAvailability?.();
            }
        })();
        return this.restarting;
    }

    async close() {
        this.closing = true;
        clearTimeout(this.crashTimer);
        this.crashTimer = null;
        this.state = 'stopping';
        for (const slot of this.slots) slot.state = SLOT_STATES.OFFLINE;
        if (this.browserHandle) await this.browserHandle.close().catch(() => {});
        if (this.display) await this.display.stop();
        this.context = null;
        this.browserHandle = null;
        this.slots = [];
        this.state = 'offline';
    }

    snapshot() {
        return {
            id: this.id,
            name: this.name,
            state: this.state,
            sites: this.config.sites,
            proxy: this.config.resolvedProxy ? {
                enabled: true,
                type: this.config.resolvedProxy.type,
                host: this.config.resolvedProxy.host,
                port: this.config.resolvedProxy.port
            } : { enabled: false },
            display: this.display?.info() || { enabled: false, display: '', port: 0, isolated: false },
            slots: this.slots.map(slot => slot.snapshot()),
            lastError: this.lastError
        };
    }
}
