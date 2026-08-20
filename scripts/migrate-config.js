#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'yaml';
import { adapterToSiteId } from '../src/backend/sites/catalog.js';

function parseArgs(argv) {
    const args = { dryRun: false, write: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--input') args.input = argv[++i];
        else if (arg === '--output') args.output = argv[++i];
        else if (arg === '--dry-run') args.dryRun = true;
        else if (arg === '--write') args.write = true;
        else throw new Error(`未知参数: ${arg}`);
    }
    if (!args.input) throw new Error('缺少 --input');
    if (!args.output) throw new Error('缺少 --output');
    if (args.dryRun && args.write) throw new Error('--dry-run 与 --write 不能同时使用');
    if (!args.dryRun && !args.write) args.dryRun = true;
    return args;
}

function slug(value, fallback) {
    const normalized = String(value || fallback).toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    return normalized || fallback;
}

function migrateProxy(proxy) {
    if (!proxy || proxy.enable !== true) return { enabled: false };
    return {
        enabled: true,
        type: proxy.type || 'http',
        host: proxy.host,
        port: Number(proxy.port),
        ...(proxy.user || proxy.username ? { username: proxy.user || proxy.username } : {}),
        ...(proxy.passwd || proxy.password ? { password: proxy.passwd || proxy.password } : {})
    };
}

export function migrateLegacyConfig(legacy) {
    if (legacy?.version === 4) return structuredClone(legacy);
    const instances = legacy?.backend?.pool?.instances;
    if (!Array.isArray(instances) || instances.length === 0) throw new Error('输入文件不包含 backend.pool.instances');

    const usedIds = new Set();
    const browserProfiles = instances.map((instance, index) => {
        let id = slug(instance.name, `browser-${index + 1}`);
        const baseId = id;
        let suffix = 2;
        while (usedIds.has(id)) id = `${baseId}-${suffix++}`;
        usedIds.add(id);

        const sitePages = new Map();
        for (const worker of instance.workers || []) {
            const adapterIds = worker.type === 'merge' ? (worker.mergeTypes || []) : [worker.type];
            for (const adapterId of adapterIds) {
                const siteId = adapterToSiteId(adapterId);
                if (siteId) sitePages.set(siteId, (sitePages.get(siteId) || 0) + 1);
            }
        }

        return {
            id,
            name: instance.name || id,
            userDataDir: instance.userDataMark ? `camoufoxUserData_${instance.userDataMark}` : 'camoufoxUserData',
            proxy: migrateProxy(instance.proxy || legacy.browser?.proxy),
            sites: [...sitePages.entries()].map(([siteId, pages]) => ({ id: siteId, pages }))
        };
    });

    return {
        version: 4,
        logLevel: legacy.logLevel || 'info',
        server: structuredClone(legacy.server || { port: 3000, auth: '' }),
        runtime: {
            scheduling: 'least_loaded',
            queueBuffer: legacy.queue?.queueBuffer ?? 2,
            requestTimeoutMs: legacy.backend?.pool?.waitTimeout ?? 120000,
            maxRetries: legacy.backend?.pool?.failover?.maxRetries ?? 2,
            imageLimit: legacy.queue?.imageLimit ?? 5
        },
        browserProfiles,
        browser: {
            path: legacy.browser?.path || '',
            headless: legacy.browser?.headless ?? false,
            fission: legacy.browser?.fission ?? true,
            humanizeCursor: legacy.browser?.humanizeCursor ?? true,
            perProfileDisplay: true,
            cssInject: structuredClone(legacy.browser?.cssInject || {})
        },
        backend: { adapter: structuredClone(legacy.backend?.adapter || {}) }
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const inputPath = path.resolve(args.input);
    const outputPath = path.resolve(args.output);
    const migrated = migrateLegacyConfig(yaml.parse(fs.readFileSync(inputPath, 'utf8')));
    const rendered = yaml.stringify(migrated, { indent: 2, lineWidth: 0 });
    if (args.dryRun) {
        process.stdout.write(rendered);
        process.stderr.write(`\nDry run: ${inputPath} -> ${outputPath}\n`);
        return;
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, rendered, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`已写入 ${outputPath}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
