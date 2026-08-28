const { ContainerBuilder, TextDisplayBuilder, MessageFlags } = require("discord.js");
const { getGuildData } = require("../utils/playerStore");
const { isLavalinkAvailable, getStatusCommandRef, createPreferredConnection } = require("../utils/lavalink");
const { safePlayerPlay } = require("../utils/playerConnection");
const { getT } = require("../i18n");

const pendingSnapshots = new Map();
let lavalinkOutageActive = false;
let resumeInProgress = false;
let resumeTimer = null;

function getAllPlayers(client) {
    const players = client.riffy?.players;
    if (!players) return [];
    if (players instanceof Map) return [...players.values()];
    if (typeof players.values === "function") return [...players.values()];
    return Object.values(players);
}

function cloneQueue(player) {
    if (!player.queue?.length) return [];
    if (typeof player.queue.slice === "function") {
        return player.queue.slice();
    }
    return Array.from(player.queue);
}

function shouldSnapshotPlayer(player) {
    return Boolean(
        player.current ||
        player.queue?.length > 0 ||
        player.playing ||
        player.paused
    );
}

function resolveNotifyChannelId(guildData, player) {
    const textChannelId = player.textChannel;
    if (guildData.chatPlayChannelId && textChannelId === guildData.chatPlayChannelId) {
        return guildData.chatPlayChannelId;
    }
    return guildData.playerChannelId || textChannelId || guildData.chatPlayChannelId;
}

function isLavalinkSuspended(guildId) {
    const guildData = getGuildData(guildId);
    return Boolean(guildData.lavalinkSuspended || pendingSnapshots.has(guildId));
}

function isLavalinkOutageActive() {
    return lavalinkOutageActive;
}

function buildSnapshot(client, player) {
    const guildData = getGuildData(player.guildId);
    return {
        guildId: player.guildId,
        voiceChannelId: player.voiceChannel || guildData.boundVoiceChannelId,
        textChannelId:
            player.textChannel || guildData.chatPlayChannelId || guildData.playerChannelId,
        notifyChannelId: resolveNotifyChannelId(guildData, player),
        current: player.current ?? null,
        queue: cloneQueue(player),
        position: player.position || 0,
        volume: guildData.volume ?? 75,
        loop: guildData.loop ?? "none",
        paused: Boolean(player.paused),
        notifyMessageId: null,
    };
}

async function buildDisconnectNoticeContainer(client, guildId) {
    const t = getT.forGuild(guildId, client);
    const cmdStatus = await getStatusCommandRef(client);

    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `## ⏳ ${t("errors.lavalink.disconnectedHeading")}\n\n` +
                `${t("errors.lavalink.disconnectedBody")}\n\n` +
                `-# ${t("errors.lavalink.disconnectedHint", { cmdStatus })}`
        )
    );
    return container;
}

