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
    ChannelType,
} = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { setGuildSettings } = require("../utils/database");
const { createChatPlayIdleContainer } = require("./components");
const { toggleTwentyFourSeven } = require("../services/sessionManager");
const { deleteSession } = require("./chatPlaySetupSession");

const SETUP_STEPS = 2;
const EMOJI_UNCHECKED = { id: "1522858566141214844", name: "Musicify_Unchecked" };
const EMOJI_CHECKED = { id: "1522858608478388275", name: "Musicify_Checked" };

function buildSetupStepHeader(t, step) {
    return t("chatplay.setup.stepHeader", { step, totalSteps: SETUP_STEPS });
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

function buildChannelSection(t, session, guild) {
    const channel = guild.channels.cache.get(session.channelId);
    const channelLine = channel
        ? `<#${session.channelId}>`
        : t("chatplay.setup.unknownChannel");

    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("chatplay.setup.channelTitle")}\n-# ${t("chatplay.setup.channelDescription", { channel: channelLine })}`
            )
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId("cp_setup_change_channel")
                .setLabel(t("chatplay.setup.editButton"))
                .setStyle(ButtonStyle.Secondary)
        );
}

function buildChangeChannelModal(t) {
    const channelSelect = new ChannelSelectMenuBuilder()
        .setCustomId("cp_setup_channel_select")
        .setPlaceholder(t("chatplay.setup.modalPlaceholder"))
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    const channelLabel = new LabelBuilder()
        .setLabel(t("chatplay.setup.modalChannelLabel"))
        .setDescription(t("chatplay.setup.modalChannelDescription"))
        .setChannelSelectMenuComponent(channelSelect);

    return new ModalBuilder()
        .setCustomId("cp_setup_change_channel_modal")
        .setTitle(t("chatplay.setup.modalTitle"))
        .addLabelComponents(channelLabel);
}

function buildReviewSection(title, description, customId, valueLabel) {
    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`${title}\n-# ${description}`)
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId(customId)
                .setLabel(valueLabel)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true)
        );
}

function buildManage247Section(t, guildData, command247) {
    const enable247 = Boolean(guildData.twentyFourSeven);
    const action = enable247 ? t("chatplay.setup.turnOff") : t("chatplay.setup.turnOn");

    return new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${t("chatplay.setup.247Title")}\n-# ${t("chatplay.setup.manage247Description", { action, cmd247: command247 })}`
            )
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setCustomId("cp_manage_toggle_247")
                .setLabel(action)
                .setStyle(enable247 ? ButtonStyle.Secondary : ButtonStyle.Success)
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

function getSetupBehaviours(t) {
    return [
        {
            title: t("chatplay.setup.slowmodeTitle"),
            description: t("chatplay.setup.slowmodeDescription"),
            toggleCustomId: "cp_setup_toggle_slowmode",
            reviewCustomId: "cp_setup_review_slowmode",
            isEnabled: (session) => session.slowmode,
            reviewValue: (session) =>
                session.slowmode ? t("chatplay.setup.slowmodeOn") : t("common.off"),
        },
        {
            title: t("chatplay.setup.deleteMessagesTitle"),
            description: t("chatplay.setup.deleteMessagesDescription"),
            toggleCustomId: "cp_setup_toggle_deletemsg",
            reviewCustomId: "cp_setup_review_deletemsg",
            isEnabled: (session) => session.deleteMessages,
            reviewValue: (session) =>
                session.deleteMessages ? t("common.on") : t("common.off"),
        },
        {
            title: t("chatplay.setup.pinTitle"),
            description: t("chatplay.setup.pinDescription"),
            toggleCustomId: "cp_setup_toggle_pin",
            reviewCustomId: "cp_setup_review_pin",
            isEnabled: (session) => session.pinPlayerMessage,
            reviewValue: (session) =>
                session.pinPlayerMessage ? t("common.on") : t("common.off"),
        },
        {
            title: t("chatplay.setup.247Title"),
            description: t("chatplay.setup.247Description"),
            toggleCustomId: "cp_setup_toggle_247",
            reviewCustomId: "cp_setup_review_247",
            isEnabled: (session) => session.enable247,
            reviewValue: (session) =>
                session.enable247 ? t("common.on") : t("common.off"),
        },
    ];
}

function stripRecommended(title) {
    return title.replace(/ \*\(recommended\)\*/g, "");
}

function buildSetupStep2Container(t, session, guild) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildSetupStepHeader(t, 1))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addSectionComponents(buildChannelSection(t, session, guild));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("chatplay.setup.behaviourHeading"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const behaviours = getSetupBehaviours(t);
    container.addSectionComponents(
        ...behaviours.map((option) =>
            buildBehaviourSection(
                option.title,
                option.description,
                option.toggleCustomId,
                option.isEnabled(session)
            )
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    const navRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("cp_setup_cancel")
            .setLabel(t("common.cancel"))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("cp_setup_continue")
            .setLabel(t("chatplay.setup.continueButton"))
            .setStyle(ButtonStyle.Primary)
    );

    container.addActionRowComponents(navRow);
    return container;
}

function buildSetupStep3Container(t, session, guild) {
    const channel = guild.channels.cache.get(session.channelId);
    const channelLine = channel
        ? `<#${session.channelId}>`
        : t("chatplay.setup.unknownChannel");
    const behaviours = getSetupBehaviours(t);

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${buildSetupStepHeader(t, 2)}\n\n` +
                `${t("chatplay.setup.reviewHeading")}\n` +
                t("chatplay.setup.reviewChannel", { channel: channelLine })
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("chatplay.setup.reviewSettings"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addSectionComponents(
        ...behaviours.map((option) =>
            buildReviewSection(
                stripRecommended(option.title),
                option.description,
                option.reviewCustomId,
                option.reviewValue(session, guild)
            )
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("cp_setup_back")
            .setLabel(t("chatplay.setup.backButton"))
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("cp_setup_confirm")
            .setLabel(t("chatplay.setup.createButton"))
            .setStyle(ButtonStyle.Success)
    );

    container.addActionRowComponents(row);
    return container;
}

function buildSetupCancelledContainer(t) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("chatplay.setup.cancelledHeading")}\n\n${t("chatplay.setup.cancelledBody")}`
        )
    );
    return container;
}

