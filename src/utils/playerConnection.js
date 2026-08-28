const { isNodeConnected, getPreferredNode } = require("./lavalink");

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

    if (!player.connection) {
        console.warn(
            `[Musicify] Voice connection not ready for guild ${guildId}; skipping play()`
        );
        return { ok: false, error: new Error("Voice connection not ready") };
    }

    try {
        await player.play();
        return { ok: true };
    } catch (err) {
        console.error(
            `[Musicify] player.play() failed for guild ${guildId}:`,
            err?.message || err
        );
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
