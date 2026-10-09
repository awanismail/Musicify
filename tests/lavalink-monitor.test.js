const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

// Load the real handler with external services stubbed: no Discord login or timers.
function fixture(node, configNode = { name: "audio" }, refresh = null) {
    let connects = 0;
    let creates = 0;
    const context = vm.createContext({
        require: (name) => name === "../../config" ? { nodes: [configNode] }
            : name === "../db/appSettings" ? { getAppSetting: () => refresh } : {},
        module: { exports: {} },
        console: { log() {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/handlers/playerHandler.js"), "utf8"), context);
    if (node) node.connect = () => { connects++; };
    const client = { riffy: {
        initiated: true,
        nodeMap: new Map(node ? [[configNode.name || configNode.host, node]] : []),
        createNode: () => { creates++; },
    } };
    return {
        run: () => context.refreshLavalinkNodes(client),
        counts: () => ({ connects, creates }),
    };
}

test("24 hours of checks leave a healthy standby connection intact", () => {
    const node = { connected: true, ws: { readyState: 1, close() { assert.fail("Disconnected healthy node"); } }, reconnectAttempted: 2 };
    const monitor = fixture(node);
    for (let i = 0; i < 48; i++) monitor.run();
    assert.deepEqual(monitor.counts(), { connects: 0, creates: 0 });
    assert.equal(node.reconnectAttempted, 2);
});

test("explicit enable refreshes a healthy node; disable preserves it", () => {
    for (const enabled of ["true", "false", null]) {
        let closes = 0;
        const node = { connected: true, ws: { readyState: 1, close() { closes++; } } };
        fixture(node, { name: "audio" }, enabled).run();
        assert.equal(closes, enabled === "true" ? 1 : 0);
    }
});

test("pending retries and sockets in progress are not duplicated", () => {
    for (const state of [0, 1, 2]) {
        const monitor = fixture({ connected: false, ws: { readyState: state } });
        monitor.run();
        assert.equal(monitor.counts().connects, 0);
    }
    const node = { connected: false, reconnectAttempt: {}, reconnectAttempted: 2 };
    const monitor = fixture(node);
    monitor.run();
    assert.equal(monitor.counts().connects, 0);
    assert.equal(node.reconnectAttempted, 2);
    assert.ok(node.reconnectAttempt);
});

test("disconnected nodes without a pending retry can recover", () => {
    for (const ws of [null, { readyState: 3 }]) {
        const node = { connected: false, ws, reconnectAttempted: 3 };
        const monitor = fixture(node);
        monitor.run();
        assert.equal(monitor.counts().connects, 1);
        assert.equal(node.reconnectAttempted, 1);
    }
});

test("missing nodes are created and host-only node names are recognized", () => {
    const missing = fixture(null);
    missing.run();
    assert.equal(missing.counts().creates, 1);
    const existing = fixture({ connected: true }, { host: "audio.local" });
    existing.run();
    assert.deepEqual(existing.counts(), { connects: 0, creates: 0 });
});
