const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SectionBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags,
    PermissionFlagsBits,
    MessageType,
    ModalBuilder,
    LabelBuilder,
    ChannelSelectMenuBuilder,
    CheckboxGroupBuilder,
    CheckboxGroupOptionBuilder,
    ChannelType,
} = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { setGuildSettings } = require("../utils/database");
const { createChatPlayIdleContainer } = require("./components");
const { toggleTwentyFourSeven } = require("../services/sessionManager");
const EMOJI_UNCHECKED = { id: "1522858566141214844", name: "Musicify_Unchecked" };
const EMOJI_CHECKED = { id: "1522858608478388275", name: "Musicify_Checked" };

const SETUP_BEHAVIOUR_GROUP_ID = "cp_setup_behaviour";
const MANAGE_SETTINGS_MODAL_ID = "cp_manage_settings_modal";
const MANAGE_BEHAVIOUR_GROUP_ID = "cp_manage_behaviour";
const MANAGE_CHANNEL_SELECT_ID = "cp_manage_settings_channel_select";
const SETUP_BEHAVIOUR = {
    SLOWMODE: "slowmode",
    DELETE_MSG: "deletemsg",
    PIN: "pin",
    TWENTY_FOUR_SEVEN: "247",
    SMART_FILTER: "smartfilter",
};
function stripRecommended(title) {
    return title.replace(/ \*\(recommended\)\*/g, "");
}

function stripMarkdown(title) {
    return stripRecommended(title).replace(/\*\*/g, "");
}

function parseSetupBehaviourSelection(selectedValues) {
    const selected = new Set(selectedValues ?? []);

    return {
        slowmode: selected.has(SETUP_BEHAVIOUR.SLOWMODE),
        deleteMessages: selected.has(SETUP_BEHAVIOUR.DELETE_MSG),
        pinPlayerMessage: selected.has(SETUP_BEHAVIOUR.PIN),
        enable247: selected.has(SETUP_BEHAVIOUR.TWENTY_FOUR_SEVEN),
        smartFilter: selected.has(SETUP_BEHAVIOUR.SMART_FILTER),
    };
}

function buildBehaviourGroupLabel(
    t,
    groupCustomId,
    defaults = {
        slowmode: true,
        deleteMessages: true,
        pinPlayerMessage: true,
        enable247: false,
        smartFilter: false,
    }
) {
    const behaviourGroup = new CheckboxGroupBuilder()
        .setCustomId(groupCustomId)
        .setRequired(false)
        .setMinValues(0)
        .setMaxValues(5)
        .addOptions(
            new CheckboxGroupOptionBuilder()
                .setLabel(stripMarkdown(t("chatplay.setup.slowmodeTitle")))
                .setDescription(t("chatplay.setup.slowmodeDescription"))
                .setValue(SETUP_BEHAVIOUR.SLOWMODE)
                .setDefault(defaults.slowmode),
            new CheckboxGroupOptionBuilder()
                .setLabel(stripMarkdown(t("chatplay.setup.deleteMessagesTitle")))
                .setDescription(t("chatplay.setup.deleteMessagesDescription"))
                .setValue(SETUP_BEHAVIOUR.DELETE_MSG)
                .setDefault(defaults.deleteMessages),
            new CheckboxGroupOptionBuilder()
                .setLabel(stripMarkdown(t("chatplay.setup.pinTitle")))
                .setDescription(t("chatplay.setup.pinDescription"))
                .setValue(SETUP_BEHAVIOUR.PIN)
                .setDefault(defaults.pinPlayerMessage),
            new CheckboxGroupOptionBuilder()
                .setLabel(stripMarkdown(t("chatplay.setup.247Title")))
                .setDescription(t("chatplay.setup.247Description"))
                .setValue(SETUP_BEHAVIOUR.TWENTY_FOUR_SEVEN)
                .setDefault(defaults.enable247),
            new CheckboxGroupOptionBuilder()
                .setLabel(stripMarkdown(t("chatplay.setup.smartFilterTitle")))
                .setDescription(t("chatplay.setup.smartFilterDescription"))
                .setValue(SETUP_BEHAVIOUR.SMART_FILTER)
                .setDefault(defaults.smartFilter)
        );

    return new LabelBuilder()
        .setLabel(t("chatplay.setup.behaviourGroupLabel"))
        .setDescription(t("chatplay.setup.behaviourGroupDescription"))
        .setCheckboxGroupComponent(behaviourGroup);
}

