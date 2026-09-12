import fs from 'fs';
import path from 'path';
import { sleep } from '../engine/utils.js';
import { gotoWithCheck } from '../utils/index.js';
import { logger } from '../../utils/logger.js';

const PROJECT_PATH = /^\/g\/g-p-[^/]+(?:\/project|\/c\/[^/]+)?\/?$/;
const ACTIVE_CHAT_PATH = /^\/g\/g-p-[^/]+\/c\/[^/]+\/?$/;
const SOURCE_MARKER = 'source-message';

function configFor(config) {
    const value = config?.backend?.adapter?.chatgpt_text || {};
    return {
        projectUrl: String(value.projectUrl || '').trim(),
        mcpAppName: String(value.mcpAppName || '').trim(),
        requireMcpApp: value.requireMcpApp !== false,
        conversationRolloverMode: value.conversationRolloverMode || 'run_count',
        maxRunsPerChat: value.maxRunsPerChat ?? 80,
        timezone: value.timezone || 'Asia/Shanghai',
        logicalDayStartsAtHour: value.logicalDayStartsAtHour ?? 4,
        recoveryGraceMs: value.recoveryGraceMs ?? 15000,
        stateFile: value.stateFile || path.join(process.cwd(), 'data', 'chatgpt-project-state.json')
    };
}

export function normalizeProjectUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com') {
        throw new Error('ChatGPT Project URL must use https://chatgpt.com');
    }
    const match = url.pathname.match(/^(\/g\/g-p-[^/]+)/);
    if (!match) throw new Error(`Unexpected ChatGPT Project URL: ${value}`);
    url.pathname = `${match[1]}/project`;
    url.search = '';
    url.hash = '';
    return url.toString();
}

export function isProjectConversationUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:'
            && url.hostname === 'chatgpt.com'
            && ACTIVE_CHAT_PATH.test(url.pathname);
    } catch {
        return false;
    }
}

export function logicalDay(now, timezone, startsAtHour) {
    const shifted = new Date(now.getTime() - startsAtHour * 60 * 60 * 1000);
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(shifted);
}

export function rolloverReason(state, options, day) {
    if (!state?.activeUrl) return 'missing';
    if (state.forceNew === true) return state.rollReason || 'manual';
    if (options.conversationRolloverMode === 'run_count'
        && state.runCount >= options.maxRunsPerChat) return 'run_count';
    if (options.conversationRolloverMode === 'fixed_time'
        && state.logicalDay !== day) return 'fixed_time';
    return null;
}

export function composeProjectPrompt(sourceMessageId, latestUserPrompt) {
    return [
        `[${SOURCE_MARKER}:${sourceMessageId}]`,
        'Process this OpenClaw inbound turn with the AI Decision MCP app selected for this message.',
        'Follow the Project instructions: begin/read/commit the authoritative Decision, put the exact user-visible reply only in commit_decision.user_message, then return NO_REPLY only.',
        '',
        latestUserPrompt
    ].join('\n');
}

export function readTranscript() {
    const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
    return nodes.map((node, index) => {
        const role = node.getAttribute('data-message-author-role');
        const preferred = node.querySelector('.markdown, .prose, [data-message-content-part]');
        const text = String((preferred || node).innerText || (preferred || node).textContent || '').trim();
        const id = node.getAttribute('data-message-id') || node.id || `${role}:${index}`;
        return { id, role, text };
    }).filter(item => item.text && (item.role === 'user' || item.role === 'assistant'));
}

