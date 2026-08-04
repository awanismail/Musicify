const { MessageFlags, AttachmentBuilder, ContainerBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SeparatorBuilder } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { createNowPlayingContainer, createChatPlayNowPlayingContainer, createQueueContainer, createStopConfirmContainer } = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");
const { addNodeDetails } = require("../utils/nodeDetails");
const { canControlMusic, VOICE_CHANNEL_DENIAL_KEY } = require("../utils/permissions");
const { handleStop, toggleTwentyFourSeven } = require("../services/sessionManager");
const { build247ResultContainer, build247CancelledContainer } = require("../commands/247");
const { handleLanguageButton, isLanguageButton } = require("../commands/language");
const { getT, translateError } = require("../i18n");
const {
    safeInteractionUpdate,
    isInteractionExpired,
    replyExpiredInteraction,
    buildErrorContainer,
    buildFeedbackContainer,
    ephemeralV2,
} = require("../utils/replies");
const {
    handleChatPlaySetupButton,
    handleChatPlayManageButton,
    isChatPlaySetupButton,
    isChatPlayManageButton,
} = require("./chatPlaySetupHandler");
const { notifyPlayerFeedback } = require("./chatPlayHandler");
const { dismissWelcomeMessage } = require("../utils/guildWelcome");
const { buildStatusContainer, getNodeDisplayName } = require("../utils/statusPage");
const config = require("../../config");
const { getTrackQueuePosition, getDuplicateTrackError } = require("../utils/queueUtils");
const { persistGuildPlaybackSettings } = require("../utils/database");

/**
 * Handle all button and select menu interactions from the player container
 */
