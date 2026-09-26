const { Events, REST, Routes } = require("discord.js");

const GATEWAY_STATUS = [
    "Ready",
    "Connecting",
    "Reconnecting",
    "Idle",
    "Nearly",
    "Disconnected",
    "WaitingForGuilds",
    "Identifying",
    "Resuming",
];

function formatGatewayStatus(client) {
    const code = client?.ws?.status;
    if (typeof code !== "number") return "unknown";
    return GATEWAY_STATUS[code] ?? `code_${code}`;
}

/**
 * REST check — fails fast on bad token or blocked outbound HTTPS to Discord.
 */
async function validateBotToken(token) {
    const rest = new REST({ version: "10", timeout: 15_000 }).setToken(token);
    const me = await rest.get(Routes.user("@me"));
    return me?.id ? String(me.id) : null;
}

function attachGatewayDiagnostics(client, loginStartedAt) {
    const logDebug =
        process.env.DISCORD_DEBUG === "true" || Boolean(process.env.RAILWAY_ENVIRONMENT);

    if (logDebug) {
        client.on(Events.Debug, (message) => {
            if (
                /gateway|session limit|identifying|resum|connect|closed|heartbeat|shard/i.test(
                    message
                )
            ) {
                console.log(`[Discord] ${message}`);
            }
        });
    }

    client.on("shardError", (error, shardId) => {
        console.error(`[Musicify] Shard ${shardId} error:`, error);
    });

    client.on("shardDisconnect", (event, shardId) => {
        console.error(
            `[Musicify] Shard ${shardId} disconnected (code ${event?.code ?? "?"}).`
        );
    });

    client.on("shardReconnecting", (shardId) => {
        console.warn(`[Musicify] Shard ${shardId} reconnecting…`);
    });

    client.on("shardReady", (shardId) => {
        console.log(`[Musicify] Shard ${shardId} ready (guild sync complete).`);
    });

    const statusTimer = setInterval(() => {
        if (client.isReady()) {
            clearInterval(statusTimer);
            return;
        }
        const elapsedSec = Math.round((Date.now() - loginStartedAt) / 1000);
        console.warn(
            `[Musicify] Gateway still not ready after ${elapsedSec}s (status: ${formatGatewayStatus(client)}).`
        );
    }, 30_000);
    statusTimer.unref();
}

module.exports = {
    attachGatewayDiagnostics,
    validateBotToken,
    formatGatewayStatus,
};
