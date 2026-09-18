const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { replyError } = require("../utils/replies");

module.exports = {
    data: slashMeta("skip"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const player = client.riffy.players.get(interaction.guild.id);

        if (!player) {
            return replyError(interaction, { key: "errors.noActivePlayer" }, { t });
        }

        if (!interaction.member.voice?.channel) {
            return replyError(interaction, { key: "errors.voiceChannelRequired" }, { t });
        }

        const skippedTitle = player.current?.info?.title || t("common.unknown");
        player.stop();

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.skip.successHeading")}\n\n` +
                `${t("common.labels.track")}\n` +
                `-# ${skippedTitle}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
