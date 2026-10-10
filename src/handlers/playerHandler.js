const { MessageFlags, AttachmentBuilder } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { createNowPlayingContainer, createChatPlayNowPlayingContainer } = require("../utils/components");
const { resolveGuild } = require("../utils/guildBranding");
const { generateMusicCard } = require("../utils/musicard");
const { recordIncident } = require("../utils/incidents");
const { scheduleStatusUpdate } = require("../services/statusMonitor");
const {
    suspendPlayersForLavalinkDisconnect,
    scheduleLavalinkRecovery,
    isLavalinkSuspended,
    handleRecoveryTrackStart,
} = require("../services/lavalinkRecovery");
const {
    cancelScheduledLeave,
    handleQueueEnd,
    handlePlayerDisconnect,
    savePending247Snapshot,
    hasPending247Snapshot,
    scheduleTwentyFourSevenReconnect,
    cleanupIdle247PlayersOnNodeDisconnect,
} = require("../services/sessionManager");
const { getT } = require("../i18n");
const config = require("../../config");
const { limitedResolve, PRIORITY_SUGGESTIONS } = require("../utils/resolveLimiter");
const { rememberTrackRequester } = require("../utils/votePrompt");
const {
    isPlayerUiBlocked,
    clearPlayerUiBlocked,
    handleMessageDeliveryError,
} = require("../utils/playerMessageDelivery");
const { isChannelAccessError } = require("../utils/discordErrors");
const { updateVoiceChannelStatusForPlayer } = require("../utils/voiceChannelStatus");
const { resolvePlayerTextChannelId, isChatPlayActive } = require("../utils/playerChannel");

const UPDATE_INTERVAL_MS = 15 * 1000; // 15 seconds
const WEBSOCKET_CLOSED = 3;
const LAVALINK_RECONNECT_INTERVAL_MS = 30 * 60 * 1000;
let lavalinkReconnectTimer = null;

function recoverDisconnectedLavalinkNodes(client) {
    if (!client?.riffy?.initiated) return;

    for (const configNode of config.nodes) {
        const node = client.riffy.nodeMap.get(configNode.name || configNode.host);

        if (!node) {
            client.riffy.createNode(configNode);
            console.log(`[Musicify] Created missing Lavalink node "${configNode.name}".`);
            continue;
        }

        // Keep healthy voice sessions intact and let Riffy finish pending recovery.
        // An open socket can still be waiting for Lavalink's ready payload.
        if (node.connected || node.reconnectAttempt ||
            (node.ws && node.ws.readyState !== WEBSOCKET_CLOSED)) {
            continue;
        }

        node.reconnectAttempted = 1;
        node.connect();
        console.log(`[Musicify] Reconnecting Lavalink node "${configNode.name}".`);
    }
}

function startLavalinkReconnectMonitor(client) {
    if (lavalinkReconnectTimer) clearInterval(lavalinkReconnectTimer);

    lavalinkReconnectTimer = setInterval(() => {
        console.log("[Musicify] Checking Lavalink connection health...");
        recoverDisconnectedLavalinkNodes(client);
    }, LAVALINK_RECONNECT_INTERVAL_MS);
}

/**
 * Helper: edit the existing player message or send a new one (never duplicates).
 * @returns {Promise<boolean>} Whether delivery succeeded.
 */
async function editOrSendPlayerMessage(client, guildData, guildId, channelId, container, files) {
    if (isPlayerUiBlocked(guildData)) {
        return false;
    }

    if (isChatPlayActive(guildData) && channelId === guildData.chatPlayChannelId) {
        const channel = client.channels.cache.get(channelId);
        if (!channel) {
            guildData.chatPlayMessageId = null;
            return false;
        }

        const { editChatPlayMessage } = require("../services/chatPlayPlayer");
        return editChatPlayMessage(client, channel.guild.id, container, files || []);
    }

    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        guildData.chatPlayMessageId = null;
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        return false;
    }

    const messageId = guildData.chatPlayMessageId || guildData.playerMessageId;

    if (messageId) {
        try {
            const msg = await channel.messages.fetch(messageId);
            await msg.edit({
                components: [container],
                files: files,
                attachments: [],
                flags: MessageFlags.IsComponentsV2,
            });
            clearPlayerUiBlocked(guildData);
            return true;
        } catch (err) {
            if (isChannelAccessError(err)) {
                handleMessageDeliveryError(
                    guildId,
                    channelId,
                    err,
                    guildData,
                    "Cannot edit player message"
                );
                return false;
            }

            guildData.chatPlayMessageId = null;
            guildData.playerMessageId = null;
            guildData.playerChannelId = null;
            clearUpdateInterval(guildData);
        }
    }

    try {
        const newMsg = await channel.send({
            components: [container],
            files: files,
            flags: MessageFlags.IsComponentsV2,
        });

        if (isChatPlayActive(guildData)) {
            guildData.chatPlayMessageId = newMsg.id;
        } else {
            guildData.playerMessageId = newMsg.id;
            guildData.playerChannelId = channel.id;
        }

        clearPlayerUiBlocked(guildData);
        return true;
    } catch (sendErr) {
        handleMessageDeliveryError(
            guildId,
            channelId,
            sendErr,
            guildData,
            "Failed to send player message"
        );
        return false;
    }
}