export async function dismissWorkspaceLimitNotice(page, meta = {}) {
    const pattern = /workspace.*member.*limit|member.*limit.*workspace|工作区.*成员.*上限|工作區.*成員.*上限/i;
    const notice = page.getByText(pattern, { exact: false }).first();
    if (!await notice.isVisible().catch(() => false)) return false;
    const container = notice.locator('xpath=ancestor::*[self::div or self::section][.//button][1]');
    const close = container.getByRole('button', { name: /close|dismiss|关闭|關閉/i }).first();
    if (await close.isVisible().catch(() => false)) {
        await close.click().catch(() => {});
        logger.info('适配器', '已关闭 ChatGPT 工作区成员上限提示', meta);
        return true;
    }
    const hidden = await notice.evaluate((node) => {
        let current = node;
        while (current && current !== document.body) {
            const text = String(current.innerText || current.textContent || '');
            if (current.querySelector?.('button')
                && /workspace.*member.*limit|member.*limit.*workspace|工作区.*成员.*上限|工作區.*成員.*上限/i.test(text)) {
                current.style.setProperty('display', 'none', 'important');
                current.dataset.webaiHidden = 'workspace-member-limit';
                return true;
            }
            current = current.parentElement;
        }
        return false;
    }).catch(() => false);
    if (hidden) logger.info('适配器', '已在当前页面隐藏 ChatGPT 工作区成员上限提示', meta);
    return hidden;
}

export class ChatGptProjectConversation {
    constructor(page, config, meta = {}) {
        this.page = page;
        this.options = configFor(config);
        this.profileId = meta.profile || 'default';
        this.meta = meta;
        this.stateFile = this.options.stateFile;
        this.projectUrl = normalizeProjectUrl(this.options.projectUrl);
    }

    async prepare(sourceMessageId) {
        const state = readProfileState(this.stateFile, this.profileId);
        const day = logicalDay(new Date(), this.options.timezone, this.options.logicalDayStartsAtHour);
        const reason = rolloverReason(state, this.options, day);
        const duplicate = state.pendingSourceMessageId === sourceMessageId
            || state.lastSourceMessageId === sourceMessageId;

        if (duplicate && isProjectConversationUrl(state.activeUrl)) {
            await this.goto(state.activeUrl);
            const recovered = await this.recover(sourceMessageId, this.options.recoveryGraceMs);
            if (recovered.status === 'complete') {
                await this.complete(sourceMessageId, recovered.text);
                return { recovered: recovered.text };
            }
            if (recovered.status === 'pending') {
                return { error: 'ChatGPT Project submission is still pending', retryable: true };
            }
        }

        const target = reason || !isProjectConversationUrl(state.activeUrl)
            ? this.projectUrl
            : state.activeUrl;
        await this.goto(target);
        await this.waitForComposer();
        const nextState = reason ? {
            activeUrl: this.projectUrl,
            runCount: 0,
            logicalDay: day,
            lastSourceMessageId: null,
            lastAssistantText: null,
            forceNew: false,
            rollReason: reason
        } : { ...state, logicalDay: state.logicalDay || day };
        writeProfileState(this.stateFile, this.profileId, {
            ...nextState,
            pendingSourceMessageId: sourceMessageId,
            pendingMarker: `[${SOURCE_MARKER}:${sourceMessageId}]`,
            pendingAt: new Date().toISOString()
        });
        return { state: nextState, day };
    }

    async attachMcpApp(input) {
        if (!this.options.mcpAppName) return false;
        await input.click();
        await this.page.keyboard.insertText(`@${this.options.mcpAppName}`);
        await sleep(500, 800);
        const escaped = this.options.mcpAppName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const exact = new RegExp(`^${escaped}$`, 'i');
        const candidates = [
            this.page.getByRole('option', { name: exact }),
            this.page.getByRole('menuitem', { name: exact }),
            this.page.getByRole('button', { name: exact }),
            this.page.locator('[role="option"], [role="menuitem"]').filter({ hasText: this.options.mcpAppName })
        ];
        for (const candidate of candidates) {
            const target = candidate.first();
            if (await target.isVisible().catch(() => false)) {
                await target.click();
                await sleep(250, 450);
                return true;
            }
        }
        await this.page.keyboard.press('Control+A').catch(() => {});
        await this.page.keyboard.press('Backspace').catch(() => {});
        if (this.options.requireMcpApp) {
            throw new Error(`ChatGPT MCP app is unavailable in the composer: ${this.options.mcpAppName}`);
        }
        logger.warn('适配器', `未能选择 MCP app: ${this.options.mcpAppName}`, this.meta);
        return false;
    }

