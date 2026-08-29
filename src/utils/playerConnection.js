const { isNodeConnected, getPreferredNode } = require("./lavalink");

const VOICE_READY_TIMEOUT_MS = 10_000;

function isPlayerVoicePlaybackReady(player) {
    const connection = player?.connection;
    return Boolean(connection?.isReady && !connection.establishing);
}

function waitForPlayerVoiceReady(player, timeoutMs = VOICE_READY_TIMEOUT_MS) {
    if (isPlayerVoicePlaybackReady(player)) {
        return Promise.resolve(true);
    }

    if (!player?.connection) {
        return Promise.resolve(false);
    }

    const riffy = player.riffy;

    return new Promise((resolve) => {
        let settled = false;

        const finish = (ready) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (riffy) riffy.off("playerUpdate", onPlayerUpdate);
            player.off("connectionRestored", onConnectionRestored);
            resolve(ready);
        };

        const checkReady = () => isPlayerVoicePlaybackReady(player);

        const onPlayerUpdate = (updatedPlayer) => {
            if (updatedPlayer.guildId !== player.guildId) return;
            if (checkReady()) finish(true);
        };

        const onConnectionRestored = () => {
            if (checkReady()) finish(true);
        };

        const timer = setTimeout(() => finish(checkReady()), timeoutMs);

        if (riffy) riffy.on("playerUpdate", onPlayerUpdate);
        player.on("connectionRestored", onConnectionRestored);

        if (checkReady()) finish(true);
    });
}

function isTransientPlayError(err) {
    const message = err?.message || String(err);
    return (
        message.includes("establishing") ||
        message.includes("connection is not initiated") ||
        message.includes("Connection timed out") ||
        message.includes("Voice connection not ready")
    );
}

function destroyPlayerSafe(client, guildId) {
    const player = client.riffy?.players.get(guildId);
    if (!player) return false;

    try {
        player.destroy();
        return true;
    } catch {
        return false;
    }
}

/**
 * Returns true when the in-memory player can accept playback on the expected voice channel.
 */
function isPlayerConnectionHealthy(client, guildId, player, expectedVoiceChannelId = null) {
    if (!player) return false;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return false;

    const targetVoiceChannelId = expectedVoiceChannelId || player.voiceChannel;
    if (!targetVoiceChannelId) return false;

    const botVoiceChannelId = guild.members.me?.voice?.channelId;
    if (botVoiceChannelId && botVoiceChannelId !== targetVoiceChannelId) {
        return false;
    }

    if (player.voiceChannel && player.voiceChannel !== targetVoiceChannelId) {
        return false;
    }

    if (!isNodeConnected(player.node)) {
        return false;
    }

    return true;
}

function getOrCreateHealthyPlayer(client, options) {
    if (!client.riffy?.initiated) {
        throw new Error("Riffy is not initialized");
    }

    const { guildId, voiceChannel, textChannel, deaf = true } = options;
    const existing = client.riffy.players.get(guildId);

    if (isPlayerConnectionHealthy(client, guildId, existing, voiceChannel)) {
        if (existing.textChannel !== textChannel) {
            existing.setTextChannel(textChannel);
        }
        return existing;
    }

    if (existing) {
        destroyPlayerSafe(client, guildId);
    }

    const node = getPreferredNode(client);
    if (!node) {
        throw new Error("No Lavalink nodes are available");
    }

    return client.riffy.createPlayer(node, {
        guildId,
        voiceChannel,
        textChannel,
        deaf,
    });
}

function getAllPlayers(client) {
    const players = client.riffy?.players;
    if (!players) return [];
    if (players instanceof Map) return [...players.values()];
    if (typeof players.values === "function") return [...players.values()];
    return Object.values(players || {});
}

/**
 * Start or resume playback without unhandled rejections from Riffy.
 * @returns {Promise<{ ok: boolean, error?: Error }>}
 */
async function safePlayerPlay(player, guildId) {
    if (!player) {
        return { ok: false, error: new Error("No player") };
    }

    if (!player.queue?.length && !player.current) {
        return { ok: false, error: new Error("Queue is empty") };
    }

    const voiceReady = await waitForPlayerVoiceReady(player);
    if (!voiceReady || !player.connection) {
        console.warn(
            `[Musicify] Voice connection not ready for guild ${guildId}; skipping play()`
        );
        return { ok: false, error: new Error("Voice connection not ready") };
    }

    try {
        await player.play();
        return { ok: true };
    } catch (err) {
        const message = err?.message || String(err);
        if (isTransientPlayError(err)) {
            console.warn(
                `[Musicify] player.play() skipped for guild ${guildId}: ${message}`
            );
        } else {
            console.error(
                `[Musicify] player.play() failed for guild ${guildId}:`,
                message
            );
        }
        return { ok: false, error: err };
    }
}

module.exports = {
    destroyPlayerSafe,
    isPlayerConnectionHealthy,
    getOrCreateHealthyPlayer,
    getAllPlayers,
    safePlayerPlay,
};
