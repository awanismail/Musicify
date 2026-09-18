const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, applySlashOption, getT } = require("../i18n");
const { replyError } = require("../utils/replies");
const { getGuildData } = require("../utils/playerStore");
const { persistGuildPlaybackSettings } = require("../utils/database");

module.exports = {
    data: slashMeta("volume").addIntegerOption((opt) =>
        applySlashOption(
            opt.setName("level").setRequired(true).setMinValue(0).setMaxValue(100),
            "volume",
            "level"
        )
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const player = client.riffy.players.get(interaction.guild.id);

        if (!player) {
            return replyError(interaction, { key: "errors.noActivePlayer" }, { t });
        }

        if (!interaction.member.voice?.channel) {
            return replyError(interaction, { key: "errors.voiceChannelRequired" }, { t });
        }

        const level = Math.min(100, Math.max(0, interaction.options.getInteger("level")));

        const guildData = getGuildData(interaction.guild.id);
        guildData.volume = level;
        player.setVolume(level);
        persistGuildPlaybackSettings(interaction.guild.id, guildData);

        const filled = Math.round(level / 10);
        const bar = "█".repeat(filled) + "░".repeat(10 - filled);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.volume.successHeading")}\n\n` +
                `${t("common.labels.level")}\n` +
                `${t("commands.volume.levelLine", { level })}\n\n` +
                `${t("common.labels.volume")}\n` +
                `-# ${bar}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
