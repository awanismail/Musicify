const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { replyError } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("clear"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.CLEAR,
        });
        if (!ctx) return;

        const { player } = ctx;
        const queueLength = player.queue?.length || 0;

        if (queueLength === 0) {
            return replyError(interaction, t("commands.clear.alreadyEmpty"), { t });
        }

        player.queue.clear();

        const removedLine =
            queueLength === 1
                ? t("commands.clear.removedSingular", { count: queueLength })
                : t("commands.clear.removedPlural", { count: queueLength });

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.clear.successHeading")}\n\n` +
                `${t("common.labels.removed")}\n` +
                `${removedLine}\n\n` +
                `${t("common.labels.nowPlaying")}\n` +
                `-# ${player.current?.info?.title || t("common.none")}`
            )
        );

        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