function buildSetupBehaviourGroupLabel(t) {
    return buildBehaviourGroupLabel(t, SETUP_BEHAVIOUR_GROUP_ID);
}

function getGuildBehaviourDefaults(guildData) {
    return {
        slowmode: guildData.chatPlaySlowmode !== false,
        deleteMessages: guildData.chatPlayDeleteMessages !== false,
        pinPlayerMessage: guildData.chatPlayPinPlayerMessage !== false,
        enable247: Boolean(guildData.twentyFourSeven),
        smartFilter: guildData.chatPlaySmartFilter === true,
    };
}

function buildToggleButton(customId, enabled) {
    return new ButtonBuilder()
        .setCustomId(customId)
        .setStyle(ButtonStyle.Secondary)
        .setEmoji(enabled ? EMOJI_CHECKED : EMOJI_UNCHECKED);
}

function buildBehaviourSection(title, description, customId, enabled) {
    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${title}\n-# ${description}`)
        )
        .setButtonAccessory(buildToggleButton(customId, enabled));
}

async function deletePinNotification(channel) {
    for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, 350));
        }
        const messages = await channel.messages.fetch({ limit: 10 });
        const pinNotice = messages.find((m) => m.type === MessageType.ChannelPinnedMessage);
        if (pinNotice) {
            await pinNotice.delete().catch(() => {});
            return;
        }
    }
}

async function pinChatPlayPlayerMessage(channel, message, botMember, t) {
    const perms = botMember?.permissionsIn(channel);
    const canPin =
        perms?.has(PermissionFlagsBits.PinMessages) ||
        perms?.has(PermissionFlagsBits.ManageMessages);

    if (!canPin) {
        return {
            ok: false,
            warning: t("chatplay.setup.warningPinFailed"),
        };
    }

    try {
        await message.pin();
        await deletePinNotification(channel);
        return { ok: true };
    } catch (err) {
        return {
            ok: false,
            warning: t("chatplay.setup.warningPinPermission"),
        };
    }
}

function buildSetupCheckboxLabel(t, titleKey, descriptionKey, customId, defaultChecked) {
    return new LabelBuilder()
        .setLabel(stripMarkdown(t(titleKey)))
        .setDescription(t(descriptionKey))
        .setCheckboxComponent((checkbox) =>
            checkbox.setCustomId(customId).setDefault(defaultChecked)
        );
}

function isAllowedSetupChannelType(type) {
    return type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement;
}

function resolveDefaultSetupChannelId(channel) {
    if (!channel) return null;

    if (channel.isThread?.()) {
        const parent = channel.parent;
        return parent && isAllowedSetupChannelType(parent.type) ? parent.id : null;
    }

    if (channel.isTextBased?.() && isAllowedSetupChannelType(channel.type)) {
        return channel.id;
    }

    return null;
}

function buildSetupModal(t, { channel = null } = {}) {
    const defaultChannelId = resolveDefaultSetupChannelId(channel);
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId("cp_setup_channel_select")
        .setPlaceholder(t("chatplay.setup.modalPlaceholder"))
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    if (defaultChannelId) {
        channelSelect.setDefaultChannels(defaultChannelId);
    }

    const channelLabel = new LabelBuilder()
        .setLabel(t("chatplay.setup.modalChannelLabel"))
        .setDescription(t("chatplay.setup.modalChannelDescription"))
        .setChannelSelectMenuComponent(channelSelect);

    return new ModalBuilder()
        .setCustomId("cp_setup_modal")
        .setTitle(t("chatplay.setup.setupModalTitle"))
        .addLabelComponents(channelLabel, buildSetupBehaviourGroupLabel(t));
}

function buildChangeChannelModal(t, { modalCustomId, selectCustomId } = {}) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(selectCustomId ?? "cp_setup_channel_select")
        .setPlaceholder(t("chatplay.setup.modalPlaceholder"))
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    const channelLabel = new LabelBuilder()
        .setLabel(t("chatplay.setup.modalChannelLabel"))
        .setDescription(t("chatplay.setup.modalChannelDescription"))
        .setChannelSelectMenuComponent(channelSelect);

    return new ModalBuilder()
        .setCustomId(modalCustomId ?? "cp_setup_change_channel_modal")
        .setTitle(t("chatplay.setup.modalTitle"))
        .addLabelComponents(channelLabel);
}

