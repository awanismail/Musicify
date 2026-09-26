const { REST, Routes, MessageFlags, AttachmentBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { readDB } = require("../utils/database");
const { getGuildData } = require("../utils/playerStore");
const {
    restoreSessionFromDatabase,
    reconnectTwentyFourSeven,
    recreateChatPlayMessage,
} = require("./sessionManager");
const { getT } = require("../i18n");

const CHATPLAY_CONCURRENCY = 4;

async function runConcurrent(items, limit, worker) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
        while (queue.length > 0) {
            const item = queue.shift();
            if (item === undefined) return;
            await worker(item);
        }
    });

    await Promise.all(workers);
}

async function restoreChatPlayGuild(client, guildId, settings) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return { restored: false, invalidMessage: false };

    const guildData = getGuildData(guildId);
    restoreSessionFromDatabase(guildId, settings);

    if (typeof settings.chatPlaySlowmode === "boolean") {
        guildData.chatPlaySlowmode = settings.chatPlaySlowmode;
    }
    if (typeof settings.chatPlayDeleteMessages === "boolean") {
        guildData.chatPlayDeleteMessages = settings.chatPlayDeleteMessages;
    }
    if (typeof settings.chatPlayPinPlayerMessage === "boolean") {
        guildData.chatPlayPinPlayerMessage = settings.chatPlayPinPlayerMessage;
    }
    if (typeof settings.chatPlaySmartFilter === "boolean") {
        guildData.chatPlaySmartFilter = settings.chatPlaySmartFilter;
    }

    if (!settings.chatPlayChannelId) {
        return { restored: false, invalidMessage: false };
    }

    guildData.chatPlayChannelId = settings.chatPlayChannelId;
    guildData.chatPlayEnabled = settings.chatPlayEnabled !== false;
    guildData.playerChannelId = settings.chatPlayChannelId;

    let invalidMessage = false;

    if (settings.chatPlayMessageId) {
        try {
            const channel = client.channels.cache.get(settings.chatPlayChannelId);
            if (channel) {
                await channel.messages.fetch(settings.chatPlayMessageId);
                guildData.chatPlayMessageId = settings.chatPlayMessageId;
            } else {
                guildData.chatPlayMessageId = null;
                invalidMessage = true;
            }
        } catch {
            guildData.chatPlayMessageId = null;
            invalidMessage = true;
        }
    } else {
        guildData.chatPlayMessageId = null;
    }

    if (!guildData.chatPlayMessageId) {
        try {
            await recreateChatPlayMessage(client, guildId);
        } catch (error) {
            console.error(
                `[Musicify] Failed to recreate ChatPlay message for guild ${guildId}:`,
                error.message
            );
        }
    }

    return { restored: true, invalidMessage };
}

async function restoreChatPlaySessions(client) {
    const db = readDB();
    const entries = Object.entries(db).filter(([, settings]) => settings.chatPlayChannelId);

    if (entries.length === 0) return;

    console.log(`[Musicify] Restoring ChatPlay for ${entries.length} guild(s) in background...`);

    let restoredCount = 0;
    let invalidMessages = 0;

    await runConcurrent(entries, CHATPLAY_CONCURRENCY, async ([guildId, settings]) => {
        const result = await restoreChatPlayGuild(client, guildId, settings);
        if (result.restored) restoredCount++;
        if (result.invalidMessage) invalidMessages++;
    });

    console.log(`[Musicify] ChatPlay restore finished (${restoredCount} guild(s)).`);
    if (invalidMessages > 0) {
        console.log(`[Musicify] Recreated ${invalidMessages} invalid ChatPlay message(s).`);
    }

    const reconnectTargets = Object.entries(db).filter(
        ([, settings]) => settings.twentyFourSeven && settings.boundVoiceChannelId
    );

    if (reconnectTargets.length > 0) {
        setTimeout(async () => {
            for (const [guildId] of reconnectTargets) {
                await reconnectTwentyFourSeven(client, guildId);
            }
        }, 3000);
    }

    setTimeout(async () => {
        for (const [guildId, settings] of Object.entries(db)) {
            if (!settings.chatPlayChannelId || !settings.chatPlayEnabled) continue;

            const guildData = getGuildData(guildId);
            const player = client.riffy.players.get(guildId);

            if (!player?.current || !guildData.chatPlayMessageId) continue;

            try {
                const { createChatPlayNowPlayingContainer } = require("../utils/components");
                const { generateMusicCard } = require("../utils/musicard");

                const tGuild = getT.forGuild(guildId, client);
                const musicardBuffer = await generateMusicCard(
                    player.current,
                    player,
                    guildData,
                    tGuild
                );
                const guild = client.guilds.cache.get(guildId);
                const container = createChatPlayNowPlayingContainer(
                    tGuild,
                    player.current,
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

                const channel = client.channels.cache.get(settings.chatPlayChannelId);
                if (!channel) continue;

                const msg = await channel.messages.fetch(guildData.chatPlayMessageId).catch(() => null);
                if (!msg) continue;

                await msg.edit({
                    components: [container],
                    files,
                    flags: MessageFlags.IsComponentsV2,
                });
            } catch (error) {
                console.error(
                    `[Musicify] Failed to update ChatPlay message for guild ${guildId}:`,
                    error.message
                );
            }
        }
    }, 5000);
}

async function deploySlashCommands(client) {
    if (process.env.AUTO_DEPLOY_COMMANDS === "false") {
        console.log("[Musicify] Skipping slash command deploy (AUTO_DEPLOY_COMMANDS=false).");
        return;
    }

    const startedAt = Date.now();
    const commands = [];
    const commandsPath = path.join(__dirname, "..", "commands");
    const commandFiles = fs.readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        if (command.data) {
            commands.push(command.data.toJSON());
        }
    }

    const rest = new REST({ version: "10" }).setToken(client.token);
    await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands,
    });

    console.log(
        `[Musicify] Auto-deployed ${commands.length} slash commands (${Date.now() - startedAt}ms).`
    );
}

function scheduleBackgroundStartupTasks(client) {
    setImmediate(() => {
        restoreChatPlaySessions(client).catch((error) => {
            console.error("[Musicify] ChatPlay background restore failed:", error.message);
        });
    });

    setImmediate(() => {
        deploySlashCommands(client).catch((error) => {
            console.error("[Musicify] Failed to auto-deploy commands:", error.message);
        });
    });
}

module.exports = {
    scheduleBackgroundStartupTasks,
};
