const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { slashMeta, getT, applySlashOption, buildSlashChoice } = require("../i18n");
const { buildErrorContainer, ephemeralV2 } = require("../utils/replies");

const LOOP_CHOICE_KEYS = { none: "off", track: "track", queue: "queue" };
const LOOP_EMOJIS = { none: "➡️", track: "🔂", queue: "🔁" };

module.exports = {
    data: slashMeta("loop").addStringOption((opt) =>
        applySlashOption(
            opt
                .setName("mode")
                .setRequired(true)
                .addChoices(
                    buildSlashChoice("loop", "mode", "off", "none"),
                    buildSlashChoice("loop", "mode", "track", "track"),
                    buildSlashChoice("loop", "mode", "queue", "queue")
                ),
            "loop",
            "mode"
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

        if (!interaction.member.voice?.channel) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("errors.voiceChannelRequired"), t))
            );
        }

        const mode = interaction.options.getString("mode");
        const guildData = getGuildData(interaction.guild.id);
        guildData.loop = mode;
        player.setLoop(mode);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.loop.successHeading", { emoji: LOOP_EMOJIS[mode] })}\n\n` +
                    `${t("common.labels.mode")}\n` +
                    `-# ${t(`slash.loop.choices.mode.${LOOP_CHOICE_KEYS[mode]}`)}`
            )
        );
        await interaction.reply({
            components: [container],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },
};
