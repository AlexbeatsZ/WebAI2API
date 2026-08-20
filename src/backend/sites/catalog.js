export const SITE_CATALOG = Object.freeze({
    'ai-studio': { name: 'AI Studio', adapters: ['ai_studio'] },
    'gemini-web': { name: 'Gemini', adapters: ['gemini_text', 'gemini'] },
    'chatgpt-web': { name: 'ChatGPT', adapters: ['chatgpt_text', 'chatgpt'] },
    'gemini-business': { name: 'Gemini Business', adapters: ['gemini_biz_text', 'gemini_biz'] },
    'lmarena': { name: 'LMArena', adapters: ['lmarena_text', 'lmarena'] },
    'doubao': { name: 'Doubao', adapters: ['doubao_text', 'doubao'] },
    'z-ai': { name: 'zAI', adapters: ['zai_is_text', 'zai_is'] },
    'deepseek': { name: 'DeepSeek', adapters: ['deepseek_text'] },
    'claude-web': { name: 'Claude', adapters: ['claude_text'] },
    'sora': { name: 'Sora', adapters: ['sora'] },
    'google-flow': { name: 'Google Flow', adapters: ['google_flow'] },
    'nano-banana': { name: 'Nano Banana', adapters: ['nanobananafree_ai'] },
    'zenmux': { name: 'ZenMux', adapters: ['zenmux_ai_text'] },
    'browser-check': { name: 'Browser check', adapters: ['test'] }
});

const ADAPTER_TO_SITE = new Map(
    Object.entries(SITE_CATALOG).flatMap(([siteId, site]) =>
        site.adapters.map(adapterId => [adapterId, siteId])
    )
);

export function adapterToSiteId(adapterId) {
    if (!adapterId) return null;
    return ADAPTER_TO_SITE.get(adapterId)
        || adapterId.replace(/_text$/, '').replaceAll('_', '-');
}

export function getSiteDefinition(siteId) {
    return SITE_CATALOG[siteId] || null;
}

export function getSiteIds() {
    return Object.keys(SITE_CATALOG);
}
