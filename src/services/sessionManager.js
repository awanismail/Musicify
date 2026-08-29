const { MessageFlags } = require("discord.js");
const { getGuildData, clearUpdateInterval } = require("../utils/playerStore");
const { setGuildSetting, getGuildSettings } = require("../utils/database");
const { resolveGuild } = require("../utils/guildBranding");
const { createChatPlayIdleContainer } = require("../utils/components");
const { getT } = require("../i18n");
const { createPreferredConnection } = require("../utils/lavalink");
const {
    isPlayerConnectionHealthy,
    destroyPlayerSafe,
    getAllPlayers,
    safePlayerPlay,
} = require("../utils/playerConnection");
const { clearPlayerUiBlocked } = require("../utils/playerMessageDelivery");
const {
    capturePlayerSnapshot,
    shouldSnapshotPlayer,
} = require("./lavalinkRecovery");
const { maybePromptOnQueueEnd } = require("../utils/votePrompt");

const IDLE_LEAVE_MS = 30 * 1000;
const ALONE_LEAVE_MS = 15 * 1000; // leave sooner when the voice channel has no users
const AUTOPLAY_WATCHDOG_MS = 8 * 1000;
const RECONNECT_247_DELAY_MS = 1500;
const RECONNECT_247_MAX_ATTEMPTS = 5;
const reconnect247Timers = new Map();
const pending247Snapshots = new Map();

function cancelScheduledLeave(guildData) {
    if (guildData.idleTimeout) {
        clearTimeout(guildData.idleTimeout);
        guildData.idleTimeout = null;
    }
}

function cancelAloneLeaveTimer(guildData) {
    if (guildData.aloneLeaveTimeout) {
        clearTimeout(guildData.aloneLeaveTimeout);
        guildData.aloneLeaveTimeout = null;
    }
}

function isPlayerIdle(player) {
    if (!player) return true;
    const hasQueue = player.queue?.length > 0;
    return !player.playing && !player.paused && !hasQueue;
}

function abandonFailedPlayConnection(client, guildId, joinedForThisRequest) {
    if (!joinedForThisRequest) return;

    const guildData = getGuildData(guildId);
    if (guildData.twentyFourSeven) return;

    const player = client.riffy?.players.get(guildId);
    if (!isPlayerIdle(player)) return;

    try {
        player.destroy();
    } catch {
        // player already gone
    }
}

async function resetChatPlayToIdle(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.chatPlayChannelId || !guildData.chatPlayMessageId) return;

    const t = getT.forGuild(guildId, client);
    const { editChatPlayMessage, recreateChatPlayMessageFromState } = require("./chatPlayPlayer");
    const guild = resolveGuild(client, guildId);
    const ok = await editChatPlayMessage(
        client,
        guildId,
        createChatPlayIdleContainer(t, guildData, guild, client)
    );
    if (!ok) {
        await recreateChatPlayMessageFromState(client, guildId);
    }
}

async function recreateChatPlayMessage(client, guildId) {
    const { recreateChatPlayMessageFromState } = require("./chatPlayPlayer");
    return recreateChatPlayMessageFromState(client, guildId);
}

async function clearRegularPlayerMessage(client, guildData) {
    if (!guildData.playerMessageId || !guildData.playerChannelId) return;

    try {
        const channel = client.channels.cache.get(guildData.playerChannelId);
        if (channel) {
            const msg = await channel.messages.fetch(guildData.playerMessageId);
            await msg.delete();
        }
    } catch (err) {
        // message already deleted
    }

    guildData.playerMessageId = null;
    guildData.playerChannelId = null;
}

function scheduleIdleLeave(client, guildId) {
    const guildData = getGuildData(guildId);
    if (guildData.twentyFourSeven) return;

    cancelScheduledLeave(guildData);

    guildData.idleTimeout = setTimeout(() => {
        try {
            const currentGuildData = getGuildData(guildId);
            if (currentGuildData.twentyFourSeven) return;

            const player = client.riffy?.players.get(guildId);
            if (player && isPlayerIdle(player)) {
                player.destroy();
            }
        } catch (err) {
            // player already destroyed
        }
        guildData.idleTimeout = null;
    }, IDLE_LEAVE_MS);
}

