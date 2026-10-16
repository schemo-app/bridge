import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const compiled = new Map(await Promise.all(['capture', 'state', 'index'].map(async name => {
    const source = await readFile(new URL(`../src/background/${name}.ts`, import.meta.url), 'utf8');
    return [name, ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText];
})));

function capture(paused = []) {
    const scripts = [];
    const saved = [];
    const failedTabs = new Set();
    let sent = 0;
    let session = { captureTabs: [] };
    const modules = {
        '../shared/api': { ext: {
            scripting: { executeScript: async options => {
                scripts.push(options);
                if (failedTabs.has(options.target.tabId)) throw new Error('Tab is unreachable');
            } },
            storage: {
                session: { get: async () => session, set: async value => { saved.push(value); } },
                local: { get: async () => ({}) },
            },
            alarms: { create() {} },
            tabs: { query() { throw new Error('Capture must target exact tab IDs'); } },
        } },
        '../shared/types': { DEFAULT_SETTINGS: { rememberTabs: false }, DEFAULT_FILTERS: {} },
        '../shared/i18n': { t: key => key },
        '../shared/sites': {},
        './browser': {},
        './filters': { keptByFilters: () => true },
        './indicator': { refreshIndicator() {}, setCaptureTitle() {}, setCaptureIcon() {}, titleDisconnected() {}, captureTitleText() {} },
        './connection': { isConnected: () => true, sendState() {}, send() { sent++; return true; } },
    };
    function load(name) {
        const exports = {};
        runInNewContext(compiled.get(name), { exports, crypto: globalThis.crypto, console: { warn() {} }, require(name) {
            if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
            return modules[name];
        } });
        return exports;
    }
    const storage = load('state');
    modules['./state'] = storage;
    const api = load('capture');
    for (const id of [7, 8]) {
        storage.rememberTab({ id, title: `Tab ${id}`, url: `https://example.com/${id}` });
        storage.state.tabs.get(id).paused = paused.includes(id);
    }
    return { api, storage, state: storage.state, scripts, saved, failedTabs, sent: () => sent,
        setSession(value) { session = value; },
    };
}

function pausedTabs(held) {
    return [...held.state.tabs].filter(([, tab]) => tab.paused).map(([id]) => id);
}

test('pausing one tab retains both sessions and leaves the other tab recording', async () => {
    const held = capture();
    await held.api.pauseCapture(7);
    assert.deepEqual([...held.state.tabs.keys()], [7, 8]);
    assert.deepEqual(pausedTabs(held), [7]);
    assert.deepEqual(held.scripts.map(script => script.target.tabId), [7]);
    assert.equal(held.saved.length, 1);
    assert.deepEqual([...held.saved[0].captureTabs].filter(tab => tab.paused).map(tab => tab.tabId), [7]);
});

test('resuming one tab does not resume other paused tabs on the same website', async () => {
    const held = capture([7, 8]);
    await held.api.resumeCapture(7);
    assert.deepEqual(pausedTabs(held), [8]);
    assert.ok(held.scripts.length > 0);
    assert.ok(held.scripts.every(script => script.target.tabId === 7));
});

test('global pause and resume preserve the exact set of captured tabs', async () => {
    const held = capture();
    await held.api.pauseCapture();
    assert.deepEqual(pausedTabs(held), [7, 8]);
    await held.api.resumeCapture();
    assert.deepEqual(pausedTabs(held), []);
    assert.deepEqual([...held.state.tabs.keys()], [7, 8]);
});

test('late requests from a paused tab are not ingested', () => {
    const held = capture([7]);
    held.api.handleCapturedRequest({ type: 'captured' }, { tab: { id: 7 } });
    assert.equal(held.sent(), 0);
});

test('a failed resume keeps the tab paused and reports failure to the popup', async () => {
    const held = capture([7, 8]);
    held.failedTabs.add(7);
    const result = await held.api.startCaptureOn({ id: 7 });
    assert.equal(result.ok, false);
    assert.deepEqual(pausedTabs(held), [7, 8]);
});

test('pause and resume never inject into a tab outside capture', async () => {
    const held = capture();
    await held.api.pauseCapture(9);
    await held.api.resumeCapture(9);
    assert.deepEqual(held.scripts, []);
    assert.equal(held.state.tabs.has(9), false);
});

test('accepted requests update only their captured tab statistics', () => {
    const held = capture();
    held.api.handleCapturedRequest({ type: 'captured' }, { tab: { id: 7 } });
    assert.equal(held.sent(), 1);
    assert.equal(held.state.tabs.get(7).count, 1);
    assert.ok(held.state.tabs.get(7).lastAt > 0);
    assert.equal(held.state.tabs.get(8).count, 0);
});

