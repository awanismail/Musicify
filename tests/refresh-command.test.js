const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const discord = require("discord.js");

function loadCommand(settings) {
    const context = vm.createContext({
        require: name => name === "discord.js" ? discord : {
            getAppSetting: key => settings.get(key) ?? null,
            setAppSetting: (key, value) => settings.set(key, value),
        },
        module: { exports: {} },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/commands/refresh.js"), "utf8"), context);
    return context.module.exports;
}

async function invoke(command, action, userId = "owner", owner = { id: "owner" }) {
    let reply;
    await command.execute({
        user: { id: userId },
        options: { getSubcommand: () => action },
        deferReply: async payload => assert.equal(payload.flags, discord.MessageFlags.Ephemeral),
        editReply: async content => { reply = content; },
    }, { application: { fetch: async () => ({ owner }) } });
    return reply;
}

test("default off, enable, reload status and disable use persisted global setting", async () => {
    const settings = new Map();
    const command = loadCommand(settings);
    assert.match(await invoke(command, "status"), /\*\*nonaktif\*\*/);
    assert.match(await invoke(command, "enable"), /\*\*aktif\*\*/);
    assert.equal(settings.get("lavalink_force_refresh"), "true");
    assert.match(await invoke(loadCommand(settings), "status"), /\*\*aktif\*\*/);
    assert.match(await invoke(command, "disable"), /\*\*nonaktif\*\*/);
    assert.equal(settings.get("lavalink_force_refresh"), "false");
});

test("non-owner and missing owner fail closed; team owner is accepted", async () => {
    const settings = new Map();
    const command = loadCommand(settings);
    for (const owner of [{ id: "owner" }, null, { id: "team", ownerId: "owner" }]) {
        assert.match(await invoke(command, "enable", "other", owner), /hanya bisa/);
        assert.equal(settings.size, 0);
    }
    await invoke(command, "enable", "owner", { id: "team", ownerId: "owner" });
    assert.equal(settings.get("lavalink_force_refresh"), "true");
});

test("slash command exposes the three approved actions", () => {
    const data = loadCommand(new Map()).data.toJSON();
    assert.equal(data.name, "refresh");
    assert.deepEqual(data.options.map(option => option.name), ["enable", "disable", "status"]);
});
