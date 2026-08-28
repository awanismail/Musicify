require("dotenv").config();

const { Client, GatewayIntentBits, GatewayDispatchEvents } = require("discord.js");
const { Riffy } = require("riffy");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { initI18n } = require("./i18n");
const { loadCommands } = require("./handlers/commandHandler");
const { setupPlayerHandler } = require("./handlers/playerHandler");
const db = require("./db/sqlite");
const { runBackup, stopBackupScheduler } = require("./db/backup");
const { startTopGgWebhookServer } = require("./services/topGgWebhook");

async function start() {
    await initI18n();

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.GuildVoiceStates,
            GatewayIntentBits.MessageContent,
        ],
    });

    client.riffy = new Riffy(client, config.nodes, {
        send: (payload) => {
            const guild = client.guilds.cache.get(payload.d.guild_id);
            if (guild) guild.shard.send(payload);
        },
        defaultSearchPlatform: config.defaultSearchPlatform || "ytmsearch",
        restVersion: config.restVersion || "v4",
        bypassChecks: {
            nodeFetchInfo: true,
        },
    });

    loadCommands(client);

    const eventsPath = path.join(__dirname, "events");
    if (fs.existsSync(eventsPath)) {
        const eventFiles = fs.readdirSync(eventsPath).filter((f) => f.endsWith(".js"));
        for (const file of eventFiles) {
            const event = require(path.join(eventsPath, file));
            if (event.once) {
                client.once(event.name, (...args) => event.execute(client, ...args));
            } else {
                client.on(event.name, (...args) => event.execute(client, ...args));
            }
            console.log(`[Musicify] Loaded event: ${event.name}`);
        }
    }

    setupPlayerHandler(client);

    process.on("unhandledRejection", (reason) => {
        const message = reason?.message || String(reason);
        if (message.includes("Queue is empty")) return;
        if (message.includes("establishing") || message.includes("connection not ready")) return;
        console.error("[Musicify] Unhandled Rejection:", reason);
    });

    process.on("uncaughtException", (error) => {
        console.error("[Musicify] Uncaught Exception:", error);
    });

    process.on("uncaughtExceptionMonitor", (error) => {
        console.error("[Musicify] Uncaught Exception (monitor):", error);
    });

    client.riffy.on("playerError", (player, error) => {
        console.error(`[Musicify] Player error in ${player.guildId}:`, error);
    });

    client.on("raw", (d) => {
        if (
            ![
                GatewayDispatchEvents.VoiceStateUpdate,
                GatewayDispatchEvents.VoiceServerUpdate,
            ].includes(d.t)
        )
            return;
        client.riffy.updateVoiceState(d);
    });

    const token = process.env.BOT_TOKEN;
    if (!token) {
        console.error("[Musicify] BOT_TOKEN is not set in .env file!");
        process.exit(1);
    }

    await client.login(token);

    startTopGgWebhookServer(client);

    let shuttingDown = false;

    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;

        console.log(`[Musicify] ${signal} received — saving database backup...`);
        stopBackupScheduler();
        await runBackup(db);

        try {
            client.destroy();
        } catch {}

        process.exit(0);
    }

    process.on("SIGINT", () => {
        void shutdown("SIGINT");
    });

    process.on("SIGTERM", () => {
        void shutdown("SIGTERM");
    });
}

start().catch((error) => {
    console.error("[Musicify] Failed to start:", error);
    process.exit(1);
});
