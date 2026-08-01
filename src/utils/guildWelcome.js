const {
    MessageFlags,
    PermissionsBitField,
    ChannelType,
    TextDisplayBuilder,
    SectionBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");

const WELCOME_TTL_MS = 2 * 60 * 1000;
const welcomeDeleteTimers = new Map();

const TEXT_CHANNEL_TYPES = new Set([
    ChannelType.GuildText,
    ChannelType.GuildAnnouncement,
]);

function buildWelcomeBody(cmd) {
    return (
        `## 👋 Welcome to Musicify!\n\n` +
        `- Use ${cmd.chatplay} to enable **ChatPlay** — type song names in a channel to play instantly\n\n` +
        `**Quick start**\n` +
        `1. Join a voice channel\n` +
        `2. Use ${cmd.play} \`<song name or URL>\` — supports Spotify, SoundCloud, Deezer, Apple Music, Tidal, Qobuz & JioSaavn\n` +
        `3. Control playback with interactive buttons or slash commands\n\n` +
        `- If you need help or found a bug, join our [support server](https://discord.gg/MRjEUhDCpZ), run ${cmd.status} to see if the bot's systems are online, or check out the open source [GitHub repo](https://github.com/codebymitch/Musicify)!`
    );
}

function buildWelcomeComponents(deleteAtUnix, cmd) {
    return [
        new TextDisplayBuilder().setContent(buildWelcomeBody(cmd)),
        new SectionBuilder()
            .addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `-# This message will delete <t:${deleteAtUnix}:R>`
                )
            )
            .setButtonAccessory(
                new ButtonBuilder()
                    .setCustomId("welcome_dismiss")
                    .setLabel("Delete message now")
                    .setStyle(ButtonStyle.Secondary)
            ),
    ];
}

async function resolveCommandMentions(client, names) {
    const fallback = (name) => `\`/${name}\``;
    const mentions = Object.fromEntries(names.map((name) => [name, fallback(name)]));

    try {
        const commands = await client.application.commands.fetch();
        for (const name of names) {
            const command = commands.find((entry) => entry.name === name);
            if (command) {
                mentions[name] = `</${name}:${command.id}>`;
            }
        }
    } catch (err) {
        console.warn("[Musicify] Could not fetch command IDs for welcome message:", err.message);
    }

    return mentions;
}

async function resolveGuildContext(guild) {
    if (guild.partial) {
        await guild.fetch();
    }

    await guild.channels.fetch().catch((err) => {
        console.warn(`[Musicify] Could not fetch channels for ${guild.id}:`, err.message);
    });

    let me = guild.members.me;
    if (!me) {
        me = await guild.members.fetchMe().catch(() => null);
    }

    return me;
}

function findWelcomeChannel(guild, me) {
    if (!me) return null;

    const canSend = (channel) => {
        if (!channel || !TEXT_CHANNEL_TYPES.has(channel.type)) return false;
        const perms = channel.permissionsFor(me);
        return (
            perms?.has(PermissionsBitField.Flags.ViewChannel) &&
            perms?.has(PermissionsBitField.Flags.SendMessages)
        );
    };

    if (guild.systemChannelId) {
        const systemChannel = guild.channels.cache.get(guild.systemChannelId);
        if (canSend(systemChannel)) return systemChannel;
    }

    const sendable = guild.channels.cache
        .filter((channel) => canSend(channel))
        .sort((a, b) => a.rawPosition - b.rawPosition);

    const preferred = sendable.find((channel) =>
        /general|welcome|chat|lounge/i.test(channel.name)
    );
    if (preferred) return preferred;

    return sendable.first() ?? null;
}

function cancelWelcomeDeleteTimer(messageId) {
    const timer = welcomeDeleteTimers.get(messageId);
    if (timer) {
        clearTimeout(timer);
        welcomeDeleteTimers.delete(messageId);
    }
}

async function sendGuildWelcome(client, guild) {
    try {
        // Guild data (especially channels) is often incomplete the instant guildCreate fires
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const me = await resolveGuildContext(guild);
        const channel = findWelcomeChannel(guild, me);

        if (!channel) {
            console.warn(
                `[Musicify] No welcome channel in ${guild.name} (${guild.id}) — bot needs Send Messages in a text channel`
            );
            return;
        }

        const cmd = await resolveCommandMentions(client, ["play", "chatplay", "status"]);
        const deleteAt = Math.floor((Date.now() + WELCOME_TTL_MS) / 1000);
        const message = await channel.send({
            components: buildWelcomeComponents(deleteAt, cmd),
            flags: MessageFlags.IsComponentsV2,
        });

        const timer = setTimeout(() => {
            cancelWelcomeDeleteTimer(message.id);
            message.delete().catch(() => {});
        }, WELCOME_TTL_MS);

        welcomeDeleteTimers.set(message.id, timer);
    } catch (err) {
        console.error(`[Musicify] Failed to send guild welcome in ${guild.id}:`, err);
    }
}

async function dismissWelcomeMessage(interaction) {
    cancelWelcomeDeleteTimer(interaction.message.id);
    try {
        await interaction.deferUpdate();
    } catch {
        // Message may already be gone
    }
    await interaction.message.delete().catch(() => {});
}

module.exports = {
    sendGuildWelcome,
    dismissWelcomeMessage,
};
