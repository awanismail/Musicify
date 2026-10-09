const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Routes } = require("discord.js");
const { resetCommands } = require("../scripts/reset-discord-commands");
const commands = [{ name: "refresh", type: 1, description: "Refresh" }];
const output = { log() {} };

function fixture({ mismatch = false, failGlobal = false } = {}) {
    const writes = [];
    let global = [{ name: "old", type: 1 }];
    const guildCommands = new Map([["1", [{ name: "old" }]], ["201", [{ name: "legacy" }]]]);
    const rest = {
        async get(route, options) {
            if (route === Routes.oauth2CurrentApplication()) return { id: mismatch ? "wrong" : "app", name: "Nada" };
            if (route === Routes.userGuilds()) {
                return options.query.get("after")
                    ? [{ id: "201" }]
                    : Array.from({ length: 200 }, (_, i) => ({ id: String(i + 1) }));
            }
            if (route === Routes.applicationCommands("app")) return global;
            const id = route.split("/")[4];
            assert.equal(route, Routes.applicationGuildCommands("app", id));
            return guildCommands.get(id) || [];
        },
        async put(route, { body }) {
            writes.push(route);
            if (route === Routes.applicationCommands("app")) {
                if (failGlobal) throw new Error("global failed");
                global = body;
            } else guildCommands.set(route.split("/")[4], body);
        },
    };
    return { rest, writes, guildCommands };
}

test("redeploy reset replaces globals and clears stale guild commands across pages", async () => {
    const { rest, writes, guildCommands } = fixture();
    await resetCommands(rest, "app", commands, output);
    assert.deepEqual(writes, [Routes.applicationCommands("app"), Routes.applicationGuildCommands("app", "1"), Routes.applicationGuildCommands("app", "201")]);
    assert.equal(guildCommands.get("201").length, 0);
    writes.length = 0;
    await resetCommands(rest, "app", commands, output);
    assert.deepEqual(writes, [Routes.applicationCommands("app")]);
});

test("wrong app or empty definitions cause no writes", async () => {
    const { rest, writes } = fixture({ mismatch: true });
    await assert.rejects(resetCommands(rest, "app", commands, output), /tidak cocok/);
    await assert.rejects(resetCommands(rest, "app", [], output), /kosong/);
    assert.equal(writes.length, 0);
});

test("global registration failure preserves guild commands", async () => {
    const { rest, writes, guildCommands } = fixture({ failGlobal: true });
    await assert.rejects(resetCommands(rest, "app", commands, output), /global failed/);
    assert.equal(writes.length, 1);
    assert.equal(guildCommands.get("1").length, 1);
});
