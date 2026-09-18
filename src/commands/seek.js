const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { formatDuration } = require("../utils/components");
const { slashMeta, getT, applySlashOption } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");
const { requirePlayerControl } = require("../utils/playerControls");
const { PLAYER_ACTIONS } = require("../utils/permissions");

module.exports = {
    data: slashMeta("seek").addStringOption((opt) =>
        applySlashOption(opt.setName("time").setRequired(true), "seek", "time")
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const ctx = await requirePlayerControl(interaction, client, t, {
            action: PLAYER_ACTIONS.CONTROL,
            requireCurrent: true,
        });
        if (!ctx) return;

        const { player } = ctx;
        const timeStr = interaction.options.getString("time");
        let ms = 0;

        if (timeStr.includes(":")) {
            const parts = timeStr.split(":").map(Number);
            if (parts.length === 2) {
                ms = (parts[0] * 60 + parts[1]) * 1000;
            } else if (parts.length === 3) {
                ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
            }
        } else {
            ms = parseInt(timeStr, 10) * 1000;
        }

        if (isNaN(ms) || ms < 0) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("commands.seek.invalidFormat"), t))
            );
        }

        if (ms > player.current.info.length) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        t("commands.seek.pastDuration", {
                            duration: formatDuration(player.current.info.length),
                        }),
                        t
                    )
                )
            );
        }

        player.seek(ms);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.seek.successHeading")}\n\n` +
                    `${t("common.labels.position")}\n` +
                    `${t("commands.seek.positionLine", {
                        current: formatDuration(ms),
                        total: formatDuration(player.current.info.length),
                    })}\n\n` +
                    `${t("common.labels.track")}\n` +
                    `-# ${player.current.info.title}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
