/**
 * @fileoverview 后端适配器入口
 * @description 基于 BrowserProfile + PageSlot 运行时管理浏览器连接。
 *
 * 对外统一能力：
 * - `initBrowser(cfg)` → 初始化 Pool
 * - `generate(ctx, prompt, imagePaths, modelId, meta)`
 * - `getModels()` / `getImagePolicy(modelKey)` / `getModelType(modelKey)`
 * - `getCookies(workerName, domain)` - 获取指定 Worker 的 Cookies
 */

import fs from 'fs';
import path from 'path';
import { loadConfig } from '../config/index.js';
import { RuntimeManager } from './runtime/RuntimeManager.js';
import { logger } from '../utils/logger.js';

// --- 集中管理的路径常量 ---
const TEMP_DIR = path.join(process.cwd(), 'data', 'temp');

// 确保临时目录存在
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

let runtimeManager = null;

/**
 * 获取后端接口
 * @returns {object} 后端统一接口
 */
export function getBackend() {
    const config = loadConfig();

    // 将临时目录路径注入 config 对象
    config.paths = {
        tempDir: TEMP_DIR
    };

    return {
        name: 'pool',
        config,
        TEMP_DIR,

        /**
         * 初始化 Pool
         * @param {object} cfg - 配置对象
         * @returns {Promise<{poolManager: PoolManager, config: object}>}
         */
        initBrowser: async (cfg) => {
            if (runtimeManager && runtimeManager.initialized) {
                return { poolManager: runtimeManager, runtimeManager, config: cfg };
            }

            runtimeManager = new RuntimeManager(cfg);
            await runtimeManager.initAll();

            return { poolManager: runtimeManager, runtimeManager, config: cfg };
        },

        /**
         * 生成图片
         * @param {object} ctx - 浏览器上下文 (来自 initBrowser 返回)
         * @param {string} prompt - 提示词
         * @param {string[]} paths - 图片路径
         * @param {string} modelId - 模型 ID
         * @param {object} meta - 元信息
         */
        generate: async (ctx, prompt, paths, modelId, meta) => {
            if (!runtimeManager) {
                return { error: '浏览器运行时未初始化' };
            }
            return await runtimeManager.generate(ctx, prompt, paths, modelId, meta);
        },

        /**
         * 获取模型列表
         * @returns {object}
         */
        getModels: () => {
            if (!runtimeManager) {
                return { object: 'list', data: [] };
            }
            return runtimeManager.getModels();
        },

        /**
         * 获取图片策略
         * @param {string} modelKey - 模型 key
         * @returns {string}
         */
        getImagePolicy: (modelKey) => {
            if (!runtimeManager) {
                return 'optional';
            }
            return runtimeManager.getImagePolicy(modelKey);
        },

        /**
         * 获取模型类型
         * @param {string} modelKey - 模型 key
         * @returns {string} 'text' | 'image'
         */
        getModelType: (modelKey) => {
            if (!runtimeManager) {
                return 'conversation';
            }
            return runtimeManager.getModelType(modelKey);
        },

        /**
         * 获取 Cookies
         * @param {string} [workerName] - Worker 名称
         * @param {string} [domain] - 域名
         * @returns {Promise<{worker: string, cookies: object[]}>}
         */
        getCookies: async (workerName, domain) => {
            if (!runtimeManager) {
                throw new Error('浏览器运行时未初始化');
            }
            return await runtimeManager.getCookies(workerName, domain);
        },

        /**
         * 触发监控导航（空闲时）
         */
        navigateToMonitor: async () => {
            return;
        },

        /**
         * 获取 PoolManager 实例
         * @returns {PoolManager|null}
         */
        getPoolManager: () => runtimeManager,
        getRuntimeManager: () => runtimeManager
    };
}