async function sendDisconnectNotice(client, snapshot) {
    if (!snapshot.notifyChannelId) return;

    const channel = client.channels.cache.get(snapshot.notifyChannelId);
    if (!channel) return;

    try {
        const container = await buildDisconnectNoticeContainer(client, snapshot.guildId);
        const message = await channel.send({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
        snapshot.notifyMessageId = message.id;
    } catch (err) {
        console.error(
            `[Musicify] Failed to send Lavalink disconnect notice for guild ${snapshot.guildId}:`,
            err.message
        );
    }
}

async function deleteDisconnectNotice(client, guildData) {
    if (!guildData.lavalinkNotifyMessageId || !guildData.lavalinkNotifyChannelId) return;

    try {
        const channel = client.channels.cache.get(guildData.lavalinkNotifyChannelId);
        if (!channel) return;
        const message = await channel.messages.fetch(guildData.lavalinkNotifyMessageId);
        await message.delete();
    } catch {
        // message already gone
    } finally {
        guildData.lavalinkNotifyMessageId = null;
        guildData.lavalinkNotifyChannelId = null;
    }
}

async function suspendPlayersForLavalinkDisconnect(client, disconnectedNode) {
    lavalinkOutageActive = true;
    const disconnectedName = disconnectedNode?.name;

    for (const player of getAllPlayers(client)) {
        if (disconnectedName && player.node?.name !== disconnectedName) continue;
        if (!shouldSnapshotPlayer(player)) continue;
        if (pendingSnapshots.has(player.guildId)) continue;

        const snapshot = buildSnapshot(client, player);
        const guildData = getGuildData(player.guildId);
        guildData.lavalinkSuspended = true;

        pendingSnapshots.set(player.guildId, snapshot);
        await sendDisconnectNotice(client, snapshot);

        try {
            player.destroy();
        } catch {
            // stale player on disconnected node
        }
    }

    if (pendingSnapshots.size > 0) {
        console.log(
            `[Musicify] Suspended ${pendingSnapshots.size} player(s) after Lavalink node "${disconnectedName ?? "unknown"}" disconnected`
        );

        if (isLavalinkAvailable(client)) {
            scheduleLavalinkRecovery(client);
        }
    } else if (!isLavalinkAvailable(client)) {
        lavalinkOutageActive = true;
    } else {
        lavalinkOutageActive = false;
    }
}

async function resumeSnapshot(client, snapshot) {
    const guildId = snapshot.guildId;
    const guildData = getGuildData(guildId);

    if (!snapshot.voiceChannelId || !snapshot.textChannelId) {
        guildData.lavalinkSuspended = false;
        pendingSnapshots.delete(guildId);
        return;
    }

    let player = client.riffy.players.get(guildId);
    if (player) {
        try {
            player.destroy();
        } catch {
            // stale player
        }
    }

    try {
        player = createPreferredConnection(client, {
            guildId,
            voiceChannel: snapshot.voiceChannelId,
            textChannel: snapshot.textChannelId,
            deaf: true,
        });
    } catch (err) {
        console.error(`[Musicify] Failed to recreate player for guild ${guildId}:`, err.message);
        return false;
    }

    player.setVolume(snapshot.volume);
    player.setLoop(snapshot.loop || "none");

    if (snapshot.current) {
        player.queue.add(snapshot.current);
    }
    for (const track of snapshot.queue) {
        player.queue.add(track);
    }

    if (!snapshot.current && snapshot.queue.length === 0) {
        guildData.lavalinkSuspended = false;
        pendingSnapshots.delete(guildId);
        return true;
    }

    if (snapshot.notifyMessageId && snapshot.notifyChannelId) {
        guildData.lavalinkNotifyMessageId = snapshot.notifyMessageId;
        guildData.lavalinkNotifyChannelId = snapshot.notifyChannelId;
    }

    if (snapshot.position > 0) {
        guildData.pendingLavalinkSeek = snapshot.position;
    }
    if (snapshot.paused) {
        guildData.pendingLavalinkPause = true;
    }

    guildData.lavalinkRecovering = true;
    const playResult = await safePlayerPlay(player, guildId);
    if (!playResult.ok) {
        guildData.lavalinkRecovering = false;
        guildData.pendingLavalinkSeek = null;
        guildData.pendingLavalinkPause = false;
        return false;
    }

    guildData.lavalinkSuspended = false;
    pendingSnapshots.delete(guildId);

    console.log(`[Musicify] Resumed playback for guild ${guildId}`);
    return true;
}

async function resumePlayersAfterLavalinkReconnect(client) {
    if (!isLavalinkAvailable(client) || pendingSnapshots.size === 0) {
        if (pendingSnapshots.size === 0) {
            lavalinkOutageActive = false;
        }
        return;
    }

    const snapshots = [...pendingSnapshots.values()];
    for (const snapshot of snapshots) {
        try {
            await resumeSnapshot(client, snapshot);
        } catch (err) {
            console.error(
                `[Musicify] Lavalink recovery failed for guild ${snapshot.guildId}:`,
                err.message
            );
        }
    }

    if (pendingSnapshots.size === 0) {
        lavalinkOutageActive = false;
    }
}

function scheduleLavalinkRecovery(client) {
    clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
        void tryResumePlayers(client);
    }, 1500);
}

async function tryResumePlayers(client) {
    if (resumeInProgress || pendingSnapshots.size === 0) return;
    if (!isLavalinkAvailable(client)) return;

    resumeInProgress = true;
    try {
        await resumePlayersAfterLavalinkReconnect(client);
    } finally {
        resumeInProgress = false;
    }
}

function handleRecoveryTrackStart(client, player) {
    const guildData = getGuildData(player.guildId);

    if (guildData.pendingLavalinkSeek != null) {
        const seekMs = guildData.pendingLavalinkSeek;
        guildData.pendingLavalinkSeek = null;
        if (seekMs > 0) {
            try {
                player.seek(seekMs);
            } catch (err) {
                console.error(
                    `[Musicify] Failed to seek after Lavalink recovery in ${player.guildId}:`,
                    err.message
                );
            }
        }
    }

    if (guildData.pendingLavalinkPause) {
        guildData.pendingLavalinkPause = false;
        try {
            player.pause(true);
        } catch {
            // ignore
        }
    }

    if (guildData.lavalinkRecovering) {
        guildData.lavalinkRecovering = false;
        void deleteDisconnectNotice(client, guildData);
    }
}

function capturePlayerSnapshot(client, player) {
    if (!shouldSnapshotPlayer(player)) return null;
    return buildSnapshot(client, player);
}

module.exports = {
    suspendPlayersForLavalinkDisconnect,
    scheduleLavalinkRecovery,
    isLavalinkSuspended,
    isLavalinkOutageActive,
    handleRecoveryTrackStart,
    capturePlayerSnapshot,
    restorePlayerSnapshot: resumeSnapshot,
    shouldSnapshotPlayer,
};