async function handleButtonInteraction(client, interaction) {
    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId === "welcome_dismiss") {
            await dismissWelcomeMessage(interaction);
            return;
        }

        if (isLanguageButton(customId)) {
            return handleLanguageButton(client, interaction);
        }

        if (isChatPlaySetupButton(customId)) {
            return handleChatPlaySetupButton(client, interaction);
        }

        if (isChatPlayManageButton(customId)) {
            return handleChatPlayManageButton(client, interaction);
        }
    }

    if (!client.riffy) {
        console.warn('[Musicify] Riffy client not initialized; button handler ignored.');
        return;
    }

    // Fetch commands for IDs
    let commands;
    try {
        commands = await client.application.commands.fetch();
    } catch (e) {
        commands = null;
    }

    const getCmd = (name, subcommand = null) => {
        const cmd = commands?.find(c => c.name === name);
        if (!cmd) return subcommand ? `\`/${name} ${subcommand}\`` : `\`/${name}\``;
        return subcommand ? `</${name} ${subcommand}:${cmd.id}>` : `</${name}:${cmd.id}>`;
    };

    const guildId = interaction.guild.id;
    const tUser = getT(interaction, client);
    const tGuild = getT.forGuild(guildId, client);
    let player = client.riffy.players.get(guildId);
    const guildData = getGuildData(guildId);

    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId === "247_enable" || customId === "247_disable" || customId === "247_cancel") {
            try {
                if (customId === "247_cancel") {
                    await safeInteractionUpdate(interaction, {
                        components: [build247CancelledContainer(tUser)],
                        flags: MessageFlags.IsComponentsV2,
                    }, tUser);
                    return;
                }

                if (!interaction.member.voice?.channel) {
                    return interaction.reply(
                        ephemeralV2(
                            buildErrorContainer(tUser("errors.voiceChannelRequiredFormatted"), tUser)
                        )
                    );
                }

                const enabling = customId === "247_enable";

                await toggleTwentyFourSeven(client, interaction.guild.id, {
                    voiceChannelId: interaction.member.voice.channel.id,
                    textChannelId: guildData.chatPlayChannelId || interaction.channel.id,
                    enabled: enabling,
                });

                await safeInteractionUpdate(interaction, {
                    components: [build247ResultContainer(tUser, enabling)],
                    flags: MessageFlags.IsComponentsV2,
                }, tUser);
            } catch (error) {
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction, tUser);
                } else {
                    throw error;
                }
            }
            return;
        }

        if (customId === "stop_confirm") {
            try {
                if (!player) {
                    return interaction.reply(
                        ephemeralV2(
                            buildErrorContainer(tUser("handlers.button.nothingPlaying"), tUser)
                        )
                    );
                }
                if (!canControlMusic(interaction.member, player)) {
                    return interaction.reply({
                        content: tUser(VOICE_CHANNEL_DENIAL_KEY),
                        flags: MessageFlags.Ephemeral,
                    });
                }
                if (guildData.stopConfirmPending !== interaction.user.id) {
                    return interaction.reply(
                        ephemeralV2(
                            buildFeedbackContainer(tUser("handlers.button.stopExpired"))
                        )
                    );
                }

                guildData.stopConfirmPending = null;
                await handleStop(client, interaction.guild.id);
                await safeInteractionUpdate(interaction, {
                    components: [
                        buildFeedbackContainer(tUser("handlers.button.stopStopped")),
                    ],
                    flags: MessageFlags.IsComponentsV2,
                }, tUser);
            } catch (error) {
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction, tUser);
                } else {
                    throw error;
                }
            }
            return;
        }
    }

    // If no player exists but ChatPlay was active, try to recreate it
    if (!player && guildData.chatPlayChannelId && guildData.chatPlayEnabled) {
        const voiceChannel = interaction.member?.voice?.channel;
        if (voiceChannel) {
            try {
                player = client.riffy.createConnection({
                    guildId: guildId,
                    voiceChannel: voiceChannel.id,
                    textChannel: guildData.chatPlayChannelId,
                    deaf: true,
                });
                player.setVolume(guildData.volume);
                console.log(`[Musicify] Recreated player for guild ${guildId} after restart`);
            } catch (err) {
                console.error(`[Musicify] Failed to recreate player for guild ${guildId}:`, err.message);
            }
        }
    }

    // Handle node stats dropdown - show dedicated node details view
    if (interaction.isStringSelectMenu() && interaction.customId === "node_stats_select") {
        await interaction.deferUpdate();

        const selectedValue = interaction.values[0];
        const nodeIndex = parseInt(selectedValue.replace("node_", ""), 10);

        const configNode = config.nodes[nodeIndex];
        if (!configNode) return;

        const nodes = client.riffy.nodeMap;
        const nodeList = Array.isArray(nodes)
            ? nodes
            : nodes instanceof Map
              ? [...nodes.values()]
              : Object.values(nodes || {});
        const connectedNode = nodeList.find(n => n.name === configNode.name);
        const nodeForDetails = connectedNode || {
            connected: false,
            name: getNodeDisplayName(nodeIndex, tGuild),
        };

        const container = new ContainerBuilder();
        addNodeDetails(tGuild, container, nodeForDetails, nodeIndex);

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

        const backButton = new ButtonBuilder()
            .setCustomId("status_back")
            .setEmoji("⬅️")
            .setStyle(ButtonStyle.Secondary);

        container.addActionRowComponents(new ActionRowBuilder().addComponents(backButton));

        try {
            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (err) {
            console.error("[Musicify] Node stats select error:", err.message);
        }
        return;
    }

    // Handle status back button - return to main status view
    if (interaction.isButton() && interaction.customId === "status_back") {
        await interaction.deferUpdate();

        const container = buildStatusContainer(client, { t: tGuild });

        try {
            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (err) {
            console.error("[Musicify] Status back error:", err.message);
        }
        return;
    }

    // Handle help dropdown navigation
    if (interaction.isStringSelectMenu() && interaction.customId === "help_select") {
        await interaction.deferUpdate();

        const selectedPage = interaction.values[0];
        const { buildHelpPage } = require("../commands/help");
        const container = await buildHelpPage(client, selectedPage, tUser);

        try {
            await interaction.editReply({
                components: [container],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (err) {
            console.error("[Musicify] Help select error:", err.message);
        }
        return;
    }

    // Handle song suggestion select menu
    if (interaction.isStringSelectMenu() && interaction.customId === "song_suggestion") {
        if (!player) {
            return interaction.reply({
                content: tUser("errors.noMusicPlaying", { cmdPlay: getCmd("play") }),
                flags: MessageFlags.Ephemeral,
            });
        }
        if (!canControlMusic(interaction.member, player)) {
            return interaction.reply({
                content: tUser(VOICE_CHANNEL_DENIAL_KEY),
                flags: MessageFlags.Ephemeral,
            });
        }

        const index = Number.parseInt(interaction.values[0], 10);
        const suggestion = Number.isInteger(index)
            ? guildData.suggestions[index]
            : null;

        if (suggestion) {
            const position = getTrackQueuePosition(player, suggestion.info?.uri);
            if (position) {
                const duplicateError = getDuplicateTrackError(suggestion.info?.title, position, tUser);
                return interaction.reply(
                    ephemeralV2(
                        buildFeedbackContainer(
                            `${tUser("duplicate.heading")}\n\n-# ${translateError(tUser, duplicateError)}`
                        )
                    )
                );
            }
        }

        await interaction.deferUpdate();

        if (suggestion) {
            const wasIdle = !player.current && !player.playing && !player.paused;
            suggestion.info.requester = interaction.user;
            player.queue.add(suggestion);
            if (wasIdle) player.play();

            const title = suggestion.info?.title || tUser("common.unknown");
            const feedback = wasIdle
                ? tUser("handlers.button.suggestionNowPlaying", { title })
                : tUser("handlers.button.suggestionAdded", {
                      title,
                      position: player.queue.length,
                  });
            await notifyPlayerFeedback(client, interaction.guild.id, feedback, 3000);
        }

        return;
    }

    // Handle buttons
    if (!interaction.isButton()) return;

    const customId = interaction.customId;

    // Queue button opens an ephemeral reply
    if (customId === "queue") {
        if (!player || !player.current) {
            return interaction.reply({
                content: tUser("errors.noMusicPlaying", { cmdPlay: getCmd("play") }),
                flags: MessageFlags.Ephemeral,
            });
        }
        if (!canControlMusic(interaction.member, player)) {
            return interaction.reply({
                content: tUser(VOICE_CHANNEL_DENIAL_KEY),
                flags: MessageFlags.Ephemeral,
            });
        }
        if (!guildData.queuePages) guildData.queuePages = new Map();
        guildData.queuePages.set(interaction.user.id, 0);
        const queueContainer = createQueueContainer(
            tUser,
            player.queue,
            player.current,
            0
        );
        return interaction.reply({
            components: [queueContainer],
            flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        });
    }

    // Queue pagination buttons
    if (customId.startsWith("queue_") && customId !== "queue") {
        if (!player || !player.current) {
            return interaction.reply({
                content: tUser("errors.noMusicPlaying", { cmdPlay: getCmd("play") }),
                flags: MessageFlags.Ephemeral,
            });
        }
        if (!canControlMusic(interaction.member, player)) {
            return interaction.reply({
                content: tUser(VOICE_CHANNEL_DENIAL_KEY),
                flags: MessageFlags.Ephemeral,
            });
        }

        await interaction.deferUpdate();

        const totalTracks = player.queue.length;
        const pageSize = 10;
        const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));
        if (!guildData.queuePages) guildData.queuePages = new Map();
        let currentPage = guildData.queuePages.get(interaction.user.id) || 0;

        switch (customId) {
            case "queue_first":
                currentPage = 0;
                break;
            case "queue_prev":
                currentPage = Math.max(0, currentPage - 1);
                break;
            case "queue_next":
                currentPage = Math.min(totalPages - 1, currentPage + 1);
                break;
            case "queue_last":
                currentPage = totalPages - 1;
                break;
        }

        guildData.queuePages.set(interaction.user.id, currentPage);

        const queueContainer = createQueueContainer(
            tUser,
            player.queue,
            player.current,
            currentPage
        );

        try {
            await interaction.editReply({
                components: [queueContainer],
                flags: MessageFlags.IsComponentsV2,
            });
        } catch (err) {
            if (isInteractionExpired(err)) {
                await replyExpiredInteraction(interaction, tUser);
            } else {
                console.error("[Musicify] Queue pagination error:", err.message);
            }
        }
        return;
    }

    // Most buttons need an active player — send ephemeral if not
    const needsPlayer = ["pause_resume", "skip", "previous", "stop", "shuffle", "loop", "autoplay", "vol_up", "vol_down"];
    if (needsPlayer.includes(customId) && !player) {
        return interaction.reply({
            content: tUser("errors.noMusicPlaying", { cmdPlay: getCmd("play") }),
            flags: MessageFlags.Ephemeral,
        });
    }

    if (needsPlayer.includes(customId) && !canControlMusic(interaction.member, player)) {
        return interaction.reply({
            content: tUser(VOICE_CHANNEL_DENIAL_KEY),
            flags: MessageFlags.Ephemeral,
        });
    }

    // Defer immediately to avoid 3s timeout
    await interaction.deferUpdate();

    let needsVisualUpdate = false;

    switch (customId) {
        case "pause_resume": {
            if (player.paused) {
                player.pause(false);
            } else {
                player.pause(true);
            }
            needsVisualUpdate = true;
            break;
        }

        case "skip": {
            player.stop();
            break;
        }

        case "previous": {
            if (guildData.previousTracks.length > 0) {
                const prevTrack = guildData.previousTracks.pop();
                if (player.current) {
                    player.queue.unshift(player.current);
                }
                player.queue.unshift(prevTrack);
                player.stop();
            }
            break;
        }

        case "stop": {
            const queueLength = player.queue?.length || 0;
            const isChatPlay = guildData.chatPlayChannelId && guildData.chatPlayMessageId;
            if (isChatPlay && queueLength >= 20) {
                if (guildData.stopConfirmPending === interaction.user.id) {
                    guildData.stopConfirmPending = null;
                    await handleStop(client, interaction.guild.id);
                    return;
                }
                if (guildData.stopConfirmPending) {
                    return interaction.followUp(
                        ephemeralV2(
                            buildFeedbackContainer(tUser("handlers.button.stopPending"))
                        )
                    );
                }

                guildData.stopConfirmPending = interaction.user.id;
                setTimeout(() => {
                    if (guildData.stopConfirmPending === interaction.user.id) {
                        guildData.stopConfirmPending = null;
                    }
                }, 15000);
                return interaction.followUp(
                    ephemeralV2(createStopConfirmContainer(tUser, queueLength))
                );
            }
            guildData.stopConfirmPending = null;
            await handleStop(client, interaction.guild.id);
            return;
        }

        case "shuffle": {
            if (player.queue.length > 0) {
                player.queue.shuffle();
                guildData.shuffle = true;
            }
            needsVisualUpdate = true;
            break;
        }

        case "loop": {
            if (guildData.loop === "none") {
                guildData.loop = "track";
                player.setLoop("track");
            } else if (guildData.loop === "track") {
                guildData.loop = "queue";
                player.setLoop("queue");
            } else {
                guildData.loop = "none";
                player.setLoop("none");
            }
            needsVisualUpdate = true;
            break;
        }

        case "autoplay": {
            guildData.autoplay = !guildData.autoplay;
            persistGuildPlaybackSettings(player.guildId, guildData);
            needsVisualUpdate = true;
            break;
        }

        case "vol_down": {
            guildData.volume = Math.max(0, guildData.volume - 10);
            player.setVolume(guildData.volume);
            persistGuildPlaybackSettings(player.guildId, guildData);
            needsVisualUpdate = true;
            break;
        }

        case "vol_up": {
            guildData.volume = Math.min(100, guildData.volume + 10);
            player.setVolume(guildData.volume);
            persistGuildPlaybackSettings(player.guildId, guildData);
            needsVisualUpdate = true;
            break;
        }

        default:
            break;
    }

    // If the button needs a visual update, edit the message directly
    if (needsVisualUpdate) {
        await editPlayerMessageDirectly(client, player, guildData);
    }
}

/**
 * Edit the player message directly (not via interaction.update)
 * This avoids the 3-second interaction timeout
 */
async function editPlayerMessageDirectly(client, player, guildData) {
    try {
        if (!player || !player.current) return;

        const t = getT.forGuild(player.guildId, client);
        const musicardBuffer = await generateMusicCard(player.current, player, guildData);
        const container = guildData.chatPlayChannelId && guildData.chatPlayMessageId
            ? createChatPlayNowPlayingContainer(t, player.current, player, guildData, musicardBuffer)
            : createNowPlayingContainer(t, player.current, player, guildData, musicardBuffer);

        const files = [];
        if (musicardBuffer) {
            files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
        }

        const channelId = guildData.chatPlayChannelId || guildData.playerChannelId || player.textChannel;
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            guildData.chatPlayMessageId = null;
            guildData.playerMessageId = null;
            guildData.playerChannelId = null;
            return;
        }

        const messageId = guildData.chatPlayMessageId || guildData.playerMessageId;
        if (!messageId) return;

        const msg = await channel.messages.fetch(messageId);
        await msg.edit({
            components: [container],
            files: files,
            flags: MessageFlags.IsComponentsV2,
        });
    } catch (error) {
        guildData.chatPlayMessageId = null;
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        guildData.updateInterval && clearInterval(guildData.updateInterval);
        guildData.updateInterval = null;
        console.error("[Musicify] Button edit error:", error.message);
    }
}

module.exports = { handleButtonInteraction };
