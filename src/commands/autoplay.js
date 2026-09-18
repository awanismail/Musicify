const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT, applySlashOption, buildSlashChoice } = require("../i18n");
const { requirePlayerControl } = require("../utils/playerControls");
const { persistGuildPlaybackSettings } = require("../utils/database");
const { refreshPlayerMessage } = require("../handlers/playerHandler");

module.exports = {
    data: slashMeta("autoplay").addStringOption((opt) =>
        applySlashOption(
            opt
                .setName("mode")
                .setRequired(false)
                .addChoices(
                    buildSlashChoice("autoplay", "mode", "on", "on"),
                    buildSlashChoice("autoplay", "mode", "off", "off")
                ),
            "autoplay",
            "mode"
        )
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t);
        if (!ctx) return;

        const { guildData } = ctx;
        const mode = interaction.options.getString("mode");

        if (mode === "on") {
            guildData.autoplay = true;
        } else if (mode === "off") {
            guildData.autoplay = false;
        } else {
            guildData.autoplay = !guildData.autoplay;
        }

        persistGuildPlaybackSettings(interaction.guild.id, guildData);
        refreshPlayerMessage(client, interaction.guild.id).catch(() => {});

        const status = guildData.autoplay ? t("common.on") : t("common.off");
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.autoplay.successHeading")}\n\n` +
                    `${t("common.labels.status")}\n` +
                    t("commands.autoplay.statusLine", { status })
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