/**
 * Refresh the player message with an updated musicard image
 */
async function refreshPlayerMessage(client, guildId) {
    try {
        const player = client.riffy.players.get(guildId);
        if (!player || !player.current) return;

        const guildData = getGuildData(guildId);
        if (isPlayerUiBlocked(guildData)) return;

        const track = player.current;
        const t = getT.forGuild(guildId, client);

        const guild = resolveGuild(client, guildId);
        const musicardBuffer = await generateMusicCard(track, player, guildData, t);
        const container = isChatPlayActive(guildData)
            ? createChatPlayNowPlayingContainer(
                  t,
                  track,
                  player,
                  guildData,
                  musicardBuffer,
                  guild,
                  client
              )
            : createNowPlayingContainer(
                  t,
                  track,
                  player,
                  guildData,
                  musicardBuffer,
                  guild,
                  client
              );

        const files = [];
        if (musicardBuffer) {
            files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
        }

        const channelId = resolvePlayerTextChannelId(client, guild, guildData, player, {
            voiceChannelId: player.voiceChannel,
            fallbackChannelId: guildData.playerChannelId || player.textChannel,
        });
        await editOrSendPlayerMessage(client, guildData, guildId, channelId, container, files);
    } catch (error) {
        console.error("[Musicify] Auto-update error:", error);
    }
}

/**
 * Start the 15-second auto-update interval for a guild
 */
function startUpdateInterval(client, guildId) {
    const guildData = getGuildData(guildId);

    // Clear any existing interval first
    clearUpdateInterval(guildData);

    guildData.updateInterval = setInterval(() => {
        refreshPlayerMessage(client, guildId);
    }, UPDATE_INTERVAL_MS);
}

/**
 * Set up all riffy player event handlers
 */