function scheduleAloneLeave(client, guildId) {
    const guildData = getGuildData(guildId);
    if (guildData.twentyFourSeven) return;

    cancelAloneLeaveTimer(guildData);

    guildData.aloneLeaveTimeout = setTimeout(async () => {
        guildData.aloneLeaveTimeout = null;

        const currentGuildData = getGuildData(guildId);
        if (currentGuildData.twentyFourSeven) return;

        const guild = client.guilds.cache.get(guildId);
        const botMember = guild?.members.cache.get(client.user.id);
        const voiceChannel = botMember?.voice?.channel;

        if (!voiceChannel) return;

        const humans = voiceChannel.members.filter((m) => !m.user.bot);
        if (humans.size > 0) return;

        const player = client.riffy?.players.get(guildId);
        if (player) {
            await transitionToIdle(client, guildId, { scheduleLeave: false });
            player.destroy();
        }
    }, ALONE_LEAVE_MS);
}

function cancelAloneLeaveIfUsersPresent(client, guildId) {
    const guild = client.guilds.cache.get(guildId);
    const botMember = guild?.members.cache.get(client.user.id);
    const voiceChannel = botMember?.voice?.channel;
    if (!voiceChannel) return;

    const humans = voiceChannel.members.filter((m) => !m.user.bot);
    if (humans.size > 0) {
        cancelAloneLeaveTimer(getGuildData(guildId));
    }
}

async function transitionToIdle(client, guildId, { scheduleLeave = true } = {}) {
    const guildData = getGuildData(guildId);

    clearUpdateInterval(guildData);
    guildData.suggestions = [];

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        await resetChatPlayToIdle(client, guildId);
    } else {
        await clearRegularPlayerMessage(client, guildData);
    }

    if (scheduleLeave) {
        scheduleIdleLeave(client, guildId);
    }
}

async function handleQueueEnd(client, player) {
    const guildData = getGuildData(player.guildId);
    if (guildData.lavalinkSuspended) return;
    if (pending247Snapshots.has(player.guildId)) return;

    clearUpdateInterval(guildData);
    clearPlayerUiBlocked(guildData);

    if (guildData.autoplay) {
        try {
            player.autoplay(player);
        } catch (err) {
            console.error("[Musicify] Autoplay failed:", err.message);
            await transitionToIdle(client, player.guildId);
            return;
        }

        if (guildData.autoplayWatchdog) {
            clearTimeout(guildData.autoplayWatchdog);
        }

        guildData.autoplayWatchdog = setTimeout(async () => {
            guildData.autoplayWatchdog = null;
            const currentPlayer = client.riffy?.players.get(player.guildId);
            if (!currentPlayer?.current && !currentPlayer?.playing) {
                await transitionToIdle(client, player.guildId);
            }
        }, AUTOPLAY_WATCHDOG_MS);

        return;
    }

    await transitionToIdle(client, player.guildId);
    void maybePromptOnQueueEnd(client, player.guildId, player).catch((err) => {
        console.warn("[Musicify] Vote prompt on queue end failed:", err.message);
    });
}

async function handlePlayerDisconnect(client, player) {
    const guildData = getGuildData(player.guildId);
    if (guildData.lavalinkSuspended) return;

    clearUpdateInterval(guildData);
    cancelScheduledLeave(guildData);
    cancelAloneLeaveTimer(guildData);

    if (guildData.autoplayWatchdog) {
        clearTimeout(guildData.autoplayWatchdog);
        guildData.autoplayWatchdog = null;
    }

    if (pending247Snapshots.has(player.guildId)) {
        return;
    }

    if (guildData.twentyFourSeven && guildData.boundVoiceChannelId) {
        if (savePending247Snapshot(client, player)) {
            scheduleTwentyFourSevenReconnect(client, player.guildId);
            return;
        }
    }

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        await resetChatPlayToIdle(client, player.guildId);
    } else {
        await clearRegularPlayerMessage(client, guildData);
    }

    guildData.suggestions = [];
    guildData.previousTracks = [];
}