function hasChatPlayConfigured(guildData) {
    return Boolean(guildData.chatPlayChannelId);
}

function buildManageSettingsSections(t, guildData, command247) {
    const slowmode = guildData.chatPlaySlowmode !== false;
    const deleteMessages = guildData.chatPlayDeleteMessages !== false;
    const pinPlayer = guildData.chatPlayPinPlayerMessage !== false;

    return [
        buildReviewSection(
            stripRecommended(t("chatplay.setup.slowmodeTitle")),
            t("chatplay.setup.slowmodeDescription"),
            "cp_manage_review_slowmode",
            slowmode ? t("chatplay.setup.slowmodeOn") : t("common.off")
        ),
        buildReviewSection(
            stripRecommended(t("chatplay.setup.deleteMessagesTitle")),
            t("chatplay.setup.deleteMessagesDescription"),
            "cp_manage_review_deletemsg",
            deleteMessages ? t("common.on") : t("common.off")
        ),
        buildReviewSection(
            stripRecommended(t("chatplay.setup.pinTitle")),
            t("chatplay.setup.pinDescription"),
            "cp_manage_review_pin",
            pinPlayer ? t("common.on") : t("common.off")
        ),
        buildManage247Section(t, guildData, command247),
    ];
}

async function buildChatPlayManageContainer(t, guildData, guild, client) {
    const command247 = await getCommandMention(client, "247");
    const channel = guild.channels.cache.get(guildData.chatPlayChannelId);
    const channelLine = channel
        ? `<#${guildData.chatPlayChannelId}>`
        : t("chatplay.setup.unknownChannel");
    const statusLine = guildData.chatPlayEnabled
        ? t("chatplay.setup.manageEnabled", { channel: channelLine })
        : t("chatplay.setup.manageDisabled", { channel: channelLine });

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("chatplay.setup.manageHeading")}\n\n` + "**Status**\n" + `-# ${statusLine}`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("chatplay.setup.manageSettings"))
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addSectionComponents(...buildManageSettingsSections(t, guildData, command247));

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

function buildChatPlayDeletedContainer(t) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("chatplay.setup.deletedHeading")}\n\n` +
                `${t("chatplay.setup.deletedRemoved")}\n\n` +
                t("chatplay.setup.deletedSetupAgain")
        )
    );
    return container;
}

async function deleteChatPlay(client, guild, guildData) {
    const guildId = guild.id;
    const channelId = guildData.chatPlayChannelId;

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

function buildSetupSuccessContainer(t, session, guild, extras = {}) {
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
        lines.push("", "**Note**", `-# ${extras.twentyFourSevenWarning}`);
    }

    if (extras.slowmodeWarning) {
        lines.push("", "**Note**", `-# ${extras.slowmodeWarning}`);
    }

    if (extras.pinWarning) {
        lines.push("", "**Note**", `-# ${extras.pinWarning}`);
    }

    lines.push("", t("chatplay.setup.successManage"));

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

    const container = createChatPlayIdleContainer(t, guildData);
    const chatMsg = await channel.send({
        components: [container],
        flags: MessageFlags.IsComponentsV2,
    });

    let slowmodeWarning = "";
    let pinWarning = "";
    const botMember = guild.members.me;
    const canManageChannel = botMember
        ?.permissionsIn(channel)
        ?.has(PermissionFlagsBits.ManageChannels);

    if (canManageChannel) {
        try {
            await channel.setRateLimitPerUser(
                session.slowmode ? 5 : 0,
                session.slowmode ? "ChatPlay setup — prevents spam" : "ChatPlay setup — slowmode disabled"
            );
        } catch (err) {
            slowmodeWarning = t("chatplay.setup.warningSlowmodeFailed");
        }
    } else if (session.slowmode) {
        slowmodeWarning = t("chatplay.setup.warningSlowmodeNotApplied");
    }

    if (session.pinPlayerMessage) {
        const pinResult = await pinChatPlayPlayerMessage(channel, chatMsg, botMember, t);
        if (!pinResult.ok) {
            pinWarning = pinResult.warning;
        }
    }

    guildData.chatPlayChannelId = session.channelId;
    guildData.chatPlayMessageId = chatMsg.id;
    guildData.chatPlayEnabled = true;
    guildData.playerChannelId = session.channelId;

    setGuildSettings(guildId, {
        chatPlayChannelId: session.channelId,
        chatPlayMessageId: chatMsg.id,
        chatPlayEnabled: true,
        chatPlaySlowmode: session.slowmode,
        chatPlayDeleteMessages: session.deleteMessages,
        chatPlayPinPlayerMessage: session.pinPlayerMessage,
    });

    deleteSession(guildId, session.userId);

    return { slowmodeWarning, twentyFourSevenWarning, pinWarning };
}

module.exports = {
    buildSetupStep2Container,
    buildSetupStep3Container,
    buildChangeChannelModal,
    buildSetupCancelledContainer,
    buildSetupSuccessContainer,
    buildChatPlayManageContainer,
    buildChatPlayDeleteConfirmContainer,
    buildChatPlayDeletedContainer,
    hasChatPlayConfigured,
    finalizeChatPlaySetup,
    deleteChatPlay,
    pinChatPlayPlayerMessage,
};
