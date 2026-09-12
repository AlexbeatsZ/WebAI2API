/**
 * WebAI2API v4 configuration loader.
 * Legacy Instance/Worker configuration must be converted explicitly.
 */

import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { logger } from '../utils/logger.js';
import { getSiteDefinition } from '../backend/sites/catalog.js';
import { validateChatgptProjectConfig } from '../backend/adapter/chatgpt-project.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_CONFIG_PATH = path.join(DATA_DIR, 'config.yaml');
const ROOT_CONFIG_PATH = path.join(process.cwd(), 'config.yaml');
const EXAMPLE_CONFIG_PATH = path.join(process.cwd(), 'config.example.yaml');

let cachedConfig = null;
let activeConfigPath = null;

function resolveConfigPath() {
    if (fs.existsSync(DATA_CONFIG_PATH)) return DATA_CONFIG_PATH;
    if (fs.existsSync(ROOT_CONFIG_PATH)) return ROOT_CONFIG_PATH;
    if (fs.existsSync(EXAMPLE_CONFIG_PATH)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.copyFileSync(EXAMPLE_CONFIG_PATH, DATA_CONFIG_PATH);
        logger.info('配置', `已创建 ${DATA_CONFIG_PATH}`);
        return DATA_CONFIG_PATH;
    }
    return DATA_CONFIG_PATH;
}

export function getConfigPath() {
    if (!activeConfigPath) activeConfigPath = resolveConfigPath();
    return activeConfigPath;
}

export function resetConfigCache() {
    cachedConfig = null;
    activeConfigPath = null;
}

export function resolveUserDataDir(value) {
    const dir = value || 'camoufoxUserData';
    return path.isAbsolute(dir) ? path.normalize(dir) : path.join(DATA_DIR, dir);
}

