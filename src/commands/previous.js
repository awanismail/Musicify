const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { requirePlayerControl, playPreviousTrack } = require("../utils/playerControls");
const { replyError } = require("../utils/replies");

module.exports = {
    data: slashMeta("previous"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, { requireCurrent: true });
        if (!ctx) return;

        const { player, guildData } = ctx;
        const result = playPreviousTrack(player, guildData);

        if (!result.ok) {
            return replyError(interaction, { key: "commands.previous.emptyHistory" }, { t });
        }

        const title = result.title || t("common.unknown");
        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.previous.successHeading")}\n\n` +
                    `${t("common.labels.track")}\n` +
                    t("commands.previous.trackLine", { title })
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