function buildManageSettingsModal(t, guildData) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId(MANAGE_CHANNEL_SELECT_ID)
        .setPlaceholder(t("chatplay.setup.modalPlaceholder"))
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    if (guildData.chatPlayChannelId) {
        channelSelect.setDefaultChannels(guildData.chatPlayChannelId);
    }

    const channelLabel = new LabelBuilder()
        .setLabel(t("chatplay.setup.modalChannelLabel"))
        .setDescription(t("chatplay.setup.modalChannelDescription"))
        .setChannelSelectMenuComponent(channelSelect);

    return new ModalBuilder()
        .setCustomId(MANAGE_SETTINGS_MODAL_ID)
        .setTitle(t("chatplay.setup.manageSettingsModalTitle"))
        .addLabelComponents(
            channelLabel,
            buildBehaviourGroupLabel(t, MANAGE_BEHAVIOUR_GROUP_ID, getGuildBehaviourDefaults(guildData))
        );
}

function buildManageStatusDisplay(t, guildData, guild) {
    const channel = guild.channels.cache.get(guildData.chatPlayChannelId);
    const channelLine = channel
        ? `<#${guildData.chatPlayChannelId}>`
        : t("chatplay.setup.unknownChannel");
    const statusLine = guildData.chatPlayEnabled
        ? t("chatplay.setup.manageEnabled", { channel: channelLine })
        : t("chatplay.setup.manageDisabled", { channel: channelLine });

    return new TextDisplayBuilder().setContent(
        `${t("common.labels.status")}\n-# ${statusLine}`
    );
}

async function getCommandMention(client, name) {
    try {
        const commands = await client.application.commands.fetch();
        const cmd = commands?.find((c) => c.name === name);
        if (cmd) return `</${name}:${cmd.id}>`;
    } catch {}
    return `\`/${name}\``;
}

function hasChatPlayConfigured(guildData) {
    return Boolean(guildData.chatPlayChannelId);
}

async function applyChatPlaySettings(client, guild, guildData, settings, t) {
    const guildId = guild.id;
    const warnings = [];
    let twentyFourSevenWarning = "";

    guildData.chatPlaySlowmode = settings.slowmode;
    guildData.chatPlayDeleteMessages = settings.deleteMessages;
    guildData.chatPlayPinPlayerMessage = settings.pinPlayerMessage;
    guildData.chatPlaySmartFilter = settings.smartFilter;

    setGuildSettings(guildId, {
        chatPlaySlowmode: settings.slowmode,
        chatPlayDeleteMessages: settings.deleteMessages,
        chatPlayPinPlayerMessage: settings.pinPlayerMessage,
        chatPlaySmartFilter: settings.smartFilter,
    });

    if (settings.channelId && settings.channelId !== guildData.chatPlayChannelId) {
        const relocateWarnings = await relocateChatPlayChannel(
            client,
            guild,
            guildData,
            settings.channelId,
            t
        );
        warnings.push(...relocateWarnings);
    } else {
        const slowmodeWarning = await applyChatPlaySlowmode(guild, guildData, t);
        if (slowmodeWarning) warnings.push(slowmodeWarning);

        const pinWarning = await applyChatPlayPin(guild, guildData, t);
        if (pinWarning) warnings.push(pinWarning);
    }

    const was247 = Boolean(guildData.twentyFourSeven);
    if (settings.enable247 && !was247) {
        if (settings.voiceChannelIdFor247) {
            await toggleTwentyFourSeven(client, guildId, {
                voiceChannelId: settings.voiceChannelIdFor247,
                textChannelId: guildData.chatPlayChannelId,
                enabled: true,
            });
        } else {
            twentyFourSevenWarning = t("chatplay.setup.warning247NotEnabled");
        }
    } else if (!settings.enable247 && was247) {
        await toggleTwentyFourSeven(client, guildId, {
            textChannelId: guildData.chatPlayChannelId,
            enabled: false,
        });
    }

    if (twentyFourSevenWarning) {
        warnings.push(twentyFourSevenWarning);
    }

    return { warnings };
}