    async markSubmitted(sourceMessageId) {
        await this.page.waitForURL(url => {
            try { return isProjectConversationUrl(url.toString()); } catch { return false; }
        }, { timeout: 15000 }).catch(() => {});
        const activeUrl = this.page.url();
        const state = readProfileState(this.stateFile, this.profileId);
        writeProfileState(this.stateFile, this.profileId, {
            ...state,
            activeUrl: isProjectConversationUrl(activeUrl) ? activeUrl : state.activeUrl,
            pendingSourceMessageId: sourceMessageId
        });
    }

    async complete(sourceMessageId, assistantText) {
        const state = readProfileState(this.stateFile, this.profileId);
        const pageUrl = this.page.url();
        const observation = await this.observeMcpOutcome();
        const alreadyCompleted = state.lastSourceMessageId === sourceMessageId;
        writeProfileState(this.stateFile, this.profileId, {
            ...state,
            activeUrl: isProjectConversationUrl(pageUrl) ? pageUrl : state.activeUrl,
            runCount: (state.runCount || 0) + (alreadyCompleted ? 0 : 1),
            lastSourceMessageId: sourceMessageId,
            lastAssistantText: assistantText,
            pendingSourceMessageId: null,
            pendingMarker: null,
            pendingAt: null,
            lastMcpAcceptedObserved: observation.accepted,
            lastMcpObservation: observation.text,
            lastCompletedAt: new Date().toISOString()
        });
        return observation;
    }

    async recover(sourceMessageId, timeoutMs) {
        const marker = `[${SOURCE_MARKER}:${sourceMessageId}]`;
        const startedAt = Date.now();
        let markerSeen = false;
        let last = '';
        let stable = 0;
        while (Date.now() - startedAt < timeoutMs) {
            const transcript = await this.page.evaluate(readTranscript).catch(() => []);
            let foundUser = false;
            let assistant = '';
            for (const message of transcript) {
                if (message.role === 'user' && message.text.includes(marker)) {
                    foundUser = true;
                    markerSeen = true;
                    assistant = '';
                } else if (foundUser && message.role === 'assistant') {
                    assistant = message.text;
                }
            }
            const generating = await this.isGenerating();
            if (assistant && assistant === last && !generating) stable += 1;
            else {
                last = assistant;
                stable = 0;
            }
            if (last && stable >= 2) return { status: 'complete', text: last };
            await sleep(450, 650);
        }
        return markerSeen ? { status: 'pending' } : { status: 'absent' };
    }

