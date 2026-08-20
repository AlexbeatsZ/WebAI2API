import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserProfile } from '../src/backend/runtime/BrowserProfile.js';

test('a delayed close event from the replaced context cannot restart the new browser', () => {
    const profile = new BrowserProfile({}, {
        id: 'google',
        name: 'Google',
        sites: []
    }, {}, () => {});
    const oldContext = { id: 'old' };
    const newContext = { id: 'new' };
    profile.context = newContext;
    profile.closing = false;
    profile.state = 'online';

    profile.handleContextClose(oldContext);

    assert.equal(profile.state, 'online');
    assert.equal(profile.crashTimer, null);
});

test('the currently owned context still schedules isolated crash recovery', () => {
    const profile = new BrowserProfile({}, {
        id: 'google',
        name: 'Google',
        sites: []
    }, {}, () => {});
    const context = { id: 'current' };
    profile.context = context;
    profile.closing = false;
    profile.state = 'online';

    profile.handleContextClose(context);

    assert.equal(profile.state, 'offline');
    assert.notEqual(profile.crashTimer, null);
    clearTimeout(profile.crashTimer);
    profile.crashTimer = null;
});
