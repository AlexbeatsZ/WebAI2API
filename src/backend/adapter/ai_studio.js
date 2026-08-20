/** Google AI Studio Chat Playground driver. */

import crypto from 'crypto';
import { logger } from '../../utils/logger.js';
import { sleep, uploadFilesViaChooser } from '../engine/utils.js';
import { normalizePageError, gotoWithCheck } from '../utils/index.js';

const TARGET_URL = 'https://aistudio.google.com/prompts/new_chat';

export function normalizeModelLabel(label) {
    const clean = String(label || '').replace(/\s+/g, ' ').trim();
    if (!clean) return null;
    const version = clean.match(/Gemini\s+([0-9]+(?:\.[0-9]+)*)\s+(Pro|Flash(?:-Lite)?)/i);
    if (!version) {
        const slug = clean.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 40) || 'model';
        const hash = crypto.createHash('sha1').update(clean.toLowerCase()).digest('hex').slice(0, 8);
        return {
            id: `ui-${slug}-${hash}`,
            label: clean,
            imagePolicy: 'optional',
            type: 'text',
            capabilities: { input: ['text', 'image'], output: ['text'], reasoning: /pro|thinking|reasoning/i.test(clean) }
        };
    }
    return {
        id: `gemini-${version[1]}-${version[2].toLowerCase()}`,
        label: clean,
        codeName: `${version[1]} ${version[2]}`,
        imagePolicy: 'optional',
        type: 'text',
        capabilities: { input: ['text', 'image'], output: ['text'], reasoning: /pro|thinking/i.test(clean) }
    };
}

async function firstVisible(locators) {
    for (const locator of locators) {
        if (await locator.count().catch(() => 0) && await locator.first().isVisible().catch(() => false)) return locator.first();
    }
    return null;
}

export async function detectBlockedState(page) {
    if (/ai\.google\.dev\/gemini-api\/docs\/available-regions/i.test(page.url())) {
        return { error: 'AI Studio 在当前网络出口不可用', code: 'region_unavailable' };
    }
    const body = await page.locator('body').innerText().catch(() => '');
    if (/sign in|登录/i.test(body) && /Google AI Studio|AI Studio/i.test(body)) return { error: '需要登录 AI Studio', code: 'authentication_required' };
    if (/captcha|unusual traffic|verify you are human|验证码/i.test(body)) return { error: '页面需要人工验证', code: 'captcha_required' };
    if (/terms of service|accept.*terms|服务条款/i.test(body)) return { error: '需要接受 AI Studio 使用条款', code: 'terms_required' };
    if (/rate limit|too many requests|quota|配额|请求过多/i.test(body)) return { error: 'AI Studio 当前受到限流', code: 'rate_limited' };
    return null;
}

async function findPromptInput(page) {
    return firstVisible([
        page.getByRole('textbox', { name: /Type something|prompt|message/i }),
        page.locator('textarea[placeholder*="Type something" i]'),
        page.locator('[contenteditable="true"][role="textbox"]'),
        page.getByRole('textbox').last()
    ]);
}

async function selectModel(page, modelId, meta) {
    const config = manifest.models.find(model => model.id === modelId);
    const button = await firstVisible([
        page.getByRole('button', { name: /model/i }),
        page.locator('[data-testid*="model" i]'),
        page.locator('button').filter({ hasText: /Gemini\s+[0-9]/i })
    ]);
    if (!button) return { error: '找不到 AI Studio 模型选择器', code: 'model_unavailable', retryable: false };
    await button.click({ timeout: 5000 });
    const options = page.getByRole('option').or(page.getByRole('menuitem')).or(page.getByRole('radio'));
    const expected = meta.modelLabel || config?.codeName || modelId.replace(/^gemini-/, '').replaceAll('-', ' ');
    const target = options.filter({ hasText: new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first();
    if (!await target.count().catch(() => 0)) {
        await page.keyboard.press('Escape').catch(() => {});
        return { error: `AI Studio 中没有可用模型: ${modelId}`, code: 'model_unavailable', retryable: false };
    }
    await target.click({ timeout: 5000 });
    logger.info('AI Studio', `已选择模型 ${modelId}`, meta);
    return null;
}

async function setSystemInstruction(page, instruction) {
    if (!instruction) return;
    const settings = await firstVisible([
        page.getByRole('button', { name: /Run settings|settings/i }),
        page.locator('[aria-label*="Run settings" i]')
    ]);
    if (!settings) throw new Error('找不到 Run settings');
    await settings.click();
    const input = await firstVisible([
        page.getByRole('textbox', { name: /System instructions?/i }),
        page.locator('textarea').filter({ has: page.locator('xpath=ancestor::*[contains(., "System Instructions")]') }),
        page.locator('textarea').first()
    ]);
    if (!input) throw new Error('找不到 System Instructions 输入框');
    await input.fill(instruction);
    await page.keyboard.press('Escape').catch(() => {});
}

function collectText(value, output = []) {
    if (typeof value === 'string') {
        if (value.length > 1 && !value.startsWith('http')) output.push(value);
    } else if (Array.isArray(value)) {
        for (const item of value) collectText(item, output);
    } else if (value && typeof value === 'object') {
        for (const item of Object.values(value)) collectText(item, output);
    }
    return output;
}

async function extractNetworkText(response) {
    if (!response) return '';
    try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json')) {
            const values = collectText(await response.json()).filter(text => text.length > 8);
            return values.sort((a, b) => b.length - a.length)[0] || '';
        }
    } catch { }
    return '';
}