function setupPlayerHandler(client) {
    if (!client.riffy) {
        console.warn('[Musicify] Riffy client not initialized; player handlers not attached.');
        return;
    }
    // --- Node Connected ---
    client.riffy.on("nodeConnect", (node) => {
        console.log(`[Musicify] Lavalink node "${node.name}" connected.`);
        scheduleStatusUpdate(client, true);
        scheduleLavalinkRecovery(client);
    });

    // --- Node Error ---
    client.riffy.on("nodeError", (node, error) => {
        console.error(`[Musicify] Node "${node.name}" error:`, error.message);
        recordIncident("Lavalink", `Node error: ${error.message.substring(0, 50)}`);
        scheduleStatusUpdate(client, true);
    });

    // --- Node Disconnect ---
    client.riffy.on("nodeDisconnect", (node) => {
        console.warn(`[Musicify] Node "${node.name}" disconnected.`);
        recordIncident("Lavalink", "Node disconnected");
        scheduleStatusUpdate(client, true);
        void suspendPlayersForLavalinkDisconnect(client, node);
        cleanupIdle247PlayersOnNodeDisconnect(client, node);
    });

    // --- Node Reconnected (Riffy built-in auto-reconnect) ---
    client.riffy.on("nodeReconnect", (node) => {
        console.log(`[Musicify] Node "${node.name}" reconnected successfully.`);
        scheduleStatusUpdate(client, true);
        scheduleLavalinkRecovery(client);
    });

    startLavalinkReconnectMonitor(client);

    // --- Track Start ---
    client.riffy.on("trackStart", async (player, track) => {
        try {
            handleRecoveryTrackStart(client, player);

            const guildData = getGuildData(player.guildId);
            const t = getT.forGuild(player.guildId, client);
            rememberTrackRequester(player.guildId, track.info.requester);
            clearPlayerUiBlocked(guildData);

            // Save the previous track for the "Previous" button
            if (player.previous) {
                guildData.previousTracks.push(player.previous);
                // Keep history limited to 20 tracks to prevent memory bloat
                if (guildData.previousTracks.length > 20) {
                    guildData.previousTracks.shift();
                }
            }

            // Clear any pending leave timers
            cancelScheduledLeave(guildData);
            if (guildData.autoplayWatchdog) {
                clearTimeout(guildData.autoplayWatchdog);
                guildData.autoplayWatchdog = null;
            }

            // Generate musicard image
            const musicardBuffer = await generateMusicCard(track, player, guildData, t);

            // Build the container - use ChatPlay version if in ChatPlay channel
            const guild = resolveGuild(client, player.guildId);
            const container = isChatPlayActive(guildData)
                ? createChatPlayNowPlayingContainer(
                      t,
                      track,
                      player,
                      guildData,
                      musicardBuffer,
                      guild,
                      client
                  )
                : createNowPlayingContainer(
                      t,
                      track,
                      player,
                      guildData,
                      musicardBuffer,
                      guild,
                      client
                  );

            // Prepare files
            const files = [];
            if (musicardBuffer) {
                files.push(new AttachmentBuilder(musicardBuffer, { name: "musicard.png" }));
            }

            // Get the channel
            const channelId = resolvePlayerTextChannelId(client, guild, guildData, player, {
                voiceChannelId: player.voiceChannel,
                fallbackChannelId: guildData.playerChannelId || player.textChannel,
            });
            const delivered = await editOrSendPlayerMessage(
                client,
                guildData,
                player.guildId,
                channelId,
                container,
                files
            );

            if (delivered) {
                startUpdateInterval(client, player.guildId);
            }

            void updateVoiceChannelStatusForPlayer(client, player, track).catch((err) => {
                console.warn("[Musicify] Failed to update voice channel status:", err.message);
            });

            // Fetch suggestions for the dropdown
            try {
                const searchQuery = `${track.info.author} ${track.info.title}`;
                const result = await limitedResolve(client, {
                    query: searchQuery,
                    requester: track.info.requester,
                    guildId: player.guildId,
                    priority: PRIORITY_SUGGESTIONS,
                });
                if (result.tracks && result.tracks.length > 1) {
                    guildData.suggestions = result.tracks
                        .filter((t) => t.info.uri !== track.info.uri)
                        .slice(0, 10);
                }
            } catch (err) {
                console.error("[Musicify] Failed to fetch suggestions:", err.message);
            }
        } catch (error) {
            console.error("[Musicify] trackStart error:", error);
        }
    });

    // --- Queue End ---
    client.riffy.on("queueEnd", async (player) => {
        try {
            if (isLavalinkSuspended(player.guildId)) return;
            await handleQueueEnd(client, player);
        } catch (error) {
            console.error("[Musicify] queueEnd error:", error);
        }
    });

    // --- Track End (safety net for idle UI) ---
    client.riffy.on("trackEnd", async (player) => {
        try {
            if (isLavalinkSuspended(player.guildId)) return;

            const guildData = getGuildData(player.guildId);
            if (guildData.loop !== "none") return;
            if (guildData.autoplay) return;

            const hasQueue = player.queue?.length > 0;
            if (!hasQueue && !player.current) {
                await handleQueueEnd(client, player);
            }
        } catch (error) {
            console.error("[Musicify] trackEnd error:", error);
        }
    });

    // --- Player Disconnect ---
    client.riffy.on("playerDisconnect", async (player) => {
        try {
            if (isLavalinkSuspended(player.guildId)) return;
            await handlePlayerDisconnect(client, player);
        } catch (error) {
            console.error("[Musicify] playerDisconnect error:", error);
        }
    });

    client.riffy.on("socketClosed", async (player) => {
        try {
            if (isLavalinkSuspended(player.guildId)) return;

            const guildData = getGuildData(player.guildId);
            if (!guildData.twentyFourSeven || !guildData.boundVoiceChannelId) return;
            if (hasPending247Snapshot(player.guildId)) return;

            if (savePending247Snapshot(client, player)) {
                scheduleTwentyFourSevenReconnect(client, player.guildId);
                return;
            }

            try {
                player.destroy();
            } catch {
                // player already gone
            }
            scheduleTwentyFourSevenReconnect(client, player.guildId);
        } catch (error) {
            console.error("[Musicify] socketClosed error:", error);
        }
    });

    // --- Track Error / Stuck ---
    client.riffy.on("trackError", async (player, track, payload) => {
        if (isLavalinkSuspended(player.guildId)) return;

        console.error(`[Musicify] Track error in ${player.guildId} for "${track.info.title}":`, payload.error || payload);
        const { notifyPlayerFeedback } = require("./chatPlayHandler");
        const { refreshChatPlayPlayer } = require("../services/chatPlayPlayer");
        await notifyPlayerFeedback(
            client,
            player.guildId,
            `❌ Failed to play **${track.info.title}** — skipping...`,
            6000
        );
        await refreshChatPlayPlayer(client, player.guildId);
    });

    client.riffy.on("trackStuck", async (player, track, payload) => {
        if (isLavalinkSuspended(player.guildId)) return;

        console.warn(`[Musicify] Track stuck in ${player.guildId} for "${track.info.title}" (${payload.thresholdMs}ms)`);
        const { notifyPlayerFeedback } = require("./chatPlayHandler");
        await notifyPlayerFeedback(
            client,
            player.guildId,
            `⚠️ **${track.info.title}** got stuck — skipping...`,
            6000
        );
    });
}

module.exports = {
    setupPlayerHandler,
    refreshPlayerMessage,
};
