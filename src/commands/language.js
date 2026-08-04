const {
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const { getGuildSettings, setGuildSetting, deleteGuildSetting } = require("../utils/database");
const {
    slashMeta,
    getT,
    SUPPORTED_LANGUAGES,
    LANGUAGE_ORDER,
    resolveGuildLocale,
} = require("../i18n");
const { refreshChatPlayPlayer } = require("../services/chatPlayPlayer");
const { buildFeedbackContainer, ephemeralV2, safeInteractionUpdate } = require("../utils/replies");

function buildLanguageButtons(t, settings) {
    const isAuto = !settings.locale;
    const rows = [];

    const autoRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("lang_auto")
            .setLabel(t("commands.language.buttons.auto"))
            .setStyle(isAuto ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );
    rows.push(autoRow);

    const langRow = new ActionRowBuilder();
    for (const code of LANGUAGE_ORDER) {
        const { nativeLabel } = SUPPORTED_LANGUAGES[code];
        const isSelected = !isAuto && settings.locale === code;
        langRow.addComponents(
            new ButtonBuilder()
                .setCustomId(`lang_${code}`)
                .setLabel(nativeLabel)
                .setStyle(isSelected ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );
    }
    rows.push(langRow);

    return rows;
}

function buildLanguageContainer(guildId, client, t, { editable = true } = {}) {
    const settings = getGuildSettings(guildId);
    const effectiveLocale = resolveGuildLocale(guildId, client);

    const isAuto = !settings.locale;
    const languageName = SUPPORTED_LANGUAGES[effectiveLocale]?.nativeLabel || effectiveLocale;
    const currentLine = isAuto
        ? t("commands.language.currentAuto", { language: languageName })
        : t("commands.language.current", { language: languageName });

    let content =
        `${t("commands.language.heading")}\n\n` +
        `${t("commands.language.description")}\n\n` +
        currentLine;

    if (!editable) {
        content += `\n\n${t("commands.language.viewOnlyNote")}`;
    }

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));

    if (editable) {
        for (const row of buildLanguageButtons(t, settings)) {
            container.addActionRowComponents(row);
        }
    }

    return container;
}

async function handleLanguageButton(client, interaction) {
    const t = getT(interaction, client);

    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply(
            ephemeralV2(buildFeedbackContainer(t("commands.language.permissionDenied")))
        );
    }

    const guildId = interaction.guild.id;
    let messageKey;
    let locale;

    if (interaction.customId === "lang_auto") {
        deleteGuildSetting(guildId, "locale");
        locale = resolveGuildLocale(guildId, client);
        messageKey = "commands.language.resetSuccess";
    } else if (interaction.customId.startsWith("lang_")) {
        const code = interaction.customId.slice(5);
        if (!SUPPORTED_LANGUAGES[code]) return;

        setGuildSetting(guildId, "locale", code);
        locale = code;
        messageKey = "commands.language.setSuccess";
    } else {
        return;
    }

    const languageName = SUPPORTED_LANGUAGES[locale]?.nativeLabel || locale;

    const updated = await safeInteractionUpdate(
        interaction,
        {
            components: [buildLanguageContainer(guildId, client, t, { editable: true })],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        },
        t
    );
    if (!updated) return;

    refreshChatPlayPlayer(client, guildId).catch((err) => {
        console.error("[Musicify] Failed to refresh ChatPlay after language change:", err.message);
    });

    await interaction.followUp(
        ephemeralV2(buildFeedbackContainer(t(messageKey, { language: languageName })))
    );
}

function isLanguageButton(customId) {
    if (customId === "lang_auto") return true;
    if (!customId.startsWith("lang_")) return false;
    return Boolean(SUPPORTED_LANGUAGES[customId.slice(5)]);
}

module.exports = {
    data: slashMeta("language"),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        const editable = interaction.memberPermissions.has(PermissionFlagsBits.Administrator);

        await interaction.reply(
            ephemeralV2(buildLanguageContainer(interaction.guild.id, client, t, { editable }))
        );
    },

    buildLanguageContainer,
    handleLanguageButton,
    isLanguageButton,
};