test('refreshing tab metadata preserves capture time, pause and statistics', () => {
    const held = capture([7]);
    const tab = held.state.tabs.get(7);
    tab.count = 3;
    tab.lastAt = 42;
    held.storage.rememberTab({ id: 7, title: 'Updated', url: 'https://example.org' });
    const updated = held.state.tabs.get(7);
    assert.equal(updated.since, tab.since);
    assert.equal(updated.count, 3);
    assert.equal(updated.lastAt, 42);
    assert.equal(updated.paused, true);
    assert.equal(updated.title, 'Updated');
});

test('session storage round-trips captured tabs with their timestamps and pause state', async () => {
    const held = capture();
    held.state.tabs.get(7).since = 100;
    held.state.tabs.get(8).since = 200;
    held.state.tabs.get(7).paused = true;
    await held.storage.persistCapture();
    held.setSession(held.saved.at(-1));
    const stored = await held.storage.readState();
    held.state.tabs.clear();
    for (const saved of stored) held.storage.rememberTab({ id: saved.tabId }, saved);
    assert.deepEqual([...held.state.tabs.keys()], [7, 8]);
    assert.deepEqual(pausedTabs(held), [7]);
    assert.equal(held.state.tabs.get(7).since, 100);
    assert.equal(held.state.tabs.get(8).since, 200);
});

function background() {
    const listeners = {};
    const state = { tabs: new Map(), settings: { rememberTabs: false } };
    let finishRead;
    const reading = new Promise(resolve => { finishRead = resolve; });
    let reads = 0;
    const calls = [];
    const event = name => ({ addListener(callback) { listeners[name] = callback; } });
    const modules = {
        '../shared/api': { ext: {
            runtime: { onMessage: event('message'), onStartup: event('startup') },
            tabs: {
                onUpdated: event('updated'), onRemoved: event('removed'),
                get: async id => {
                    if (id === 9) throw new Error('Tab was closed');
                    return { id, title: 'Restored tab', url: 'https://example.com' };
                },
            },
            alarms: { onAlarm: event('alarm') },
        } },
        '../shared/i18n': { t: key => key },
        './capture': { startKeepalive() {}, stopKeepalive() {}, isKeepalive: () => true },
        './access': { listenForGrants() {} },
        './commands': { respond: async () => {
            calls.push('respond');
            return { count: state.tabs.size };
        } },
        './connection': {
            connect() { calls.push('connect'); }, disconnect() {}, sendState() {},
            setFrameHandler() {}, isConnected: () => false,
        },
        './filters': {},
        './indicator': { refreshIndicator() {} },
        './browser': {},
        './state': {
            state, listenForSettings() {}, persistCapture: async () => {},
            readState() { reads++; return reading; },
            rememberTab(tab, saved) { state.tabs.set(tab.id, { ...tab, ...saved }); },
        },
    };
    runInNewContext(compiled.get('index'), { exports: {}, console, require(name) {
        if (!(name in modules)) throw new Error(`Unexpected import ${name}`);
        return modules[name];
    } });
    return { listeners, state, calls, reads: () => reads, finishRead };
}

test('popup commands wait for restoration and closed tabs are discarded', async () => {
    const held = background();
    const answer = new Promise(resolve => {
        assert.equal(held.listeners.message({ type: 'getState' }, {}, resolve), true);
    });
    assert.deepEqual(held.calls, []);
    held.finishRead([{ tabId: 7, since: 100, paused: true }, { tabId: 9, since: 200, paused: false }]);
    const result = await answer;
    assert.equal(result.count, 1);
    assert.deepEqual(held.calls, ['connect', 'respond']);
    assert.equal(held.state.tabs.get(7).paused, true);
    assert.equal(held.state.tabs.get(7).since, 100);
    assert.equal(held.state.wanted, true);
});

test('browser startup shares the initial state read instead of resetting restored sessions', async () => {
    const held = background();
    const starting = held.listeners.startup();
    held.finishRead([{ tabId: 7, since: 100, paused: true }]);
    await starting;
    assert.equal(held.reads(), 1);
    assert.equal(held.state.tabs.get(7).paused, true);
});

test('stopping a tab rejects late requests while injected hooks are being disabled', async () => {
    const held = capture();
    const stopping = held.api.stopCaptureFor(7);
    held.api.handleCapturedRequest({ type: 'captured' }, { tab: { id: 7 } });
    assert.equal(held.sent(), 0);
    assert.equal(held.state.tabs.has(7), false);
    await stopping;
    assert.equal(held.state.tabs.has(8), true);
});