async function ensureVoiceConnection(client, guildId, voiceChannelId, textChannelId) {
    return createPreferredConnection(client, {
        guildId,
        voiceChannel: voiceChannelId,
        textChannel: textChannelId,
        deaf: true,
    });
}

async function toggleTwentyFourSeven(client, guildId, { voiceChannelId, textChannelId, enabled = null }) {
    const guildData = getGuildData(guildId);
    const dbSettings = getGuildSettings(guildId);
    const newState = enabled !== null ? enabled : !dbSettings.twentyFourSeven;

    guildData.twentyFourSeven = newState;
    setGuildSetting(guildId, "twentyFourSeven", newState);

    if (newState) {
        cancelScheduledLeave(guildData);
        cancelAloneLeaveTimer(guildData);

        guildData.boundVoiceChannelId = voiceChannelId;
        setGuildSetting(guildId, "boundVoiceChannelId", voiceChannelId);

        await ensureVoiceConnection(client, guildId, voiceChannelId, textChannelId);
    } else {
        clearTwentyFourSevenReconnectTimer(guildId);
        guildData.boundVoiceChannelId = null;
        setGuildSetting(guildId, "boundVoiceChannelId", null);

        const player = client.riffy?.players.get(guildId);
        if (isPlayerIdle(player)) {
            await transitionToIdle(client, guildId, { scheduleLeave: false });
            if (player) {
                player.destroy();
            }
        }
    }

    if (guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        const player = client.riffy?.players.get(guildId);
        if (player?.current) {
            const { refreshPlayerMessage } = require("../handlers/playerHandler");
            await refreshPlayerMessage(client, guildId);
        } else {
            await resetChatPlayToIdle(client, guildId);
        }
    }

    return newState;
}

function restoreSessionFromDatabase(guildId, settings) {
    const guildData = getGuildData(guildId);

    if (settings.twentyFourSeven) {
        guildData.twentyFourSeven = true;
    }
    if (settings.boundVoiceChannelId) {
        guildData.boundVoiceChannelId = settings.boundVoiceChannelId;
    }
    if (typeof settings.defaultVolume === "number") {
        guildData.volume = settings.defaultVolume;
    }
    if (typeof settings.defaultAutoplay === "boolean") {
        guildData.autoplay = settings.defaultAutoplay;
    }
}

async function reconnectTwentyFourSeven(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.twentyFourSeven || !guildData.boundVoiceChannelId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const voiceChannel = guild.channels.cache.get(guildData.boundVoiceChannelId);
    if (!voiceChannel) return;

    const botMember = guild.members.cache.get(client.user.id);
    const player = client.riffy?.players.get(guildId);
    if (
        botMember?.voice?.channelId === guildData.boundVoiceChannelId &&
        isPlayerConnectionHealthy(client, guildId, player, guildData.boundVoiceChannelId)
    ) {
        return;
    }

    if (player) {
        destroyPlayerSafe(client, guildId);
    }

    const textChannelId = guildData.chatPlayChannelId || guildData.playerChannelId;
    if (!textChannelId) return;

    await ensureVoiceConnection(
        client,
        guildId,
        guildData.boundVoiceChannelId,
        textChannelId
    );
}

function clearPending247Snapshot(guildId) {
    pending247Snapshots.delete(guildId);
}

function savePending247Snapshot(client, player) {
    const snapshot = capturePlayerSnapshot(client, player);
    if (!snapshot) return false;

    if (!snapshot.voiceChannelId || !snapshot.textChannelId) {
        return false;
    }

    pending247Snapshots.set(player.guildId, snapshot);
    return true;
}

function hasPending247Snapshot(guildId) {
    return pending247Snapshots.has(guildId);
}

