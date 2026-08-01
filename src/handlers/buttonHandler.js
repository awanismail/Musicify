const { MessageFlags, AttachmentBuilder } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { createNowPlayingContainer, createChatPlayNowPlayingContainer, createQueueContainer, createStopConfirmContainer } = require("../utils/components");
const { generateMusicCard } = require("../utils/musicard");
const { addNodeDetails } = require("../utils/nodeDetails");
const { canControlMusic, VOICE_CHANNEL_DENIAL } = require("../utils/permissions");
const { handleStop, toggleTwentyFourSeven } = require("../services/sessionManager");
const { build247ResultContainer, build247CancelledContainer } = require("../commands/247");
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
const config = require("../../config");
const { getTrackQueuePosition, formatDuplicateTrackMessage } = require("../utils/queueUtils");
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
    let player = client.riffy.players.get(guildId);
    const guildData = getGuildData(guildId);

    if (interaction.isButton()) {
        const customId = interaction.customId;

        if (customId === "247_enable" || customId === "247_disable" || customId === "247_cancel") {
            try {
                if (customId === "247_cancel") {
                    await safeInteractionUpdate(interaction, {
                        components: [build247CancelledContainer()],
                        flags: MessageFlags.IsComponentsV2,
                    });
                    return;
                }

                if (!interaction.member.voice?.channel) {
                    return interaction.reply(
                        ephemeralV2(
                            buildErrorContainer("**Voice channel required**\n-# Join a voice channel first.")
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
                    components: [build247ResultContainer(enabling)],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (error) {
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction);
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
                            buildErrorContainer(
                                "**Nothing playing**\n-# Start music with `/play` or ChatPlay first."
                            )
                        )
                    );
                }
                if (!canControlMusic(interaction.member, player)) {
                    return interaction.reply({ content: VOICE_CHANNEL_DENIAL, flags: MessageFlags.Ephemeral });
                }
                if (guildData.stopConfirmPending !== interaction.user.id) {
                    return interaction.reply(
                        ephemeralV2(
                            buildFeedbackContainer(
                                "### ⚠️ Expired\n\n-# Stop confirmation expired — press **stop** again."
                            )
                        )
                    );
                }

                guildData.stopConfirmPending = null;
                await handleStop(client, interaction.guild.id);
                await safeInteractionUpdate(interaction, {
                    components: [
                        buildFeedbackContainer(
                            "### ⏹ Stopped\n\n-# Playback stopped and queue cleared."
                        ),
                    ],
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (error) {
                if (isInteractionExpired(error)) {
                    await replyExpiredInteraction(interaction);
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
                // Restore volume
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

        const selectedValue = interaction.values[0]; // "node_0", "node_1", etc
        const nodeIndex = parseInt(selectedValue.replace("node_", ""), 10);

        // Get configured node from config (source of truth)
        const configNode = config.nodes[nodeIndex];
        if (!configNode) return;

        // Find connected node if available
        const nodes = client.riffy.nodeMap;
        const nodeList = Array.isArray(nodes)
            ? nodes
            : nodes instanceof Map
              ? [...nodes.values()]
              : Object.values(nodes || {});
        const connectedNode = nodeList.find(n => n.name === configNode.name);
        const connected = connectedNode?.connected || connectedNode?.isConnected || false;

        const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

        const statusEmoji = connected ? "🟢" : "🔴";
        const statusText = connected ? "Connected" : "Disconnected";

        const container = new ContainerBuilder();

        // Use generic name in header
        const displayName = nodeIndex === 0 ? "Main Node" : `Node ${nodeIndex}`;

        // Node header
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `## ${statusEmoji} ${displayName}\n` +
                `-# ${statusText}`
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        if (!connected || !connectedNode?.stats) {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    "-# *Node is offline — no stats available.*"
                )
            );
        } else {
            const stats = connectedNode.stats;
            const cpuCores = stats.cpu?.cores || "N/A";
            const sysLoad = stats.cpu ? `${(stats.cpu.systemLoad * 100).toFixed(1)}%` : "N/A";
            const llLoad = stats.cpu ? `${(stats.cpu.lavalinkLoad * 100).toFixed(1)}%` : "N/A";

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `-# Rest Version: ${connectedNode.restVersion || "N/A"}\n\n` +
                    `**Players**\n` +
                    `-# 🎶 Active: ${stats.playingPlayers || 0}  •  📻 Total: ${stats.players || 0}\n\n` +
                    `**CPU**\n` +
                    `-# 🖥️ Cores: ${cpuCores}  •  ⚙️ System: ${sysLoad}  •  🔧 Lavalink: ${llLoad}`
                )
            );
        }

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

        // Back button
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

        const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
        const { formatIncidents } = require("../utils/incidents");

        const nodes = client.riffy.nodeMap;
        const nodeList = Array.isArray(nodes)
            ? nodes
            : nodes instanceof Map
              ? [...nodes.values()]
              : Object.values(nodes || {});

        const connectedNodes = nodeList.filter(n => n.connected || n.isConnected).length;
        const totalNodes = config.nodes.length;
        const botPing = client.ws?.ping ?? 0;
        const uptimeSeconds = process.uptime();
        const startTime = new Date(Date.now() - uptimeSeconds * 1000);

        let statusEmoji = "🟢";
        let statusText = "All systems operational";
        if (connectedNodes === 0 || botPing > 300) {
            statusEmoji = "🔴";
            statusText = "Major system issues detected";
        } else if (connectedNodes < totalNodes || botPing > 100) {
            statusEmoji = "🟡";
            statusText = "Some systems experiencing issues";
        }

        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`## ${statusEmoji} ${statusText}`)
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**Recent Incidents**\n` +
                formatIncidents(4)
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

        const supportButton = new ButtonBuilder()
            .setLabel("Known Outages")
            .setURL("https://discord.gg/MRjEUhDCpZ")
            .setStyle(ButtonStyle.Link);

        const voteButton = new ButtonBuilder()
            .setLabel("⭐ Vote")
            .setURL("https://top.gg/bot/1502977716196999309/vote")
            .setStyle(ButtonStyle.Link);

        container.addActionRowComponents(new ActionRowBuilder().addComponents(supportButton, voteButton));

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

        const startTimestamp = Math.floor(startTime.getTime() / 1000);

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**Uptime**\n` +
                `-# 🕒 <t:${startTimestamp}:f> (<t:${startTimestamp}:R>)\n` +
                `-# *Times shown in your local timezone*`
            )
        );

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "### Lavalink Node Stats\n" +
                `-# ${connectedNodes}/${totalNodes} nodes available`
            )
        );

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("node_stats_select")
            .setPlaceholder("📡 Select a node")
            .setMinValues(1)
            .setMaxValues(1);

        for (let i = 0; i < config.nodes.length; i++) {
            const configNode = config.nodes[i];
            const connectedNode = nodeList.find(n => n.name === configNode.name);
            const connected = connectedNode?.connected || connectedNode?.isConnected || false;
            const nodeStatusEmoji = connected ? "🟢" : "🔴";
            const displayName = i === 0 ? "Main Node" : `Node ${i}`;
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(displayName)
                    .setDescription(`${nodeStatusEmoji} ${connected ? "Connected" : "Disconnected"}`)
                    .setValue(`node_${i}`)
            );
        }

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));

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
        const container = await buildHelpPage(client, selectedPage);

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
            return interaction.reply({ content: `❌ No music playing. Start with ${getCmd("play")} or ChatPlay!`, flags: MessageFlags.Ephemeral });
        }
        if (!canControlMusic(interaction.member, player)) {
            return interaction.reply({ content: VOICE_CHANNEL_DENIAL, flags: MessageFlags.Ephemeral });
        }

        const index = Number.parseInt(interaction.values[0], 10);
        const suggestion = Number.isInteger(index)
            ? guildData.suggestions[index]
            : null;

        if (suggestion) {
            const position = getTrackQueuePosition(player, suggestion.info?.uri);
            if (position) {
                return interaction.reply(
                    ephemeralV2(
                        buildFeedbackContainer(
                            `### ⚠️ Duplicate track\n\n-# ${formatDuplicateTrackMessage(suggestion.info?.title, position)}`
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

            const title = suggestion.info?.title || "Unknown";
            const feedback = wasIdle
                ? `✅ Now playing **${title}** · *Suggested song*`
                : `✅ Added **${title}** — **#${player.queue.length}** in queue · *Suggested song*`;
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
            return interaction.reply({ content: `❌ No music playing. Start with ${getCmd("play")} or ChatPlay!`, flags: MessageFlags.Ephemeral });
        }
        if (!canControlMusic(interaction.member, player)) {
            return interaction.reply({ content: VOICE_CHANNEL_DENIAL, flags: MessageFlags.Ephemeral });
        }
        if (!guildData.queuePages) guildData.queuePages = new Map();
        guildData.queuePages.set(interaction.user.id, 0);
        const queueContainer = createQueueContainer(
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
            return interaction.reply({ content: `❌ No music playing. Start with ${getCmd("play")} or ChatPlay!`, flags: MessageFlags.Ephemeral });
        }
        if (!canControlMusic(interaction.member, player)) {
            return interaction.reply({ content: VOICE_CHANNEL_DENIAL, flags: MessageFlags.Ephemeral });
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
                await replyExpiredInteraction(interaction);
            } else {
                console.error("[Musicify] Queue pagination error:", err.message);
            }
        }
        return;
    }

    // Most buttons need an active player — send ephemeral if not
    const needsPlayer = ["pause_resume", "skip", "previous", "stop", "shuffle", "loop", "autoplay", "vol_up", "vol_down"];
    if (needsPlayer.includes(customId) && !player) {
        return interaction.reply({ content: `❌ No music playing. Start with ${getCmd("play")} or ChatPlay!`, flags: MessageFlags.Ephemeral });
    }

    if (needsPlayer.includes(customId) && !canControlMusic(interaction.member, player)) {
        return interaction.reply({ content: VOICE_CHANNEL_DENIAL, flags: MessageFlags.Ephemeral });
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
                            buildFeedbackContainer(
                                "### ⚠️ Stop pending\n\n-# Someone else is confirming a stop — wait for them to finish."
                            )
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
                    ephemeralV2(createStopConfirmContainer(queueLength))
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

        const musicardBuffer = await generateMusicCard(player.current, player, guildData);
        // Use ChatPlay container if in ChatPlay channel for consistent formatting
        const container = guildData.chatPlayChannelId && guildData.chatPlayMessageId
            ? createChatPlayNowPlayingContainer(player.current, player, guildData, musicardBuffer)
            : createNowPlayingContainer(player.current, player, guildData, musicardBuffer);

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
        // Message was deleted — clear stale IDs so next action sends a fresh one
        guildData.chatPlayMessageId = null;
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        guildData.updateInterval && clearInterval(guildData.updateInterval);
        guildData.updateInterval = null;
        console.error("[Musicify] Button edit error:", error.message);
    }
}


module.exports = { handleButtonInteraction };