async function applyChatPlaySlowmode(guild, guildData, t) {
    const channel = guild.channels.cache.get(guildData.chatPlayChannelId);
    if (!channel) return null;

    const botMember = guild.members.me;
    const canManageChannel = botMember
        ?.permissionsIn(channel)
        ?.has(PermissionFlagsBits.ManageChannels);
    const enabled = guildData.chatPlaySlowmode !== false;

    if (canManageChannel) {
        try {
            await channel.setRateLimitPerUser(
                enabled ? 5 : 0,
                enabled ? "ChatPlay — slowmode enabled" : "ChatPlay — slowmode disabled"
            );
            return null;
        } catch {
            return t("chatplay.setup.warningSlowmodeFailed");
        }
    }

    if (enabled) {
        return t("chatplay.setup.warningSlowmodeNotApplied");
    }

    return null;
}

async function applyChatPlayPin(guild, guildData, t) {
    const channel = guild.channels.cache.get(guildData.chatPlayChannelId);
    if (!channel || !guildData.chatPlayMessageId) return null;

    let message;
    try {
        message = await channel.messages.fetch(guildData.chatPlayMessageId);
    } catch {
        return t("chatplay.setup.warningPinPermission");
    }

    const botMember = guild.members.me;
    const shouldPin = guildData.chatPlayPinPlayerMessage !== false;

    if (shouldPin) {
        const result = await pinChatPlayPlayerMessage(channel, message, botMember, t);
        return result.ok ? null : result.warning;
    }

    if (message.pinned) {
        try {
            await message.unpin();
        } catch {
            return t("chatplay.setup.warningPinPermission");
        }
    }

    return null;
}

async function relocateChatPlayChannel(client, guild, guildData, newChannelId, t) {
    const guildId = guild.id;
    const oldChannelId = guildData.chatPlayChannelId;

    if (!oldChannelId || oldChannelId === newChannelId) {
        return [];
    }

    const newChannel =
        guild.channels.cache.get(newChannelId) ??
        (await guild.channels.fetch(newChannelId).catch(() => null));

    if (!newChannel?.isTextBased?.()) {
        throw new Error(t("chatplay.handlers.invalidChannel"));
    }

    const warnings = [];
    const oldMessageId = guildData.chatPlayMessageId;
    const botMember = guild.members.me;

    if (guildData.chatPlaySlowmode !== false && oldChannelId) {
        const oldChannel = guild.channels.cache.get(oldChannelId);
        if (oldChannel?.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageChannels)) {
            await oldChannel.setRateLimitPerUser(0, "ChatPlay moved").catch(() => {});
        }
    }

    if (oldChannelId && oldMessageId) {
        try {
            const oldChannel =
                client.channels.cache.get(oldChannelId) ??
                (await client.channels.fetch(oldChannelId));
            const oldMsg = await oldChannel.messages.fetch(oldMessageId);
            if (oldMsg.pinned) await oldMsg.unpin().catch(() => {});
        } catch {}
    }

    guildData.chatPlayChannelId = newChannelId;
    guildData.playerChannelId = newChannelId;

    const { sendChatPlayPlayerMessage } = require("../services/chatPlayPlayer");
    const chatMsg = await sendChatPlayPlayerMessage(client, guild, newChannel, guildData, t);

    guildData.chatPlayMessageId = chatMsg.id;

    setGuildSettings(guildId, {
        chatPlayChannelId: newChannelId,
        chatPlayMessageId: chatMsg.id,
        playerChannelId: newChannelId,
    });

    if (oldChannelId && oldMessageId) {
        try {
            const oldChannel =
                client.channels.cache.get(oldChannelId) ??
                (await client.channels.fetch(oldChannelId));
            const oldMsg = await oldChannel.messages.fetch(oldMessageId);
            await oldMsg.delete();
        } catch {}
    }

    const slowmodeWarning = await applyChatPlaySlowmode(guild, guildData, t);
    if (slowmodeWarning) warnings.push(slowmodeWarning);

    const pinWarning = await applyChatPlayPin(guild, guildData, t);
    if (pinWarning) warnings.push(pinWarning);

    return warnings;
}

