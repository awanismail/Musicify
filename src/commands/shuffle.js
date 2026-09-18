const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { replyError } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("shuffle"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.CONTROL,
        });
        if (!ctx) return;

        const { player } = ctx;

        if (player.queue.length === 0) {
            return replyError(interaction, t("commands.shuffle.emptyQueue"), { t });
        }

        player.queue.shuffle();

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.shuffle.successHeading")}\n\n` +
                `${t("common.labels.tracks")}\n` +
                t("commands.shuffle.tracksLine", { count: player.queue.length })
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
