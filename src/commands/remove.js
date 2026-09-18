const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, getT, applySlashOption } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("remove").addIntegerOption((opt) =>
        applySlashOption(
            opt.setName("position").setRequired(true).setMinValue(1),
            "remove",
            "position"
        )
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const player = client.riffy.players.get(interaction.guild.id);
        if (!player) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("errors.noActivePlayer"), t))
            );
        }

        const pos = interaction.options.getInteger("position");
        if (pos > player.queue.length) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        t("commands.remove.invalidPosition", { count: player.queue.length }),
                        t
                    )
                )
            );
        }

        const trackToRemove = player.queue[pos - 1];
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.REMOVE,
            track: trackToRemove,
        });
        if (!ctx) return;

        const removed = player.queue.splice(pos - 1, 1);
        const trackName = removed[0]?.info?.title || t("common.unknown");

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.remove.successHeading")}\n\n` +
                    `${t("common.labels.track")}\n` +
                    `-# ${trackName}\n\n` +
                    `${t("commands.remove.wasAt", { position: pos })}\n\n` +
                    t("commands.remove.queueRemaining", { count: player.queue.length })
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
