const {
    MessageFlags,
    AttachmentBuilder,
    ContainerBuilder,
    TextDisplayBuilder,
} = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const { getGuildData } = require("../utils/playerStore");
const { createNowPlayingContainer } = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");

module.exports = {
    data: slashMeta("nowplaying"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const player = client.riffy.players.get(interaction.guild.id);

        if (!player || !player.current) {
            const container = new ContainerBuilder();
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `${t("commands.nowplaying.emptyHeading")}\n\n` +
                    t("commands.nowplaying.emptyStatus")
                )
            );
            return interaction.reply({
                components: [container],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const guildData = getGuildData(interaction.guild.id);
        const musicardBuffer = await generateMusicCard(player.current, player, guildData);
        const container = createNowPlayingContainer(
            t,
            player.current,
            player,
            guildData,
            musicardBuffer
        );

        const files = [];
        if (musicardBuffer) {
            files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
        }

        await interaction.editReply({
            components: [container],
            files: files,
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
