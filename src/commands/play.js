const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, applySlashOption, getT, translateError } = require("../i18n");
const { buildErrorContainer, buildFeedbackContainer, ephemeralV2 } = require("../utils/replies");
const { playQuery, isYouTubeQuery } = require("../services/playQuery");

module.exports = {
    data: slashMeta("play").addStringOption((opt) =>
        applySlashOption(opt.setName("query").setRequired(true), "play", "query")
    ),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const query = interaction.options.getString("query");

        if (isYouTubeQuery(query)) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("errors.youtubeNotSupported"), t))
            );
        }

        const member = interaction.member;
        if (!member.voice?.channel) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("errors.voiceChannelRequiredFormatted"), t))
            );
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await playQuery(client, {
            guild: interaction.guild,
            member,
            query,
            textChannelId: interaction.channel.id,
            source: "slash",
            t,
        });

        if (!result.ok) {
            if (result.type === "duplicate") {
                return interaction.editReply(
                    ephemeralV2(
                        buildFeedbackContainer(
                            `${t("duplicate.heading")}\n\n-# ${translateError(t, result.error)}`
                        )
                    )
                );
            }

            const isSoft =
                result.type === "lavalink_down" || result.type === "vc_mismatch";
            const message = translateError(t, result.error);
            const container = isSoft
                ? buildFeedbackContainer(message)
                : buildErrorContainer(message, t);
            return interaction.editReply(ephemeralV2(container));
        }

        if (result.type === "playlist") {
            let content =
                `${t("commands.play.playlistHeading")}\n\n` +
                `**${result.playlistName || t("common.playlist")}**\n\n` +
                `${t("commands.play.tracksLine", {
                    addedCount: result.addedCount,
                    totalCount: result.totalCount,
                })}`;

            if (result.duplicates.length > 0) {
                content += `\n\n${t("commands.play.duplicatesSkipped", {
                    count: result.duplicates.length,
                })}`;
            }

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            return interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        const positionLine = result.queuePosition
            ? t("player.inQueue", { position: result.queuePosition })
            : t("player.startingPlayback");

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.play.trackHeading")}\n\n` +
                `${t("common.labels.title")}\n` +
                `-# ${result.title}\n\n` +
                `${t("common.labels.artist")}\n` +
                `-# ${result.author}\n\n` +
                `${t("common.labels.position")}\n` +
                positionLine
            )
        );
        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
