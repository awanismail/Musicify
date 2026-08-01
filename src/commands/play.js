const { SlashCommandBuilder, MessageFlags, ContainerBuilder, TextDisplayBuilder } = require("discord.js");
const { buildErrorContainer, buildFeedbackContainer, ephemeralV2 } = require("../utils/replies");
const { playQuery } = require("../services/playQuery");

module.exports = {
    data: new SlashCommandBuilder()
        .setName("play")
        .setDescription("Play a song or add it to the queue")
        .addStringOption((opt) =>
            opt.setName("query").setDescription("Song name or URL").setRequired(true)
        ),

    async execute(interaction, client) {
        const query = interaction.options.getString("query");

        if (/(?:youtube\.com|youtu\.be)/i.test(query)) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer(
                        "**YouTube not supported**\n-# YouTube links are currently not supported."
                    )
                )
            );
        }

        const member = interaction.member;
        if (!member.voice?.channel) {
            return interaction.reply(
                ephemeralV2(
                    buildErrorContainer("**Voice channel required**\n-# Join a voice channel first.")
                )
            );
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const result = await playQuery(client, {
            guild: interaction.guild,
            member,
            query,
            textChannelId: interaction.channel.id,
            source: "slash",
        });

        if (!result.ok) {
            const isSoft =
                result.type === "lavalink_down" ||
                result.type === "vc_mismatch" ||
                result.type === "duplicate";
            let container;
            if (result.type === "duplicate") {
                container = buildFeedbackContainer(
                    `### ⚠️ Duplicate track\n\n-# ${result.message}`
                );
            } else {
                container = isSoft
                    ? buildFeedbackContainer(result.message)
                    : buildErrorContainer(result.message);
            }
            return interaction.editReply(ephemeralV2(container));
        }

        if (result.type === "playlist") {
            let content =
                "### ✅ Playlist Added\n\n" +
                `**${result.playlistName}**\n\n` +
                "**Tracks**\n" +
                `-# ${result.addedCount} of ${result.totalCount} songs added to queue`;

            if (result.duplicates.length > 0) {
                content += `\n\n**Duplicates Skipped**\n-# ${result.duplicates.length} songs already in queue`;
            }

            const container = new ContainerBuilder();
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
            return interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
            });
        }

        let positionLine = "-# Starting playback now";
        if (result.queuePosition) {
            positionLine = `-# #${result.queuePosition} in queue`;
        }

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### ✅ Track Added\n\n" +
                "**Title**\n" +
                `-# ${result.title}\n\n` +
                "**Artist**\n" +
                `-# ${result.author}\n\n` +
                "**Position**\n" +
                positionLine
            )
        );
        return interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
