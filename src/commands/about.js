const {
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const { slashMeta, getT } = require("../i18n");
const config = require("../../config");

module.exports = {
    data: slashMeta("about"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const container = new ContainerBuilder();

        const botAvatar = client.user.displayAvatarURL({ size: 256 });

        container.addSectionComponents(
            new SectionBuilder()
                .addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(t("commands.about.heading"))
                )
                .setThumbnailAccessory(
                    new ThumbnailBuilder().setURL(botAvatar)
                )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("commands.about.whatIs")}\n\n` +
                `${t("commands.about.poweredBy")}\n\n` +
                t("commands.about.features")
            )
        );

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t("commands.about.legal"))
        );

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t("commands.about.footer"))
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel(t("common.supportServer"))
                .setURL("https://discord.gg/MRjEUhDCpZ")
                .setStyle(ButtonStyle.Link),
            new ButtonBuilder()
                .setLabel(t("common.vote"))
                .setURL(config.vote.url)
                .setStyle(ButtonStyle.Link)
        );

        container.addActionRowComponents(row);

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },
};
