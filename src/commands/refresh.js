const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { getAppSetting, setAppSetting } = require("../db/appSettings");

const SETTING = "lavalink_force_refresh";

module.exports = {
    data: new SlashCommandBuilder()
        .setName("refresh")
        .setDescription("Atur refresh koneksi audio global (khusus pemilik bot).")
        .addSubcommand(command => command.setName("enable").setDescription("Aktifkan refresh paksa setiap 30 menit."))
        .addSubcommand(command => command.setName("disable").setDescription("Matikan refresh paksa agar standby tidak terganggu."))
        .addSubcommand(command => command.setName("status").setDescription("Lihat pengaturan refresh koneksi audio.")),

    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const application = await client.application.fetch();
        // Team-owned applications use the team's owner, not every team member.
        const ownerId = application.owner?.ownerId || application.owner?.id;
        if (!ownerId || interaction.user.id !== ownerId) {
            await interaction.editReply("Command ini hanya bisa digunakan oleh pemilik bot.");
            return;
        }

        const action = interaction.options.getSubcommand();
        if (action === "enable" || action === "disable") {
            setAppSetting(SETTING, String(action === "enable"));
        }
        const enabled = getAppSetting(SETTING) === "true";
        await interaction.editReply(
            `Refresh paksa: **${enabled ? "aktif" : "nonaktif"}**.\n` +
            "Pengaturan ini berlaku untuk seluruh bot dan tersimpan setelah restart.\n" +
            (enabled
                ? "Koneksi audio akan di-refresh pada pemeriksaan berkala setiap 30 menit sejak bot menyala. Bot bisa keluar-masuk channel meski mode standby aktif. Mengaktifkan ini tidak langsung memutus koneksi."
                : "Koneksi sehat tetap tersambung. Pemulihan otomatis saat koneksi putus tetap berjalan.")
        );
    },
};
