const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Routes } = require("discord.js");
const { parseArgs, run } = require("../scripts/discord-commands");
const app = "111111111111111111";
const guild = "222222222222222222";
const target = "333333333333333333";
const other = "444444444444444444";
const output = { log() {}, table() {} };

function fixture() {
    let commands = [{ id: target, name: "old", type: 1 }, { id: other, name: "keep", type: 1 }];
    const deleted = [];
    return { deleted, rest: {
        get: async route => {
            if (route === Routes.oauth2CurrentApplication()) return { id: app, name: "Nada" };
            if (route === Routes.applicationCommands(app)) return [{ id: "555555555555555555", name: "refresh", type: 1 }];
            assert.equal(route, Routes.applicationGuildCommands(app, guild));
            return commands;
        },
        delete: async route => {
            assert.equal(route, Routes.applicationGuildCommand(app, guild, target));
            deleted.push(route);
            commands = commands.filter(command => command.id !== target);
        },
    } };
}

test("inspect and deletion preview never mutate Discord", async () => {
    const { rest, deleted } = fixture();
    await run(rest, app, parseArgs(["--guild", guild]), output);
    await run(rest, app, parseArgs(["--guild", guild, "--delete", target]), output);
    assert.equal(deleted.length, 0);
});

test("apply removes only selected guild command and verifies removal", async () => {
    const { rest, deleted } = fixture();
    await run(rest, app, parseArgs(["--guild", guild, "--delete", target, "--apply"]), output);
    assert.equal(deleted.length, 1);
    assert.deepEqual((await rest.get(Routes.applicationGuildCommands(app, guild))).map(command => command.id), [other]);
});

test("unknown command and wrong application are rejected before deletion", async () => {
    const { rest, deleted } = fixture();
    const options = parseArgs(["--guild", guild, "--delete", `${target},555555555555555555`, "--apply"]);
    await assert.rejects(run(rest, app, options, output), /bukan command khusus/);
    await assert.rejects(run(rest, other, options, output), /tidak cocok/);
    assert.equal(deleted.length, 0);
});

test("invalid arguments fail closed", () => {
    for (const args of [[], ["--guild", guild, "--apply"], ["--guild", guild, "--delete"], ["--guild", guild, "--all"]]) {
        assert.throws(() => parseArgs(args));
    }
});