export function resolveProxyConfig(proxy) {
    if (!proxy || (proxy.enabled !== true && proxy.enable !== true)) return null;
    return {
        enable: true,
        type: proxy.type || 'http',
        host: proxy.host,
        port: Number(proxy.port),
        ...(proxy.username || proxy.user ? { user: proxy.username || proxy.user } : {}),
        ...(proxy.password || proxy.passwd ? { passwd: proxy.password || proxy.passwd } : {})
    };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function normalizeSite(site, profileId, index) {
    assert(site && typeof site === 'object', `browserProfiles.${profileId}.sites[${index}] 必须是对象`);
    assert(typeof site.id === 'string' && site.id.length > 0, `browserProfiles.${profileId}.sites[${index}] 缺少 id`);
    assert(getSiteDefinition(site.id), `browserProfiles.${profileId}.sites[${index}] 使用未知网站: ${site.id}`);
    const pages = Number(site.pages ?? 1);
    assert(Number.isInteger(pages) && pages >= 1 && pages <= 16, `browserProfiles.${profileId}.sites.${site.id}.pages 必须为 1-16`);
    return { id: site.id, pages };
}

function normalizeProfile(profile, index, usedIds, usedDirs) {
    assert(profile && typeof profile === 'object', `browserProfiles[${index}] 必须是对象`);
    assert(/^[a-z0-9][a-z0-9-]*$/.test(profile.id || ''), `browserProfiles[${index}].id 只能使用小写字母、数字和连字符`);
    assert(!usedIds.has(profile.id), `浏览器配置 id 重复: ${profile.id}`);
    usedIds.add(profile.id);

    assert(Array.isArray(profile.sites) && profile.sites.length > 0, `browserProfiles.${profile.id}.sites 不能为空`);
    const sites = profile.sites.map((site, siteIndex) => normalizeSite(site, profile.id, siteIndex));
    const siteIds = new Set();
    for (const site of sites) {
        assert(!siteIds.has(site.id), `浏览器配置 ${profile.id} 中网站重复: ${site.id}`);
        siteIds.add(site.id);
    }

    const userDataDir = profile.userDataDir || 'camoufoxUserData';
    const resolvedUserDataDir = resolveUserDataDir(userDataDir);
    const key = process.platform === 'win32' ? resolvedUserDataDir.toLowerCase() : resolvedUserDataDir;
    assert(!usedDirs.has(key), `多个浏览器配置不能共享用户数据目录: ${userDataDir}`);
    usedDirs.add(key);

    return {
        id: profile.id,
        name: profile.name || profile.id,
        userDataDir,
        resolvedUserDataDir,
        proxy: profile.proxy || { enabled: false },
        resolvedProxy: resolveProxyConfig(profile.proxy),
        sites
    };
}

function normalizeConfig(raw, configPath) {
    if (raw?.backend?.pool?.instances || raw?.backend?.pool?.workers) {
        throw new Error(`检测到 v3 Instance/Worker 配置。请先运行: npm run migrate-config -- --input "${configPath}" --output "${configPath}.v4" --dry-run`);
    }
    assert(raw?.version === 4, '配置 version 必须为 4；旧配置必须先使用 migrate-config 转换');
    assert(Array.isArray(raw.browserProfiles) && raw.browserProfiles.length > 0, 'browserProfiles 必须是非空数组');

    const config = structuredClone(raw);
    config.server ||= {};
    config.server.port ??= 3000;
    assert(Number.isInteger(config.server.port) && config.server.port >= 1 && config.server.port <= 65535, 'server.port 必须为 1-65535 的整数');
    config.server.keepalive ||= { mode: 'comment' };
    config.server.keepalive.mode ||= 'comment';
    assert(['comment', 'content'].includes(config.server.keepalive.mode), 'server.keepalive.mode 必须为 comment 或 content');
    if (!config.server.auth) logger.warn('配置', 'API 认证未启用；仅应在可信网络中使用');

    config.runtime ||= {};
    config.runtime.scheduling ||= 'least_loaded';
    assert(config.runtime.scheduling === 'least_loaded', 'runtime.scheduling 当前仅支持 least_loaded');
    config.runtime.queueBuffer ??= 2;
    config.runtime.requestTimeoutMs ??= 120000;
    config.runtime.maxRetries ??= 2;
    config.runtime.imageLimit ??= 5;
    assert(Number.isInteger(config.runtime.queueBuffer) && config.runtime.queueBuffer >= 0, 'runtime.queueBuffer 必须为非负整数');
    assert(Number.isInteger(config.runtime.requestTimeoutMs) && config.runtime.requestTimeoutMs >= 1000 && config.runtime.requestTimeoutMs <= 600000, 'runtime.requestTimeoutMs 必须为 1000-600000 的整数');
    assert(Number.isInteger(config.runtime.maxRetries) && config.runtime.maxRetries >= 0 && config.runtime.maxRetries <= 10, 'runtime.maxRetries 必须为 0-10 的整数');
    assert(Number.isInteger(config.runtime.imageLimit) && config.runtime.imageLimit >= 1 && config.runtime.imageLimit <= 10, 'runtime.imageLimit 必须为 1-10 的整数');

    config.browser ||= {};
    config.browser.headless ??= false;
    config.browser.fission ??= true;
    config.browser.humanizeCursor ??= true;
    config.browser.perProfileDisplay ??= true;
    if ((!config.browser.path || !fs.existsSync(config.browser.path)) && fs.existsSync('/app/camoufox/camoufox')) {
        config.browser.path = '/app/camoufox/camoufox';
    }

    const usedIds = new Set();
    const usedDirs = new Set();
    config.browserProfiles = config.browserProfiles.map((profile, index) => normalizeProfile(profile, index, usedIds, usedDirs));
    const pageCount = config.browserProfiles.reduce((total, profile) =>
        total + profile.sites.reduce((sum, site) => sum + site.pages, 0), 0);
    config.queue = {
        queueBuffer: config.runtime.queueBuffer,
        imageLimit: config.runtime.imageLimit,
        maxConcurrent: pageCount
    };

    // Legacy adapter modules read these internal settings. This is not an
    // Instance/Worker compatibility layer.
    config.backend ||= {};
    config.backend.adapter ||= {};
    const projectErrors = validateChatgptProjectConfig(config.backend.adapter.chatgpt_text);
    assert(projectErrors.length === 0, projectErrors.join('; '));
    if (config.backend.adapter.chatgpt_text?.projectUrl) {
        for (const profile of config.browserProfiles) {
            const chatgpt = profile.sites.find(site => site.id === 'chatgpt-web');
            assert(
                !chatgpt || chatgpt.pages === 1,
                `固定 ChatGPT Project 模式要求浏览器配置 ${profile.id} 仅使用 1 个 ChatGPT 页面`
            );
        }
    }
    config.backend.pool = {
        strategy: 'least_busy',
        waitTimeout: config.runtime.requestTimeoutMs,
        failover: {
            enabled: true,
            maxRetries: config.runtime.maxRetries,
            imgDlRetry: false,
            imgDlRetryMaxRetries: 2
        }
    };
    return config;
}

export function loadConfig() {
    if (cachedConfig) return cachedConfig;
    const configPath = getConfigPath();
    if (!fs.existsSync(configPath)) throw new Error(`未找到配置文件: ${configPath}`);
    const raw = yaml.parse(fs.readFileSync(configPath, 'utf8'));
    assert(raw && typeof raw === 'object', `配置文件解析失败: ${configPath}`);
    cachedConfig = normalizeConfig(raw, configPath);
    if (cachedConfig.logLevel) logger.setLevel(cachedConfig.logLevel);
    logger.info('配置', `v4 配置已加载: ${cachedConfig.browserProfiles.length} 个浏览器配置，${cachedConfig.queue.maxConcurrent} 个并发页`);
    return cachedConfig;
}

export default loadConfig;
