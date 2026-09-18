const {
    PermissionFlagsBits,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    LabelBuilder,
    RoleSelectMenuBuilder,
    RadioGroupBuilder,
    RadioGroupOptionBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require("discord.js");
const { setGuildSettings } = require("../utils/database");
const { slashMeta, getT } = require("../i18n");
const { DJ_MODES, getDjSettings, normalizeDjMode } = require("../utils/permissions");
const { buildFeedbackContainer, ephemeralV2, safeInteractionUpdate } = require("../utils/replies");

const DJ_EDIT_SETTINGS = "dj_edit_settings";
const DJ_SETTINGS_MODAL = "dj_settings_modal";
const DJ_MODE_GROUP = "dj_settings_mode";
const DJ_ROLES_SELECT = "dj_settings_roles";
const DJ_QUEUE_LIMIT_SELECT = "dj_settings_queue_limit";
const DJ_MODE_PREFIX = "dj_mode_";
const DJ_RESET_DEFAULTS = "dj_reset_defaults";
const DJ_RESET_CONFIRM = "dj_reset_confirm";
const DJ_RESET_CANCEL = "dj_reset_cancel";

const MODE_ORDER = [DJ_MODES.EVERYONE, DJ_MODES.DJ_ONLY, DJ_MODES.DJ_AND_REQUESTER];
const QUEUE_LIMIT_PRESETS = [0, 1, 2, 3, 5, 10];
const MAX_DJ_ROLES = 25;

function formatDjMode(t, mode) {
    const key = `commands.dj.modes.${mode}`;
    const translated = t(key);
    return translated === key ? mode : translated;
}

function modeExplanation(t, mode) {
    const key = `commands.dj.modeExplain.${mode}`;
    const translated = t(key);
    return translated === key ? "" : translated;
}

function formatQueueLimit(t, limit) {
    if (!limit) {
        return t("commands.dj.queueLimitUnlimited");
    }
    return t("commands.dj.queueLimitCount", { count: limit });
}

function formatRoleNames(guild, djRoleIds) {
    return djRoleIds
        .map((id) => {
            const role = guild.roles.cache.get(id);
            return role ? role.name : id;
        })
        .join(", ");
}

function buildHomeStatusContent(guild, t) {
    const { djMode, djRoleIds, djQueueLimit } = getDjSettings(guild.id);
    const modeLabel = formatDjMode(t, djMode);
    const explain = modeExplanation(t, djMode);

    let rolesBlock;
    if (!djRoleIds.length) {
        rolesBlock =
            djMode === DJ_MODES.EVERYONE
                ? t("commands.dj.noRolesEveryone")
                : t("commands.dj.noRolesLocked");
    } else {
        rolesBlock = t("commands.dj.rolesLine", { roles: formatRoleNames(guild, djRoleIds) });
    }

    return (
        `${t("commands.dj.heading")}\n\n` +
        `${t("commands.dj.description")}\n\n` +
        `${t("commands.dj.modeLine", { mode: modeLabel })}\n` +
        `-# ${explain}\n\n` +
        `${rolesBlock}\n\n` +
        `${t("commands.dj.queueLimitLine", { limit: formatQueueLimit(t, djQueueLimit) })}\n\n` +
        t("commands.dj.adminBypassNote")
    );
}

function buildModeButtons(t, currentMode) {
    return new ActionRowBuilder().addComponents(
        ...MODE_ORDER.map((mode) =>
            new ButtonBuilder()
                .setCustomId(`${DJ_MODE_PREFIX}${mode}`)
                .setLabel(formatDjMode(t, mode))
                .setStyle(currentMode === mode ? ButtonStyle.Primary : ButtonStyle.Secondary)
        )
    );
}

function buildDjHomeContainer(guild, t) {
    const { djMode } = getDjSettings(guild.id);
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildHomeStatusContent(guild, t))
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("commands.dj.modeButtonsHint"))
    );
    container.addActionRowComponents(buildModeButtons(t, djMode));
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("commands.dj.settingsHint"))
    );
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(DJ_EDIT_SETTINGS)
                .setLabel(t("commands.dj.editSettingsButton"))
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(DJ_RESET_DEFAULTS)
                .setLabel(t("commands.dj.resetDefaultsButton"))
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return container;
}