async function buildChatPlayManageContainer(t, guildData, guild, client) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("chatplay.setup.manageHeading"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(buildManageStatusDisplay(t, guildData, guild));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("chatplay.setup.manageSettingsHint"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("cp_manage_enable")
                .setLabel(t("chatplay.setup.enableButton"))
                .setStyle(ButtonStyle.Success)
                .setDisabled(Boolean(guildData.chatPlayEnabled)),
            new ButtonBuilder()
                .setCustomId("cp_manage_disable")
                .setLabel(t("chatplay.setup.disableButton"))
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!guildData.chatPlayEnabled),
            new ButtonBuilder()
                .setCustomId("cp_manage_settings")
                .setLabel(t("chatplay.setup.settingsButton"))
                .setStyle(ButtonStyle.Primary)
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("cp_manage_delete")
                .setLabel(t("chatplay.setup.deleteButton"))
                .setStyle(ButtonStyle.Danger)
        )
    );

    return container;
}

function buildChatPlayDeleteConfirmContainer(t, guildData, guild) {
    const channel = guild.channels.cache.get(guildData.chatPlayChannelId);
    const channelLine = channel
        ? `<#${guildData.chatPlayChannelId}>`
        : t("chatplay.setup.unknownChannel");

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("chatplay.setup.deleteConfirmHeading")}\n\n` +
                `${t("chatplay.setup.deleteConfirmPermanent")}\n` +
                `${t("chatplay.setup.deleteConfirmRemovedFrom", { channel: channelLine })}\n\n` +
                `${t("chatplay.setup.deleteConfirmWhatDeleted")}\n\n` +
                t("chatplay.setup.deleteConfirmFooter")
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("cp_manage_delete_confirm")
                .setLabel(t("chatplay.setup.confirmButton"))
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("cp_manage_delete_cancel")
                .setLabel(t("common.cancel"))
                .setStyle(ButtonStyle.Secondary)
        )
    );

    return container;
}

async function buildChatPlayDeletedContainer(t, client) {
    const cmdChatplay = await getCommandMention(client, "chatplay");
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("chatplay.setup.deletedHeading")}\n\n` +
                `${t("chatplay.setup.deletedRemoved")}\n\n` +
                t("chatplay.setup.deletedSetupAgain", { cmdChatplay })
        )
    );
    return container;
}

async function deleteChatPlay(client, guild, guildData) {
    const guildId = guild.id;
    const channelId = guildData.chatPlayChannelId;
    const { handleStop } = require("../services/sessionManager");
    const { clearUpdateInterval } = require("../utils/playerStore");

    if (guildData.twentyFourSeven) {
        await toggleTwentyFourSeven(client, guildId, { enabled: false });
    }

    clearUpdateInterval(guildData);
    await handleStop(client, guildId, { destroyPlayer: true });

    if (channelId && guildData.chatPlayMessageId) {
        const messageId = guildData.chatPlayMessageId;
        guildData.chatPlayMessageId = null;
        setGuildSettings(guildId, { chatPlayMessageId: null });

        try {
            const channel =
                client.channels.cache.get(channelId) ?? (await client.channels.fetch(channelId));
            const msg = await channel.messages.fetch(messageId);
            await msg.delete();
        } catch {}
    }

    if (channelId && guildData.chatPlaySlowmode) {
        try {
            const channel = guild.channels.cache.get(channelId);
            const botMember = guild.members.me;
            if (
                channel &&
                botMember?.permissionsIn(channel)?.has(PermissionFlagsBits.ManageChannels)
            ) {
                await channel.setRateLimitPerUser(0, "ChatPlay removed");
            }
        } catch {}
    }

    guildData.chatPlayChannelId = null;
    guildData.chatPlayMessageId = null;
    guildData.chatPlayEnabled = false;

    if (guildData.playerChannelId === channelId) {
        guildData.playerChannelId = null;
    }

    setGuildSettings(guildId, {
        chatPlayChannelId: null,
        chatPlayMessageId: null,
        chatPlayEnabled: false,
    });
}

