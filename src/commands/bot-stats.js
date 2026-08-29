const {
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SectionBuilder,
    ThumbnailBuilder,
} = require("discord.js");
const { slashMeta, getT } = require("../i18n");

module.exports = {
    data: slashMeta("stats"),

    async execute(interaction, client) {
        const t = getT.brandFromInteraction(interaction, client);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const container = new ContainerBuilder();

        const header = new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(t("commands.stats.heading"))
            )
            .setThumbnailAccessory(
                new ThumbnailBuilder().setURL(
                    client.user.displayAvatarURL({ size: 128 })
                )
            );

        container.addSectionComponents(header);

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        const uptimeSeconds = process.uptime();
        const startTime = new Date(Date.now() - uptimeSeconds * 1000);
        const startTimestamp = Math.floor(startTime.getTime() / 1000);

        const mem = process.memoryUsage();
        const memUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const memTotal = (mem.heapTotal / 1024 / 1024).toFixed(1);
        const memRSS = (mem.rss / 1024 / 1024).toFixed(1);

        const totalGuilds = client.guilds.cache.size;
        const totalUsers = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
        const totalChannels = client.channels.cache.size;
        const activePlayers = client.riffy.players?.size || 0;
        const totalNodes = client.riffy.nodes?.length || client.riffy.nodes?.size || 0;

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.stats.botId")}\n` +
                    `-# \`${client.user.id}\`\n` +
                    `${t("commands.stats.uptime")}\n` +
                    `-# <t:${startTimestamp}:f> (<t:${startTimestamp}:R>)\n` +
                    `${t("commands.stats.uptimeTimezoneNote")}\n` +
                    `${t("commands.stats.ping")}\n` +
                    `-# ${client.ws.ping}ms\n` +
                    `${t("commands.stats.runtime")}\n` +
                    `-# [Node.js ${process.version}](https://nodejs.org/) · [discord.js v${require("discord.js").version}](https://discord.js.org/)`
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.stats.guilds")}\n` +
                    `-# ${totalGuilds.toLocaleString()}\n` +
                    `${t("commands.stats.users")}\n` +
                    `-# ${totalUsers.toLocaleString()}\n` +
                    `${t("commands.stats.channels")}\n` +
                    `-# ${totalChannels.toLocaleString()}\n` +
                    `${t("commands.stats.activePlayers")}\n` +
                    `-# ${activePlayers}\n` +
                    `${t("commands.stats.lavalinkNodes")}\n` +
                    `-# ${totalNodes}`
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.stats.heapUsed")}\n` +
                    `-# ${memUsed} MB\n` +
                    `${t("commands.stats.heapTotal")}\n` +
                    `-# ${memTotal} MB\n` +
                    `${t("commands.stats.rss")}\n` +
                    `-# ${memRSS} MB`
            )
        );

        await interaction.editReply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
