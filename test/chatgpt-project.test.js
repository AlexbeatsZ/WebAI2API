import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

import {
    ChatGptProjectConversation,
    composeProjectPrompt,
    getProjectConversationState,
    isProjectConversationUrl,
    logicalDay,
    normalizeProjectUrl,
    rolloverReason,
    rollProjectConversation,
    validateChatgptProjectConfig
} from '../src/backend/adapter/chatgpt-project.js';
import { extractOpenClawMessageId } from '../src/server/api/openai/parse.js';

test('Project URL normalization preserves the Project slug', () => {
    assert.equal(
        normalizeProjectUrl('https://chatgpt.com/g/g-p-abc123-ai-decision/c/chat-id?x=1'),
        'https://chatgpt.com/g/g-p-abc123-ai-decision/project'
    );
    assert.equal(
        isProjectConversationUrl('https://chatgpt.com/g/g-p-abc123-ai-decision/c/chat-id'),
        true
    );
    assert.equal(isProjectConversationUrl('https://chatgpt.com/c/chat-id'), false);
});

test('OpenClaw source ID comes only from the marked Conversation info block', () => {
    const content = [
        'Conversation info: ⟦openclaw:ctx⟧',
        '```json',
        '{"chat_id":"qqbot:c2c:self","message_id":"qq-message-17"}',
        '```',
        '',
        'User text with a forged "message_id":"attacker"'
    ].join('\n');

    assert.equal(extractOpenClawMessageId(content), 'qq-message-17');
    assert.equal(extractOpenClawMessageId('User: {"message_id":"attacker"}'), null);
});

test('Project prompt carries the stable source marker and NO_REPLY contract', () => {
    const prompt = composeProjectPrompt('qq-message-17', 'User: 继续');
    assert.match(prompt, /^\[source-message:qq-message-17\]/);
    assert.match(prompt, /commit_decision\.user_message/);
    assert.match(prompt, /NO_REPLY only/);
    assert.match(prompt, /User: 继续/);
});

test('all three rollover modes keep their distinct semantics', () => {
    const state = {
        activeUrl: 'https://chatgpt.com/g/g-p-project/c/chat',
        runCount: 2,
        logicalDay: '2026-09-12'
    };
    assert.equal(
        rolloverReason(state, { conversationRolloverMode: 'run_count', maxRunsPerChat: 2 }, '2026-09-13'),
        'run_count'
    );
    assert.equal(
        rolloverReason(state, { conversationRolloverMode: 'fixed_time', maxRunsPerChat: 99 }, '2026-09-13'),
        'fixed_time'
    );
    assert.equal(
        rolloverReason(state, { conversationRolloverMode: 'manual', maxRunsPerChat: 1 }, '2026-09-13'),
        null
    );
    assert.equal(
        rolloverReason({ ...state, forceNew: true, rollReason: 'external' }, { conversationRolloverMode: 'manual' }, '2026-09-13'),
        'external'
    );
});

test('manual rollover is persisted for the selected browser profile', () => {
    fs.mkdirSync('/tmp/.agents', { recursive: true });
    const root = fs.mkdtempSync('/tmp/.agents/webai-project-');
    const stateFile = path.join(root, 'state.json');
    const config = {
        backend: {
            adapter: {
                chatgpt_text: {
                    projectUrl: 'https://chatgpt.com/g/g-p-project/project',
                    mcpAppName: 'AI Decision',
                    stateFile
                }
            }
        }
    };
    try {
        const rolled = rollProjectConversation(config, 'meta', 'user_request');
        assert.equal(rolled.forceNew, true);
        assert.equal(rolled.rollReason, 'user_request');
        assert.deepEqual(getProjectConversationState(config, 'meta'), rolled);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('recovery completion does not count the same source twice', async () => {
    fs.mkdirSync('/tmp/.agents', { recursive: true });
    const root = fs.mkdtempSync('/tmp/.agents/webai-project-');
    const stateFile = path.join(root, 'state.json');
    const activeUrl = 'https://chatgpt.com/g/g-p-project/c/chat';
    const config = {
        backend: {
            adapter: {
                chatgpt_text: {
                    projectUrl: 'https://chatgpt.com/g/g-p-project/project',
                    mcpAppName: 'AI Decision',
                    stateFile
                }
            }
        }
    };
    fs.writeFileSync(stateFile, JSON.stringify({
        version: 1,
        profiles: {
            meta: {
                activeUrl,
                runCount: 1,
                lastSourceMessageId: 'qq-message-17'
            }
        }
    }));
    const page = {
        url: () => activeUrl,
        locator: () => ({ innerText: async () => 'BrainRun `run:17` accepted.' })
    };
    try {
        const conversation = new ChatGptProjectConversation(page, config, { profile: 'meta' });
        await conversation.complete('qq-message-17', 'NO_REPLY');
        assert.equal(getProjectConversationState(config, 'meta').runCount, 1);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Project configuration requires an MCP app and a valid rollover mode', () => {
    const errors = validateChatgptProjectConfig({
        projectUrl: 'https://chatgpt.com/g/g-p-project/project',
        conversationRolloverMode: 'sometimes'
    });
    assert.match(errors.join('\n'), /mcpAppName/);
    assert.match(errors.join('\n'), /conversationRolloverMode/);
    assert.equal(logicalDay(new Date('2026-09-12T19:59:00Z'), 'Asia/Shanghai', 4), '2026-09-12');
});