async function buildSetupSuccessContainer(t, session, guild, client, extras = {}) {
    const cmdChatplay = await getCommandMention(client, "chatplay");
    const lines = [
        t("chatplay.setup.successHeading"),
        t("chatplay.setup.successTryIt"),
        t("chatplay.setup.successStep1"),
        t("chatplay.setup.successStep2", { channel: `<#${session.channelId}>` }),
    ];

    if (session.pinPlayerMessage && !extras.pinWarning) {
        lines.push("", t("chatplay.setup.successPinned"));
    } else if (!session.pinPlayerMessage) {
        lines.push("", t("chatplay.setup.successRecommendedPin"));
    }

    if (session.enable247) {
        lines.push(t("chatplay.setup.success247Enabled"));
    }

    if (extras.twentyFourSevenWarning) {
        lines.push("", t("common.labels.note"), `-# ${extras.twentyFourSevenWarning}`);
    }

    if (extras.slowmodeWarning) {
        lines.push("", t("common.labels.note"), `-# ${extras.slowmodeWarning}`);
    }

    if (extras.pinWarning) {
        lines.push("", t("common.labels.note"), `-# ${extras.pinWarning}`);
    }

    lines.push("", t("chatplay.setup.successManage", { cmdChatplay }));

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n"))
    );
    return container;
}

async function finalizeChatPlaySetup(client, session, guild, { voiceChannelId = null, t } = {}) {
    const guildId = session.guildId;
    const guildData = getGuildData(guildId);
    const channel = guild.channels.cache.get(session.channelId);

    if (!channel) {
        throw new Error(t("chatplay.setup.errorChannelGone"));
    }

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        const oldMessageId = guildData.chatPlayMessageId;
        guildData.chatPlayMessageId = null;
        setGuildSettings(guildId, { chatPlayMessageId: null });

        try {
            const oldChannel = client.channels.cache.get(guildData.chatPlayChannelId);
            if (oldChannel) {
                const oldMsg = await oldChannel.messages.fetch(oldMessageId);
                await oldMsg.delete();
            }
        } catch {}
    }

    guildData.chatPlaySlowmode = session.slowmode;
    guildData.chatPlayDeleteMessages = session.deleteMessages;
    guildData.chatPlayPinPlayerMessage = session.pinPlayerMessage;
    guildData.chatPlaySmartFilter = session.smartFilter;

    let twentyFourSevenWarning = "";
    const voiceChannelIdFor247 = session.voiceChannelIdFor247 ?? voiceChannelId ?? null;
    if (session.enable247) {
        if (voiceChannelIdFor247) {
            await toggleTwentyFourSeven(client, guildId, {
                voiceChannelId: voiceChannelIdFor247,
                textChannelId: session.channelId,
                enabled: true,
            });
        } else {
            twentyFourSevenWarning = t("chatplay.setup.warning247NotEnabled");
        }
    }

    guildData.chatPlayChannelId = session.channelId;
    guildData.chatPlayEnabled = true;
    guildData.playerChannelId = session.channelId;

    const container = createChatPlayIdleContainer(t, guildData);
    const chatMsg = await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
    });

    const slowmodeWarning = (await applyChatPlaySlowmode(guild, guildData, t)) || "";
    let pinWarning = "";

    guildData.chatPlayMessageId = chatMsg.id;

    if (session.pinPlayerMessage) {
        pinWarning = (await applyChatPlayPin(guild, guildData, t)) || "";
    }

    setGuildSettings(guildId, {
        chatPlayChannelId: session.channelId,
        chatPlayMessageId: chatMsg.id,
        chatPlayEnabled: true,
        chatPlaySlowmode: session.slowmode,
        chatPlayDeleteMessages: session.deleteMessages,
        chatPlayPinPlayerMessage: session.pinPlayerMessage,
        chatPlaySmartFilter: session.smartFilter,
    });

    return { slowmodeWarning, twentyFourSevenWarning, pinWarning };
}

module.exports = {
    getCommandMention,
    buildSetupModal,
    SETUP_BEHAVIOUR_GROUP_ID,
    MANAGE_SETTINGS_MODAL_ID,
    MANAGE_BEHAVIOUR_GROUP_ID,
    MANAGE_CHANNEL_SELECT_ID,
    parseSetupBehaviourSelection,
    buildManageSettingsModal,
    buildChangeChannelModal,
    buildSetupSuccessContainer,
    buildChatPlayManageContainer,
    buildChatPlayDeleteConfirmContainer,
    buildChatPlayDeletedContainer,
    hasChatPlayConfigured,
    finalizeChatPlaySetup,
    deleteChatPlay,
    applyChatPlaySettings,
    pinChatPlayPlayerMessage,
    applyChatPlaySlowmode,
    applyChatPlayPin,
    relocateChatPlayChannel,
};