async function resumeTwentyFourSevenPlayback(client, guildId) {
    const snapshot = pending247Snapshots.get(guildId);
    if (!snapshot) return false;

    pending247Snapshots.delete(guildId);

    const guildData = getGuildData(guildId);
    const voiceChannelId = snapshot.voiceChannelId || guildData.boundVoiceChannelId;
    const textChannelId =
        snapshot.textChannelId || guildData.chatPlayChannelId || guildData.playerChannelId;

    if (!voiceChannelId || !textChannelId) {
        return false;
    }

    let player = client.riffy.players.get(guildId);
    if (!isPlayerConnectionHealthy(client, guildId, player, voiceChannelId)) {
        destroyPlayerSafe(client, guildId);
        player = null;
    }

    if (!player) {
        try {
            player = createPreferredConnection(client, {
                guildId,
                voiceChannel: voiceChannelId,
                textChannel: textChannelId,
                deaf: true,
            });
        } catch (err) {
            console.error(
                `[Musicify] 24/7 resume connection failed for guild ${guildId}:`,
                err.message
            );
            return false;
        }
    } else if (player.voiceChannel !== voiceChannelId) {
        player.setVoiceChannel(voiceChannelId, { deaf: true });
    }

    if (player.textChannel !== textChannelId) {
        player.setTextChannel(textChannelId);
    }

    player.queue.clear();
    player.setVolume(snapshot.volume);
    player.setLoop(snapshot.loop || "none");

    if (snapshot.current) {
        player.queue.add(snapshot.current);
    }
    for (const track of snapshot.queue) {
        player.queue.add(track);
    }

    if (!snapshot.current && snapshot.queue.length === 0) {
        return false;
    }

    guildData.pendingLavalinkSeek = snapshot.position > 0 ? snapshot.position : null;
    guildData.pendingLavalinkPause = snapshot.paused;
    guildData.lavalinkRecovering = true;

    const playResult = await safePlayerPlay(player, guildId);
    if (!playResult.ok) {
        guildData.lavalinkRecovering = false;
        guildData.pendingLavalinkSeek = null;
        guildData.pendingLavalinkPause = false;
        return false;
    }
    return true;
}

async function finishTwentyFourSevenReconnect(client, guildId) {
    const guildData = getGuildData(guildId);
    const resumed = await resumeTwentyFourSevenPlayback(client, guildId);

    if (!resumed && guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
        await resetChatPlayToIdle(client, guildId);
    }
}

function clearTwentyFourSevenReconnectTimer(guildId) {
    const timer = reconnect247Timers.get(guildId);
    if (timer) {
        clearTimeout(timer);
        reconnect247Timers.delete(guildId);
    }
}