function buildResetConfirmContainer(t) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("commands.dj.resetConfirmHeading")}\n\n` +
                `${t("commands.dj.resetConfirmBody")}\n\n` +
                t("commands.dj.resetConfirmFooter")
        )
    );
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(DJ_RESET_CONFIRM)
                .setLabel(t("commands.dj.resetConfirmButton"))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId(DJ_RESET_CANCEL)
                .setLabel(t("common.cancel"))
                .setStyle(ButtonStyle.Secondary)
        )
    );
    return container;
}

function buildModeRadioGroup(t, currentMode) {
    const effectiveMode = normalizeDjMode(currentMode);

    const options = MODE_ORDER.map((mode) => {
        const option = new RadioGroupOptionBuilder()
            .setLabel(formatDjMode(t, mode))
            .setDescription(modeExplanation(t, mode).slice(0, 100))
            .setValue(mode);

        if (mode === effectiveMode) {
            option.setDefault(true);
        }

        return option;
    });

    return new RadioGroupBuilder()
        .setCustomId(DJ_MODE_GROUP)
        .setRequired(true)
        .addOptions(...options);
}

function buildQueueLimitSelect(t, currentLimit) {
    const select = new StringSelectMenuBuilder()
        .setCustomId(DJ_QUEUE_LIMIT_SELECT)
        .setPlaceholder(t("commands.dj.queueLimitSelectPlaceholder"))
        .setRequired(true)
        .addOptions(
            ...QUEUE_LIMIT_PRESETS.map((limit) => {
                const option = new StringSelectMenuOptionBuilder()
                    .setLabel(formatQueueLimit(t, limit))
                    .setValue(String(limit));

                if (limit === currentLimit) {
                    option.setDefault(true);
                }

                return option;
            })
        );

    return select;
}

function buildDjSettingsModal(t, guild) {
    const { djMode, djRoleIds, djQueueLimit } = getDjSettings(guild.id);

    const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId(DJ_ROLES_SELECT)
        .setPlaceholder(t("commands.dj.rolesSelectPlaceholder"))
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(MAX_DJ_ROLES);

    if (djRoleIds.length > 0) {
        roleSelect.setDefaultRoles(...djRoleIds.slice(0, MAX_DJ_ROLES));
    }

    const rolesLabel = new LabelBuilder()
        .setLabel(t("commands.dj.modalRolesLabel"))
        .setDescription(t("commands.dj.modalRolesDescription"))
        .setRoleSelectMenuComponent(roleSelect);

    const modeLabel = new LabelBuilder()
        .setLabel(t("commands.dj.modalModeLabel"))
        .setDescription(t("commands.dj.modalModeDescription"))
        .setRadioGroupComponent(buildModeRadioGroup(t, djMode));

    const queueLimitLabel = new LabelBuilder()
        .setLabel(t("commands.dj.modalQueueLimitLabel"))
        .setDescription(t("commands.dj.modalQueueLimitDescription"))
        .setStringSelectMenuComponent(buildQueueLimitSelect(t, djQueueLimit));

    return new ModalBuilder()
        .setCustomId(DJ_SETTINGS_MODAL)
        .setTitle(t("commands.dj.modalTitle"))
        .addLabelComponents(rolesLabel, modeLabel, queueLimitLabel);
}

function parseQueueLimitFromModal(interaction) {
    const values = interaction.fields.getStringSelectValues(DJ_QUEUE_LIMIT_SELECT);
    const parsed = Number.parseInt(values?.[0], 10);
    return QUEUE_LIMIT_PRESETS.includes(parsed) ? parsed : 0;
}

function parseDjSettingsFromModal(interaction) {
    const mode = interaction.fields.getRadioGroup(DJ_MODE_GROUP);
    const selectedRoles = interaction.fields.getSelectedRoles(DJ_ROLES_SELECT);
    const djRoleIds = selectedRoles ? [...selectedRoles.keys()] : [];

    return {
        djMode: normalizeDjMode(mode),
        djRoleIds,
        djQueueLimit: parseQueueLimitFromModal(interaction),
    };
}

function isDjInteraction(interaction) {
    if (!interaction.isButton()) return false;
    const id = interaction.customId;
    return (
        id === DJ_EDIT_SETTINGS ||
        id === DJ_RESET_DEFAULTS ||
        id === DJ_RESET_CONFIRM ||
        id === DJ_RESET_CANCEL ||
        id.startsWith(DJ_MODE_PREFIX)
    );
}

function isDjModal(interaction) {
    return interaction.isModalSubmit() && interaction.customId === DJ_SETTINGS_MODAL;
}

async function refreshDjPanel(interaction, t) {
    return safeInteractionUpdate(
        interaction,
        {
            components: [buildDjHomeContainer(interaction.guild, t)],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        },
        t
    );
}

async function handleDjInteraction(client, interaction) {
    const t = getT(interaction, client);

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply(
            ephemeralV2(buildFeedbackContainer(t("commands.dj.permissionDenied")))
        );
    }

    if (interaction.customId === DJ_EDIT_SETTINGS) {
        return interaction.showModal(buildDjSettingsModal(t, interaction.guild));
    }

    if (interaction.customId === DJ_RESET_DEFAULTS) {
        return safeInteractionUpdate(
            interaction,
            {
                components: [buildResetConfirmContainer(t)],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            },
            t
        );
    }

    if (interaction.customId === DJ_RESET_CANCEL) {
        return refreshDjPanel(interaction, t);
    }

    if (interaction.customId === DJ_RESET_CONFIRM) {
        setGuildSettings(interaction.guild.id, {
            djMode: DJ_MODES.EVERYONE,
            djRoleIds: [],
            djQueueLimit: 0,
        });
        await refreshDjPanel(interaction, t);
        return;
    }

    if (interaction.customId.startsWith(DJ_MODE_PREFIX)) {
        const mode = interaction.customId.slice(DJ_MODE_PREFIX.length);
        if (!MODE_ORDER.includes(mode)) return;

        setGuildSettings(interaction.guild.id, { djMode: mode });
        await refreshDjPanel(interaction, t);
    }
}

async function handleDjModal(client, interaction) {
    if (!isDjModal(interaction)) return false;

    const t = getT(interaction, client);

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply(
            ephemeralV2(buildFeedbackContainer(t("commands.dj.permissionDenied")))
        );
        return true;
    }

    const settings = parseDjSettingsFromModal(interaction);
    setGuildSettings(interaction.guild.id, {
        djMode: settings.djMode,
        djRoleIds: settings.djRoleIds,
        djQueueLimit: settings.djQueueLimit,
    });

    await interaction.deferUpdate();
    await refreshDjPanel(interaction, t);
    return true;
}

module.exports = {
    data: slashMeta("dj").setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

    async execute(interaction, client) {
        const t = getT(interaction, client);
        await interaction.reply({
            components: [buildDjHomeContainer(interaction.guild, t)],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    },

    buildDjHomeContainer,
    buildDjContainer: buildDjHomeContainer,
    buildDjSettingsModal,
    handleDjInteraction,
    handleDjModal,
    isDjInteraction,
    isDjModal,
};
