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
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require("discord.js");
const { getT, slashMeta } = require("../i18n");
const { resolveBotAvatarUrl, maybeAppendBrandWatermark, hasCustomGuildBranding, getBrandWatermarkContent } = require("../utils/guildBranding");
const config = require("../../config");

const PAGE_KEYS = ["home", "music", "filters", "controls", "troubleshoot", "support"];

const PAGE_EMOJIS = {
    home: "🏠",
    music: "🎶",
    filters: "🎛️",
    controls: "🎮",
    troubleshoot: "🛠️",
    support: "🤝",
};

function buildCmdParams(getCmd) {
    return {
        cmdPlay: getCmd("play"),
        cmdSkip: getCmd("skip"),
        cmdPrevious: getCmd("previous"),
        cmdSkipto: getCmd("skipto"),
        cmdPause: getCmd("pause"),
        cmdReplay: getCmd("replay"),
        cmdStop: getCmd("stop"),
        cmdNowplaying: getCmd("nowplaying"),
        cmdSeek: getCmd("seek"),
        cmdQueue: getCmd("queue"),
        cmdRemove: getCmd("remove"),
        cmdMove: getCmd("move"),
        cmdShuffle: getCmd("shuffle"),
        cmdLoop: getCmd("loop"),
        cmdAutoplay: getCmd("autoplay"),
        cmdVolume: getCmd("volume"),
        cmd247: getCmd("247"),
        cmdFilter: getCmd("filter"),
        cmdChatplay: getCmd("chatplay"),
        cmdAbout: getCmd("about"),
        cmdStats: getCmd("stats"),
        cmdStatus: getCmd("status"),
        cmdHelp: getCmd("help"),
        cmdLanguage: getCmd("language"),
        cmdProfile: getCmd("profile", "set"),
    };
}

/**
 * Build the dropdown select menu
 */
function buildDropdown(activePage, t) {
    const menu = new StringSelectMenuBuilder()
        .setCustomId("help_select")
        .setPlaceholder(t("help.placeholder"))
        .setMinValues(1)
        .setMaxValues(1);

    for (const key of PAGE_KEYS) {
        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(t(`help.pages.${key}.label`))
                .setDescription(t(`help.pages.${key}.description`))
                .setEmoji(PAGE_EMOJIS[key])
                .setValue(key)
                .setDefault(key === activePage)
        );
    }

    return new ActionRowBuilder().addComponents(menu);
}

/**
 * Build the full container for a given page
 */
async function buildHelpPage(client, page = "home", t, guild = null) {
    const container = new ContainerBuilder();

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t("help.header"))
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(
                resolveBotAvatarUrl(guild, client, { size: 128 })
            )
        );

    container.addSectionComponents(section);
    container.addActionRowComponents(buildDropdown(page, t));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    let commands;
    try {
        commands = await client.application.commands.fetch();
    } catch (e) {
        commands = null;
    }

    const getCmd = (name, subcommand = null) => {
        const cmd = commands?.find((c) => c.name === name);
        if (!cmd) return subcommand ? `\`/${name} ${subcommand}\`` : `\`/${name}\``;
        return subcommand ? `</${name} ${subcommand}:${cmd.id}>` : `</${name}:${cmd.id}>`;
    };

    const cmd = buildCmdParams(getCmd);

    switch (page) {
        case "home":
            addHomePage(container, t, cmd, guild, client);
            break;
        case "music":
            addMusicPage(container, t, cmd);
            break;
        case "filters":
            addFiltersPage(container, t, cmd);
            break;
        case "controls":
            addControlsPage(container, t, cmd);
            break;
        case "troubleshoot":
            addTroubleshootPage(container, t, cmd);
            break;
        case "support":
            addSupportPage(container, t, cmd);
            break;
        default:
            addHomePage(container, t, cmd, guild, client);
    }

    if (page !== "home") {
        maybeAppendBrandWatermark(container, t, guild, client);
    }
    return container;
}

function addHomePage(container, t, cmd, guild = null, client = null) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.home.welcome"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            t("help.home.quickStart", {
                cmdPlay: cmd.cmdPlay,
                platforms: t("common.supportedPlatforms"),
            })
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.home.features"))
    );

    const footerText = hasCustomGuildBranding(guild, client)
        ? getBrandWatermarkContent(t, client)
        : t("help.home.openSource");

    const footerSection = new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(footerText))
        .setButtonAccessory(
            new ButtonBuilder()
                .setLabel(t("common.vote"))
                .setURL(config.vote.url)
                .setStyle(ButtonStyle.Link)
        );

    container.addSectionComponents(footerSection);
}

function addMusicPage(container, t, cmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.music.heading"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.music.list", cmd))
    );
}

function addFiltersPage(container, t, cmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            t("help.filters.heading", { cmdFilter: cmd.cmdFilter })
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.filters.presets"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("help.filters.chatplayHeading")}\n\n` +
                `${t("help.filters.chatplaySetup", { cmdChatplay: cmd.cmdChatplay })}\n\n` +
                t("help.filters.chatplayUsage")
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("help.filters.247Heading")}\n\n` +
                `${t("help.filters.247Toggle", { cmd247: cmd.cmd247, cmdStop: cmd.cmdStop })}\n\n` +
                t("help.filters.247HowItWorks")
        )
    );
}

function addControlsPage(container, t, cmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.controls.heading"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.controls.row1", cmd))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.controls.row2", cmd))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.controls.slashExtras", cmd))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.controls.suggestions"))
    );
}

function addTroubleshootPage(container, t, cmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.troubleshoot.heading"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("help.troubleshoot.wontPlay", {
                platforms: t("common.supportedPlatforms"),
            })}\n\n` + t("help.troubleshoot.joinsLeaves")
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("help.troubleshoot.noSound", { cmdVolume: cmd.cmdVolume, cmdPause: cmd.cmdPause })}\n\n` +
                `${t("help.troubleshoot.chatplayNotResponding", { cmdChatplay: cmd.cmdChatplay })}\n\n` +
                `${t("help.troubleshoot.noActivePlayer", { cmdPlay: cmd.cmdPlay })}\n\n` +
                `${t("help.troubleshoot.language", { cmdLanguage: cmd.cmdLanguage })}\n\n` +
                `${t("help.troubleshoot.languageAuto", { cmdLanguage: cmd.cmdLanguage })}\n\n` +
                `${t("help.troubleshoot.languageCommunity", { cmdLanguage: cmd.cmdLanguage })}\n\n` +
                `${t("help.troubleshoot.profilePermission", { cmdProfile: cmd.cmdProfile })}\n\n` +
                `${t("help.troubleshoot.profileNotUpdating", { cmdProfile: cmd.cmdProfile })}\n\n` +
                t("help.troubleshoot.profileImageFailed", { cmdProfile: cmd.cmdProfile })
        )
    );
}

function addSupportPage(container, t, cmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.support.heading"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.support.needHelp"))
    );

    const supportButton = new ButtonBuilder()
        .setLabel(t("help.support.joinSupportServer"))
        .setURL("https://discord.gg/MRjEUhDCpZ")
        .setStyle(ButtonStyle.Link);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(supportButton));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.support.reportBug"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            t("help.support.botInfo", {
                cmdStats: cmd.cmdStats,
                cmdStatus: cmd.cmdStatus,
                cmdHelp: cmd.cmdHelp,
            })
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("help.support.footer"))
    );
}

module.exports = {
    data: slashMeta("help"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const container = await buildHelpPage(client, "home", t, interaction.guild);

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },

    buildHelpPage,
};
