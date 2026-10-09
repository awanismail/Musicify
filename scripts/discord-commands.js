const { REST, Routes } = require("discord.js");

function parseArgs(args) {
    const options = { guildId: null, deleteIds: [], apply: false };
    const seen = new Set();
    for (let i = 0; i < args.length; i++) {
        const flag = args[i];
        if (seen.has(flag)) throw new Error(`Opsi berulang: ${flag}`);
        seen.add(flag);
        if (flag === "--apply") options.apply = true;
        else if (flag === "--guild") options.guildId = args[++i];
        else if (flag === "--delete") options.deleteIds = (args[++i] || "").split(",");
        else throw new Error(`Opsi tidak dikenal: ${flag}`);
    }
    const isId = value => typeof value === "string" && /^\d{17,20}$/.test(value);
    if (!isId(options.guildId)) throw new Error("Sertakan --guild ID_SERVER yang valid.");
    if (options.deleteIds.some(id => !isId(id))) throw new Error("--delete harus berisi ID command, dipisahkan koma.");
    options.deleteIds = [...new Set(options.deleteIds)];
    if (options.apply && !options.deleteIds.length) throw new Error("--apply memerlukan --delete ID_COMMAND.");
    return options;
}

async function run(rest, applicationId, options, output = console) {
    const application = await rest.get(Routes.oauth2CurrentApplication());
    if (application.id !== applicationId) throw new Error("CLIENT_ID tidak cocok dengan aplikasi pemilik BOT_TOKEN.");
    output.log(`Bot: ${application.name} (${application.id}); server: ${options.guildId}`);
    const [globalCommands, guildCommands] = await Promise.all([
        rest.get(Routes.applicationCommands(applicationId)),
        rest.get(Routes.applicationGuildCommands(applicationId, options.guildId)),
    ]);
    const rows = (commands, scope) => commands.map(command => ({
        scope, id: command.id, name: command.name, type: command.type,
        description: command.description || "",
        options: (command.options || []).map(option => option.name).join(", "),
    }));
    output.table([...rows(globalCommands, "global"), ...rows(guildCommands, "server")]);
    output.log("Nama yang sama belum tentu usang. Periksa scope, ID, dan opsi sebelum menghapus.");
    const targets = options.deleteIds.map(id => {
        const command = guildCommands.find(item => item.id === id);
        if (!command) throw new Error(`ID ${id} bukan command khusus server ini. Tidak ada penghapusan dilakukan.`);
        return command;
    });
    if (!targets.length) return;
    output.log("Target penghapusan command khusus server:");
    output.table(rows(targets, "server"));
    if (!options.apply) {
        output.log("Pratinjau saja. Tambahkan --apply untuk menghapus ID di atas. Command global tetap tersimpan.");
        return;
    }
    for (const command of targets) {
        await rest.delete(Routes.applicationGuildCommand(applicationId, options.guildId, command.id));
        output.log(`Dihapus: ${command.name} (${command.id})`);
    }
    const remaining = await rest.get(Routes.applicationGuildCommands(applicationId, options.guildId));
    if (remaining.some(command => options.deleteIds.includes(command.id))) {
        throw new Error("Verifikasi gagal: masih ada ID target yang terdaftar. Jalankan pemeriksaan ulang.");
    }
    output.log("Selesai: seluruh ID target sudah tidak terdaftar di server ini.");
}

if (require.main === module) {
    require("dotenv").config();
    (async () => {
        const options = parseArgs(process.argv.slice(2));
        const { BOT_TOKEN, CLIENT_ID } = process.env;
        if (!BOT_TOKEN || !/^\d{17,20}$/.test(CLIENT_ID || "")) {
            throw new Error("BOT_TOKEN dan CLIENT_ID yang valid harus tersedia.");
        }
        await run(new REST({ version: "10" }).setToken(BOT_TOKEN), CLIENT_ID, options);
    })().catch(error => {
        console.error(`Gagal: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, run };
