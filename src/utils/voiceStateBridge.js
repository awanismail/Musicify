const { GatewayDispatchEvents } = require("discord.js");

function isTransientVoiceStateError(err) {
    const message = err?.message || String(err);
    return (
        message.includes("Missing 'endpoint' property") ||
        message.includes("establishing") ||
        message.includes("connection is not initiated") ||
        message.includes("Connection timed out") ||
        message.includes("Voice connection not ready")
    );
}

/**
 * Discord may emit VOICE_SERVER_UPDATE with a null endpoint during region
 * changes or reconnects. Riffy throws on those — skip until a valid packet arrives.
 */
function shouldForwardVoicePacket(packet) {
    if (packet.t !== GatewayDispatchEvents.VoiceServerUpdate) {
        return true;
    }

    return Boolean(packet.d?.endpoint);
}

/**
 * Forward voice gateway packets to Riffy without unhandled rejections.
 */
function forwardVoiceStateToRiffy(client, packet) {
    if (!client?.riffy?.updateVoiceState) {
        return;
    }

    if (!shouldForwardVoicePacket(packet)) {
        return;
    }

    void client.riffy.updateVoiceState(packet).catch((err) => {
        if (isTransientVoiceStateError(err)) {
            return;
        }

        const guildId = packet.d?.guild_id ?? "unknown";
        console.warn(
            `[Musicify] Voice state update failed for guild ${guildId}:`,
            err.message
        );
    });
}

module.exports = {
    isTransientVoiceStateError,
    shouldForwardVoicePacket,
    forwardVoiceStateToRiffy,
};