async function extractStableDomText(page, timeout) {
    const candidates = page.locator([
        '[data-message-author-role="model"]',
        '[data-role="model"]',
        'ms-chat-turn[role="model"]',
        '.response-container',
        '.model-prompt-container'
    ].join(','));
    const started = Date.now();
    let last = '';
    let stable = 0;
    while (Date.now() - started < timeout) {
        const count = await candidates.count().catch(() => 0);
        const current = count ? (await candidates.nth(count - 1).innerText().catch(() => '')).trim() : '';
        const body = await page.locator('body').innerText().catch(() => '');
        const generating = /Stop|Cancel|停止生成/i.test(body);
        if (current && current === last && !generating) stable++; else stable = 0;
        if (stable >= 3) return current;
        if (current) last = current;
        await sleep(700, 1000);
    }
    return last;
}

async function generate(context, prompt, imgPaths, modelId, meta = {}) {
    const { page, config } = context;
    const timeout = meta.requestTimeoutMs || config.runtime?.requestTimeoutMs || 120000;
    try {
        await gotoWithCheck(page, TARGET_URL);
        const blocked = await detectBlockedState(page);
        if (blocked) return { ...blocked, retryable: false };

        const modelError = await selectModel(page, modelId, meta);
        if (modelError) {
            const redirected = await detectBlockedState(page);
            return redirected ? { ...redirected, retryable: false } : modelError;
        }
        await setSystemInstruction(page, meta.systemInstruction || '');

        if (imgPaths?.length) {
            const upload = await firstVisible([
                page.getByRole('button', { name: /Add|Upload|Attach/i }),
                page.locator('input[type="file"]')
            ]);
            if (!upload) return { error: 'AI Studio 当前页面不支持附件上传', retryable: false };
            if (await upload.evaluate(node => node.tagName === 'INPUT').catch(() => false)) {
                await upload.setInputFiles(imgPaths);
            } else {
                await uploadFilesViaChooser(page, upload, imgPaths, {}, meta);
            }
        }

        const input = await findPromptInput(page);
        if (!input) return { error: '找不到 AI Studio 提示词输入框', retryable: true };
        await input.fill(meta.conversationPrompt || prompt);

        const networkPromise = page.waitForResponse(response =>
            /GenerateContent|StreamGenerateContent|generativelanguage/i.test(response.url())
            && response.request().method() === 'POST'
            && response.status() === 200,
        { timeout }).catch(() => null);

        const run = await firstVisible([
            page.getByRole('button', { name: /^Run$/i }),
            page.getByRole('button', { name: /Run prompt|Send/i })
        ]);
        if (!run) return { error: '找不到 AI Studio Run 按钮', retryable: true };
        await run.click();

        const response = await networkPromise;
        const networkText = await extractNetworkText(response);
        if (networkText) return { text: networkText.trim() };
        const domText = await extractStableDomText(page, timeout);
        if (domText) return { text: domText.trim() };
        const afterBlocked = await detectBlockedState(page);
        return afterBlocked
            ? { ...afterBlocked, retryable: false }
            : { error: 'AI Studio 未返回可读取的结果', retryable: true };
    } catch (error) {
        const blocked = await detectBlockedState(page);
        if (blocked) return { ...blocked, retryable: false };
        const pageError = normalizePageError(error, meta);
        if (pageError) return pageError;
        return { error: `AI Studio 请求失败: ${error.message}`, retryable: true };
    }
}

async function discoverModels(page) {
    const button = await firstVisible([
        page.getByRole('button', { name: /model/i }),
        page.locator('[data-testid*="model" i]'),
        page.locator('button').filter({ hasText: /Gemini\s+[0-9]/i })
    ]);
    if (!button) return [];
    await button.click();
    const labels = await page.getByRole('option').or(page.getByRole('menuitem')).or(page.getByRole('radio')).allTextContents();
    await page.keyboard.press('Escape').catch(() => {});
    const models = labels.map(normalizeModelLabel).filter(Boolean);
    return [...new Map(models.map(model => [model.id, model])).values()];
}

export const manifest = {
    id: 'ai_studio',
    displayName: 'AI Studio',
    description: 'Google AI Studio Chat Playground',
    targetUrl: TARGET_URL,
    models: [
        { id: 'gemini-3.1-pro', codeName: '3.1 Pro', imagePolicy: 'optional', type: 'text', capabilities: { input: ['text', 'image'], output: ['text'], reasoning: true } },
        { id: 'gemini-3.1-flash', codeName: '3.1 Flash', imagePolicy: 'optional', type: 'text', capabilities: { input: ['text', 'image'], output: ['text'], reasoning: false } }
    ],
    navigationHandlers: [],
    discoverModels,
    generate
};