async function attemptTwentyFourSevenReconnect(client, guildId, attempt = 1) {
    const guildData = getGuildData(guildId);
    if (!guildData.twentyFourSeven || !guildData.boundVoiceChannelId) {
        clearTwentyFourSevenReconnectTimer(guildId);
        return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const botMember = guild.members.cache.get(client.user.id);
    const player = client.riffy?.players.get(guildId);
    if (botMember?.voice?.channelId === guildData.boundVoiceChannelId) {
        if (isPlayerConnectionHealthy(client, guildId, player, guildData.boundVoiceChannelId)) {
            clearTwentyFourSevenReconnectTimer(guildId);
            if (pending247Snapshots.has(guildId)) {
                const resumed = await resumeTwentyFourSevenPlayback(client, guildId);
                if (!resumed && guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
                    await resetChatPlayToIdle(client, guildId);
                }
            }
            return;
        }

        destroyPlayerSafe(client, guildId);
    }

    const voiceChannel =
        guild.channels.cache.get(guildData.boundVoiceChannelId) ??
        (await guild.channels.fetch(guildData.boundVoiceChannelId).catch(() => null));

    if (!voiceChannel) {
        console.warn(
            `[Musicify] 24/7 bound channel missing for guild ${guildId}, disabling 24/7`
        );
        clearTwentyFourSevenReconnectTimer(guildId);
        clearPending247Snapshot(guildId);
        await toggleTwentyFourSeven(client, guildId, { enabled: false });
        return;
    }

    const permissions = voiceChannel.permissionsFor(botMember);
    if (!permissions?.has("Connect") || !permissions?.has("Speak")) {
        console.warn(
            `[Musicify] Missing voice permissions for 24/7 reconnect in guild ${guildId}`
        );
        if (attempt >= RECONNECT_247_MAX_ATTEMPTS) {
            clearTwentyFourSevenReconnectTimer(guildId);
            clearPending247Snapshot(guildId);
            await finishTwentyFourSevenReconnect(client, guildId);
        } else {
            setTimeout(
                () => attemptTwentyFourSevenReconnect(client, guildId, attempt + 1),
                RECONNECT_247_DELAY_MS * attempt
            );
        }
        return;
    }

    try {
        if (pending247Snapshots.has(guildId)) {
            const resumed = await resumeTwentyFourSevenPlayback(client, guildId);
            if (!resumed && guildData.chatPlayChannelId && guildData.chatPlayMessageId) {
                await resetChatPlayToIdle(client, guildId);
            }
        } else {
            await reconnectTwentyFourSeven(client, guildId);
        }

        clearTwentyFourSevenReconnectTimer(guildId);
    } catch (err) {
        console.error(
            `[Musicify] 24/7 reconnect attempt ${attempt} failed for guild ${guildId}:`,
            err.message
        );
        if (attempt < RECONNECT_247_MAX_ATTEMPTS) {
            setTimeout(
                () => attemptTwentyFourSevenReconnect(client, guildId, attempt + 1),
                RECONNECT_247_DELAY_MS * attempt
            );
        } else {
            clearPending247Snapshot(guildId);
            await finishTwentyFourSevenReconnect(client, guildId);
        }
    }
}

function scheduleTwentyFourSevenReconnect(client, guildId) {
    const guildData = getGuildData(guildId);
    if (!guildData.twentyFourSeven || !guildData.boundVoiceChannelId) return;

    clearTwentyFourSevenReconnectTimer(guildId);

    reconnect247Timers.set(
        guildId,
        setTimeout(() => {
            reconnect247Timers.delete(guildId);
            attemptTwentyFourSevenReconnect(client, guildId).catch((err) => {
                console.error(`[Musicify] 24/7 reconnect failed for guild ${guildId}:`, err.message);
            });
        }, RECONNECT_247_DELAY_MS)
    );
}

function cleanupIdle247PlayersOnNodeDisconnect(client, disconnectedNode) {
    const disconnectedName = disconnectedNode?.name;

    for (const player of getAllPlayers(client)) {
        if (disconnectedName && player.node?.name !== disconnectedName) continue;
        if (shouldSnapshotPlayer(player)) continue;

        const guildData = getGuildData(player.guildId);
        destroyPlayerSafe(client, player.guildId);

        if (guildData.twentyFourSeven && guildData.boundVoiceChannelId) {
            scheduleTwentyFourSevenReconnect(client, player.guildId);
        }
    }
}

async function handleStop(client, guildId, { destroyPlayer = null } = {}) {
    const guildData = getGuildData(guildId);
    const player = client.riffy?.players.get(guildId);

    clearUpdateInterval(guildData);
    cancelScheduledLeave(guildData);
    guildData.suggestions = [];
    guildData.previousTracks = [];

    if (player) {
        player.queue.clear();
        player.stop();
    }

    const shouldStay = destroyPlayer === false || (destroyPlayer === null && guildData.twentyFourSeven);

    if (shouldStay) {
        await resetChatPlayToIdle(client, guildId);
        if (!guildData.chatPlayChannelId) {
            await clearRegularPlayerMessage(client, guildData);
        }
        return { stayed: true };
    }

    await transitionToIdle(client, guildId, { scheduleLeave: false });
    if (player) {
        player.destroy();
    }

    return { stayed: false };
}

module.exports = {
    cancelScheduledLeave,
    cancelAloneLeaveTimer,
    cancelAloneLeaveIfUsersPresent,
    scheduleAloneLeave,
    resetChatPlayToIdle,
    recreateChatPlayMessage,
    clearRegularPlayerMessage,
    transitionToIdle,
    handleQueueEnd,
    handlePlayerDisconnect,
    toggleTwentyFourSeven,
    restoreSessionFromDatabase,
    reconnectTwentyFourSeven,
    scheduleTwentyFourSevenReconnect,
    savePending247Snapshot,
    hasPending247Snapshot,
    cleanupIdle247PlayersOnNodeDisconnect,
    handleStop,
    isPlayerIdle,
    abandonFailedPlayConnection,
};
