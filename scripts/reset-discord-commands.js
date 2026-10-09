const { REST, Routes } = require("discord.js");

async function resetCommands(rest, applicationId, commands, output = console) {
    if (!commands.length) throw new Error("Daftar command terbaru kosong; reset dibatalkan.");
    const application = await rest.get(Routes.oauth2CurrentApplication());
    if (application.id !== applicationId) throw new Error("CLIENT_ID tidak cocok dengan BOT_TOKEN.");

    // Discover every guild before making changes. Discord returns at most 200 per page.
    const guilds = [];
    let after;
    while (true) {
        const query = new URLSearchParams({ limit: "200" });
        if (after) query.set("after", after);
        const page = await rest.get(Routes.userGuilds(), { query });
        guilds.push(...page);
        if (page.length < 200) break;
        const next = page[page.length - 1].id;
        if (next === after) throw new Error("Pagination server tidak maju; reset dibatalkan.");
        after = next;
    }

    output.log(`Reset command ${application.name} (${application.id}), ${guilds.length} server.`);
    // Bulk overwrite removes obsolete global commands without an empty-list window.
    await rest.put(Routes.applicationCommands(applicationId), { body: commands });
    const registered = await rest.get(Routes.applicationCommands(applicationId));
    const signature = list => list.map(command => `${command.type || 1}:${command.name}`).sort().join("|");
    if (signature(registered) !== signature(commands)) {
        throw new Error("Verifikasi daftar global gagal; pembersihan command server dibatalkan.");
    }

    let cleared = 0;
    for (const guild of guilds) {
        const route = Routes.applicationGuildCommands(applicationId, guild.id);
        const existing = await rest.get(route);
        if (!existing.length) continue;
        await rest.put(route, { body: [] });
        const remaining = await rest.get(route);
        if (remaining.length) throw new Error(`Command server ${guild.id} belum kosong.`);
        cleared += existing.length;
        output.log(`Dibersihkan: ${existing.length} command khusus server ${guild.id}.`);
    }
    output.log(`Selesai: ${registered.length} command global terdaftar; ${cleared} command khusus server dihapus.`);
}

async function main() {
    require("dotenv").config();
    const { BOT_TOKEN, CLIENT_ID } = process.env;
    if (!BOT_TOKEN || !/^\d{17,20}$/.test(CLIENT_ID || "")) {
        throw new Error("BOT_TOKEN dan CLIENT_ID yang valid harus tersedia.");
    }
    const fs = require("node:fs");
    const path = require("node:path");
    const { initI18n } = require("../src/i18n");
    await initI18n();
    const directory = path.join(__dirname, "../src/commands");
    const commands = fs.readdirSync(directory).filter(file => file.endsWith(".js")).map(file => {
        const command = require(path.join(directory, file));
        if (!command.data || typeof command.execute !== "function") {
            throw new Error(`Command tidak valid: ${file}; reset dibatalkan.`);
        }
        return command.data.toJSON();
    });
    await resetCommands(new REST({ version: "10" }).setToken(BOT_TOKEN), CLIENT_ID, commands);
}

if (require.main === module) {
    main().catch(error => {
        console.error(`Reset gagal: ${error.message}. Sebagian perubahan mungkin sudah diterapkan; jalankan ulang setelah penyebabnya diperbaiki.`);
        process.exitCode = 1;
    });
}

module.exports = { resetCommands };