    async observeMcpOutcome() {
        const text = await this.page.locator('body').innerText().catch(() => '');
        const accepted = /BrainRun\s+[`“"]?run:[^\s`”"]+[`”"]?\s+accepted\./i.test(text)
            || /User deliveries queued:\s*[01]\./i.test(text);
        const match = text.match(/BrainRun\s+[`“"]?run:[^\n]{0,180}accepted\.|User deliveries queued:\s*[01]\./i);
        return { accepted, text: match?.[0] || null };
    }

    async goto(url) {
        if (this.page.url() !== url) await gotoWithCheck(this.page, url);
        await dismissWorkspaceLimitNotice(this.page, this.meta);
    }

    async waitForComposer(timeout = 60000) {
        const input = this.page.locator('.ProseMirror[contenteditable="true"], .ProseMirror').last();
        const immediatelyReady = await input.isVisible().catch(() => false);
        if (!immediatelyReady && this.page.url().includes('/project')) {
            const main = this.page.locator('main');
            const candidates = [
                main.getByRole('button', { name: /start.*chat|new chat|开始.*聊天|新建.*对话/i }),
                main.getByRole('link', { name: /start.*chat|new chat|开始.*聊天|新建.*对话/i }),
                main.getByText(/start.*chat|开始.*聊天/i, { exact: false })
            ];
            for (const candidate of candidates) {
                const target = candidate.first();
                if (await target.isVisible().catch(() => false)) {
                    await target.click();
                    break;
                }
            }
        }
        await input.waitFor({ state: 'visible', timeout });
        return input;
    }

    async isGenerating() {
        return this.page.evaluate(() => {
            const text = document.body?.innerText || '';
            if (/Thinking\.\.\.|Thinking…|正在思考|思考中/.test(text)) return true;
            return Array.from(document.querySelectorAll('button')).some(button => {
                const label = `${button.getAttribute('aria-label') || ''} ${button.innerText || button.textContent || ''}`;
                return /stop generating|stop streaming|停止生成|停止回答|cancel/i.test(label);
            });
        }).catch(() => false);
    }
}

export function rollProjectConversation(config, profileId, reason = 'external') {
    const options = configFor(config);
    const state = readProfileState(options.stateFile, profileId);
    const next = {
        ...state,
        forceNew: true,
        rollReason: String(reason || 'external').trim().slice(0, 120) || 'external'
    };
    writeProfileState(options.stateFile, profileId, next);
    return publicState(next);
}

export function getProjectConversationState(config, profileId) {
    return publicState(readProfileState(configFor(config).stateFile, profileId));
}

function readState(file) {
    try {
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value?.version === 1 && value.profiles ? value : { version: 1, profiles: {} };
    } catch {
        return { version: 1, profiles: {} };
    }
}

function readProfileState(file, profileId) {
    return readState(file).profiles[profileId] || {
        activeUrl: null,
        runCount: 0,
        logicalDay: null,
        forceNew: false,
        rollReason: null
    };
}

function writeProfileState(file, profileId, state) {
    const value = readState(file);
    value.profiles[profileId] = state;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, file);
}

function publicState(state) {
    return {
        activeUrl: state.activeUrl || null,
        runCount: state.runCount || 0,
        logicalDay: state.logicalDay || null,
        pendingSourceMessageId: state.pendingSourceMessageId || null,
        lastSourceMessageId: state.lastSourceMessageId || null,
        lastMcpAcceptedObserved: state.lastMcpAcceptedObserved === true,
        lastCompletedAt: state.lastCompletedAt || null,
        forceNew: state.forceNew === true,
        rollReason: state.rollReason || null
    };
}

export function validateChatgptProjectConfig(raw) {
    const errors = [];
    if (!raw?.projectUrl) return errors;
    try {
        const url = new URL(raw.projectUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'chatgpt.com' || !PROJECT_PATH.test(url.pathname)) {
            errors.push('backend.adapter.chatgpt_text.projectUrl 必须是 ChatGPT Project URL');
        }
    } catch {
        errors.push('backend.adapter.chatgpt_text.projectUrl 必须是有效 URL');
    }
    if (!['run_count', 'fixed_time', 'manual'].includes(raw.conversationRolloverMode || 'run_count')) {
        errors.push('backend.adapter.chatgpt_text.conversationRolloverMode 必须是 run_count、fixed_time 或 manual');
    }
    const maxRuns = raw.maxRunsPerChat ?? 80;
    if (!Number.isInteger(maxRuns) || maxRuns < 1) {
        errors.push('backend.adapter.chatgpt_text.maxRunsPerChat 必须是正整数');
    }
    const hour = raw.logicalDayStartsAtHour ?? 4;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
        errors.push('backend.adapter.chatgpt_text.logicalDayStartsAtHour 必须是 0-23 的整数');
    }
    try {
        new Intl.DateTimeFormat('en-CA', { timeZone: raw.timezone || 'Asia/Shanghai' }).format(new Date());
    } catch {
        errors.push('backend.adapter.chatgpt_text.timezone 无效');
    }
    if (raw.requireMcpApp !== false && !String(raw.mcpAppName || '').trim()) {
        errors.push('backend.adapter.chatgpt_text.mcpAppName 在 Project 模式下不能为空');
    }
    return errors;
}
