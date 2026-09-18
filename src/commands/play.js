const { MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { slashMeta, applySlashOption, getT, translateError } = require("../i18n");
const { buildErrorContainer, buildFeedbackContainer, ephemeralV2 } = require("../utils/replies");
const { playQuery } = require("../services/playQuery");
const { maybePromptOnSlashPlay } = require("../utils/votePrompt");
const { requireVoiceForPlay } = require("../utils/playerControls");
const {
    fetchPlayAutocompleteChoices,
    resolveAutocompleteSelection,
    isYouTubeQuery,
} = require("../utils/playAutocomplete");

function scheduleSlashVotePrompt(interaction) {
    void maybePromptOnSlashPlay(
        interaction.client,
        interaction.guild,
        interaction.channel.id,
        interaction.user.id
    ).catch(() => {});
}

module.exports = {
    data: slashMeta("play").addStringOption((opt) =>
        applySlashOption(
            opt.setName("query").setRequired(true).setAutocomplete(true),
            "play",
            "query"
        )
    ),

    async autocomplete(interaction, client) {
        const choices = await fetchPlayAutocompleteChoices(client, interaction);
        await interaction.respond(choices);
    },

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const rawQuery = interaction.options.getString("query");
        const { query, track: autocompleteTrack } = resolveAutocompleteSelection(
            interaction.user.id,
            rawQuery
        );

        if (isYouTubeQuery(query)) {
            return interaction.reply(
                ephemeralV2(buildErrorContainer(t("errors.youtubeNotSupported"), t))
            );
        }

        const member = interaction.member;
        if (!(await requireVoiceForPlay(interaction, t))) {
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await playQuery(client, {
            guild: interaction.guild,
            member,
            query,
            resolvedTrack: autocompleteTrack,
            textChannelId: interaction.channel.id,
            source: "slash",
            t,
        });

        if (!result.ok) {
            if (result.type === "duplicate" || result.type === "queue_limit") {
                return interaction.editReply(
                    ephemeralV2(
                        buildFeedbackContainer(
                            `${result.type === "duplicate" ? t("duplicate.heading") : t("errors.queueLimitHeading")}\n\n-# ${translateError(t, result.error)}`
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

            if (result.queueLimitSkipped) {
                content += `\n\n${t("commands.play.queueLimitSkipped", {
                    count: result.queueLimitSkipped,
                })}`;
            }

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            scheduleSlashVotePrompt(interaction);
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

        scheduleSlashVotePrompt(interaction);
        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
