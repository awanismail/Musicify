const path = require("path");
const fs = require("fs");
const i18next = require("i18next");
const Backend = require("i18next-fs-backend");
const { SlashCommandBuilder } = require("discord.js");
const { getGuildSettings } = require("../utils/database");

const LOCALES_DIR = path.join(__dirname, "locales");

const SUPPORTED_LANGUAGES = {
    en: { label: "English", nativeLabel: "English", discordLocale: "en-US" },
    es: { label: "Spanish", nativeLabel: "Español", discordLocale: "es-ES" },
    pt: { label: "Portuguese (Brazil)", nativeLabel: "Português", discordLocale: "pt-BR" },
    fr: { label: "French", nativeLabel: "Français", discordLocale: "fr" },
    de: { label: "German", nativeLabel: "Deutsch", discordLocale: "de" },
};

const LANGUAGE_ORDER = ["en", "es", "pt", "fr", "de"];

const SUPPORTED_LNGS = Object.keys(SUPPORTED_LANGUAGES);

const VOICE_ERROR_KEYS = {
    NO_VC: "errors.voicePermissions.noVc",
    USER_CONNECT: "errors.voicePermissions.userConnect",
    BOT_MISSING: "errors.voicePermissions.botMissing",
    BOT_VIEW: "errors.voicePermissions.botView",
    BOT_CONNECT: "errors.voicePermissions.botConnect",
    BOT_SPEAK: "errors.voicePermissions.botSpeak",
};

let initialized = false;

function normalizeLocale(discordLocale) {
    if (!discordLocale) return "en";
    const lower = discordLocale.toLowerCase();
    if (lower.startsWith("pt")) return "pt";
    if (lower.startsWith("es")) return "es";
    const base = lower.split("-")[0];
    if (SUPPORTED_LNGS.includes(base)) return base;
    return "en";
}

function resolveLocale(interaction, client) {
    if (interaction?.guildId) {
        const settings = getGuildSettings(interaction.guildId);
        if (settings.locale && SUPPORTED_LNGS.includes(settings.locale)) {
            return settings.locale;
        }
        if (interaction.locale) {
            return normalizeLocale(interaction.locale);
        }
        if (interaction.guildLocale) {
            return normalizeLocale(interaction.guildLocale);
        }
        return "en";
    }
    return normalizeLocale(interaction?.locale);
}

function resolveGuildLocale(guildId, client, guild = null) {
    const settings = getGuildSettings(guildId);
    if (settings.locale && SUPPORTED_LNGS.includes(settings.locale)) {
        return settings.locale;
    }
    const resolvedGuild = guild ?? client?.guilds?.cache?.get(guildId);
    if (resolvedGuild?.preferredLocale) {
        return normalizeLocale(resolvedGuild.preferredLocale);
    }
    return "en";
}

function isGuildLocaleAuto(guildId) {
    const settings = getGuildSettings(guildId);
    return !settings.locale || !SUPPORTED_LNGS.includes(settings.locale);
}

function t(locale, key, params = {}) {
    return i18next.t(key, { lng: locale, ...params });
}

function getT(interaction, client) {
    const locale = resolveLocale(interaction, client);
    return (key, params) => t(locale, key, params);
}

getT.forGuild = (guildId, client, guild = null) => {
    const locale = resolveGuildLocale(guildId, client, guild);
    return (key, params) => t(locale, key, params);
};

function tEn(key, params = {}) {
    return t("en", key, params);
}

function loadLocaleFiles() {
    return fs
        .readdirSync(LOCALES_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => path.basename(f, ".json"))
        .filter((lng) => lng !== "en");
}

const DISCORD_DESC_MAX = 100;

function clampDiscordText(text, max = DISCORD_DESC_MAX) {
    if (!text || text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
}

function buildLocalizations(keyPath) {
    const localizations = {};
    for (const lng of loadLocaleFiles()) {
        const discordLocale = SUPPORTED_LANGUAGES[lng]?.discordLocale || lng;
        const value = i18next.t(keyPath, { lng });
        if (value && value !== keyPath) {
            localizations[discordLocale] = clampDiscordText(value);
        }
    }
    return Object.keys(localizations).length ? localizations : undefined;
}

function slashMeta(name) {
    const builder = new SlashCommandBuilder().setName(name);
    const descKey = `slash.${name}.description`;
    builder.setDescription(tEn(descKey));
    const descLocs = buildLocalizations(descKey);
    if (descLocs) builder.setDescriptionLocalizations(descLocs);
    return builder;
}

function slashOptionKey(commandName, optionName) {
    return `slash.${commandName}.options.${optionName}`;
}

function slashChoiceKey(commandName, optionName, choiceName) {
    return `slash.${commandName}.choices.${optionName}.${choiceName}`;
}

function slashOptionDescription(commandName, optionName) {
    return tEn(slashOptionKey(commandName, optionName));
}

function applySlashOption(option, commandName, optionName) {
    const key = slashOptionKey(commandName, optionName);
    option.setDescription(tEn(key));
    const locs = buildLocalizations(key);
    if (locs) option.setDescriptionLocalizations(locs);
    return option;
}

function slashChoiceLabel(commandName, optionName, choiceName) {
    return tEn(slashChoiceKey(commandName, optionName, choiceName));
}

function buildSlashChoice(commandName, optionName, choiceName, value) {
    const key = slashChoiceKey(commandName, optionName, choiceName);
    const choice = { name: tEn(key), value };
    const locs = buildLocalizations(key);
    if (locs) choice.name_localizations = locs;
    return choice;
}

function translateError(translator, error) {
    if (!error) return translator("errors.unexpected");
    if (typeof error === "string") return error;
    if (error.key) {
        const params = { ...(error.params || {}) };
        if (error.needsFallbackName && !params.name) {
            params.name = translator("common.anotherVoiceChannel");
        }
        return translator(error.key, params);
    }
    if (error.code && VOICE_ERROR_KEYS[error.code]) {
        return translator(VOICE_ERROR_KEYS[error.code]);
    }
    return translator("errors.unexpected");
}

translateError.play = translateError;

async function initI18n() {
    if (initialized) return i18next;

    await i18next.use(Backend).init({
        lng: "en",
        fallbackLng: "en",
        supportedLngs: SUPPORTED_LNGS,
        preload: SUPPORTED_LNGS,
        ns: ["translation"],
        defaultNS: "translation",
        keySeparator: ".",
        interpolation: { escapeValue: false },
        backend: {
            loadPath: path.join(LOCALES_DIR, "{{lng}}.json"),
        },
    });

    initialized = true;
    return i18next;
}

module.exports = {
    initI18n,
    getT,
    t,
    tEn,
    slashMeta,
    slashOptionDescription,
    applySlashOption,
    slashChoiceLabel,
    buildSlashChoice,
    translateError,
    normalizeLocale,
    resolveGuildLocale,
    isGuildLocaleAuto,
    SUPPORTED_LANGUAGES,
    SUPPORTED_LNGS,
    LANGUAGE_ORDER,
    VOICE_ERROR_KEYS,
};
