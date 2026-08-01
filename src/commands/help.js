const {
    SlashCommandBuilder,
    MessageFlags,
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require("discord.js");

const SUPPORTED_PLATFORMS =
    "Spotify, SoundCloud, Deezer, Apple Music, Tidal, Qobuz & JioSaavn";

const PAGES = {
    home: {
        label: "Home",
        emoji: "🏠",
        description: "Overview & quick start",
    },
    music: {
        label: "Music Commands",
        emoji: "🎶",
        description: "Play, skip, queue & more",
    },
    filters: {
        label: "Filters & Extras",
        emoji: "🎛️",
        description: "Audio filters, 24/7 & ChatPlay",
    },
    controls: {
        label: "Player Controls",
        emoji: "🎮",
        description: "Button layout guide",
    },
    troubleshoot: {
        label: "Troubleshooting",
        emoji: "🛠️",
        description: "Common issues & fixes",
    },
    support: {
        label: "Support",
        emoji: "🤝",
        description: "Get help & report bugs",
    },
};

/**
 * Build the dropdown select menu
 */
function buildDropdown(activePage = "home") {
    const menu = new StringSelectMenuBuilder()
        .setCustomId("help_select")
        .setPlaceholder("📖 Navigate help sections")
        .setMinValues(1)
        .setMaxValues(1);

    for (const [key, page] of Object.entries(PAGES)) {
        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(page.label)
                .setDescription(page.description)
                .setEmoji(page.emoji)
                .setValue(key)
                .setDefault(key === activePage)
        );
    }

    return new ActionRowBuilder().addComponents(menu);
}

/**
 * Build the full container for a given page
 */
async function buildHelpPage(client, page = "home") {
    const container = new ContainerBuilder();

    // --- Header with bot avatar ---
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("# <:Musicify_Logo:1517828581638541493> Musicify")
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(
                client.user.displayAvatarURL({ size: 128 })
            )
        );

    container.addSectionComponents(section);

    // --- Category Dropdown (at the top, like the Command Browser) ---
    container.addActionRowComponents(buildDropdown(page));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // Fetch command IDs for mention format
    let commands;
    try {
        commands = await client.application.commands.fetch();
    } catch (e) {
        commands = null;
    }
    
    const getCmd = (name, subcommand = null) => {
        const cmd = commands?.find(c => c.name === name);
        if (!cmd) return subcommand ? `\`/${name} ${subcommand}\`` : `\`/${name}\``;
        return subcommand ? `</${name} ${subcommand}:${cmd.id}>` : `</${name}:${cmd.id}>`;
    };

    // --- Page Content ---
    switch (page) {
        case "home":
            addHomePage(container, getCmd);
            break;
        case "music":
            addMusicPage(container, getCmd);
            break;
        case "filters":
            addFiltersPage(container, getCmd);
            break;
        case "controls":
            addControlsPage(container);
            break;
        case "troubleshoot":
            addTroubleshootPage(container, getCmd);
            break;
        case "support":
            addSupportPage(container, getCmd);
            break;
        default:
            addHomePage(container, getCmd);
    }

    return container;
}

// ─── PAGE BUILDERS ───────────────────────────────────────────

function addHomePage(container, getCmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### 👋 Welcome to Musicify!\n" +
            "-# Your simple, fast, and feature-rich music bot for Discord."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Quick Start**\n\n" +
            `**1.** Join a voice channel\n` +
            `-# Make sure you're connected before requesting a song.\n` +
            `**2.** Use ${getCmd("play")} \`<song name or URL>\`\n` +
            `-# Supports ${SUPPORTED_PLATFORMS}.\n` +
            `**3.** Control with buttons or commands!\n` +
            `-# Use the interactive player or slash commands.`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Features**\n" +
            "-# • **Song suggestions** dropdown — 10 similar tracks\n" +
            "-# • **10+ audio filter** presets\n" +
            "-# • **ChatPlay** — type song names to play instantly\n" +
            "-# • **Smart queue management** with pagination\n" +
            "-# • **24/7 mode** — never leave the VC"
        )
    );

    const openSourceSection = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent("-# Musicify is [open source](https://github.com/codebymitch/Musicify).")
        )
        .setButtonAccessory(
            new ButtonBuilder()
                .setLabel("⭐ Vote")
                .setURL("https://top.gg/bot/1502977716196999309/vote")
                .setStyle(ButtonStyle.Link)
        );

    container.addSectionComponents(openSourceSection);
}

function addMusicPage(container, getCmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### 🎶 Command Browser\n" +
            "-# 15 commands available"
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**1.** ${getCmd("play")} — Play a song or add it to the queue\n\n` +
            `**2.** ${getCmd("skip")} — Skip the current track\n\n` +
            `**3.** ${getCmd("stop")} — Stop playback and clear the queue\n\n` +
            `**4.** ${getCmd("nowplaying")} — Show the currently playing track\n\n` +
            `**5.** ${getCmd("seek")} — Seek to a position\n\n` +
            `**6.** ${getCmd("queue")} — View the current queue\n\n` +
            `**7.** ${getCmd("remove")} — Remove a track from the queue\n\n` +
            `**8.** ${getCmd("move")} — Move a track's position\n\n` +
            `**9.** ${getCmd("shuffle")} — Shuffle all tracks in the queue\n\n` +
            `**10.** ${getCmd("loop")} — Set loop mode for track or queue\n\n` +
            `**11.** ${getCmd("volume")} — Set the playback volume\n\n` +
            `**12.** ${getCmd("247")} — Toggle 24/7 mode (confirmation required)\n\n` +
            `**13.** ${getCmd("filter")} — Apply an audio filter preset\n\n` +
            `**14.** ${getCmd("chatplay")} — Set up or manage ChatPlay (enable, disable, delete)\n\n` +
            `**15.** ${getCmd("about")} — Learn more about Musicify`
        )
    );
}

function addFiltersPage(container, getCmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### 🎛️ Audio Filters\n` +
            `-# ${getCmd("filter")} \`<preset>\` — Apply an audio filter`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Available Presets**\n\n" +
            "**🔊 Bass Boost**\n-# Heavy low-end enhancement\n\n" +
            "**🌙 Nightcore**\n-# Sped up + higher pitch\n\n" +
            "**🌊 Vaporwave**\n-# Slowed down + lower pitch\n\n" +
            "**🎧 8D Audio**\n-# Rotating surround effect\n\n" +
            "**〰️ Tremolo**\n-# Volume oscillation\n\n" +
            "**🎸 Vibrato**\n-# Pitch oscillation\n\n" +
            "**🎤 Karaoke**\n-# Vocal reduction\n\n" +
            "**🔈 Low Pass**\n-# Muffled / underwater effect\n\n" +
            "**🐌 Slow Mode**\n-# Slowed playback rate\n\n" +
            "**💥 Distortion**\n-# Distorted audio effect\n\n" +
            "-# Use **❌ Reset All** to clear all active filters."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### 💬 ChatPlay\n\n` +
            `**Setup & manage**\n` +
            `-# ${getCmd("chatplay")} — Runs setup if ChatPlay isn't configured yet\n` +
            `-# If ChatPlay exists, opens a panel to **Enable**, **Disable**, or **Delete** it\n\n` +
            `-# Once set up, just **type a song name** in the channel and Musicify plays it automatically!`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### 🔁 24/7 Mode\n\n` +
            `**Toggle**\n` +
            `-# ${getCmd("247")} — Stay in VC when idle; confirm before toggling\n\n` +
            `-# ${getCmd("stop")} — Clears queue; disconnects unless 24/7 is on\n\n` +
            `**How it works**\n` +
            `-# Musicify stays in the voice channel even after the queue ends.\n` +
            `-# Setting persists across bot restarts.`
        )
    );
}

function addControlsPage(container) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### 🎮 Player Button Controls\n" +
            "-# When a track is playing, Musicify shows interactive buttons."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Row 1 — Playback**\n\n" +
            "**🔀 Shuffle**\n" +
            "-# Randomize the queue order\n\n" +
            "**⏮️ Previous**\n" +
            "-# Go back to the last played track\n\n" +
            "**⏸️ Pause / Play**\n" +
            "-# Toggle playback\n\n" +
            "**⏭️ Skip**\n" +
            "-# Skip to the next track\n\n" +
            "**🔁 Loop**\n" +
            "-# Cycle: Off → Track → Queue"
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Row 2 — Extras**\n\n" +
            "**📻 Autoplay**\n" +
            "-# Auto-queue similar songs when queue ends\n\n" +
            "**🔉 Vol↓  ·  🔊 Vol↑**\n" +
            "-# Adjust volume by ±10%\n\n" +
            "**⏹️ Stop**\n" +
            "-# Stop playback and disconnect\n\n" +
            "**📜 Queue**\n" +
            "-# Open the queue viewer"
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**🎵 Song Suggestions**\n" +
            "-# A dropdown with up to **10 similar tracks** appears below the buttons.\n" +
            "-# Select one to instantly add it to the queue!"
        )
    );
}

function addTroubleshootPage(container, getCmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### 🛠️ Troubleshooting\n" +
            "-# Common issues and how to fix them."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Bot won't play music / Track Error**\n" +
            "-# The song may be age-restricted or region-blocked.\n" +
            "-# The streaming source may be temporarily unavailable.\n" +
            `-# **Fix:** Try a different song or paste a direct URL from ${SUPPORTED_PLATFORMS}.\n\n` +

            "**Bot joins but immediately leaves**\n" +
            "-# Musicify may lack Speak/Connect permissions in that channel.\n" +
            "-# The requested song may have failed to load.\n" +
            "-# **Fix:** Check bot permissions and try another song."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**No sound but bot is in VC**\n` +
            `-# Check if the bot is paused — use the ▶️ button.\n` +
            `-# Check volume with ${getCmd("volume")}.\n` +
            `-# **Fix:** Make sure you're in the same VC and not deafened.\n\n` +

            `**ChatPlay not responding**\n` +
            `-# Ensure ChatPlay is enabled — run ${getCmd("chatplay")} and tap **Enable**.\n` +
            `-# Make sure you're typing in the correct channel.\n` +
            `-# **Fix:** Try disabling and re-enabling it.\n\n` +

            `**Buttons say "No active player"**\n` +
            `-# The player was closed after the track finished.\n` +
            `-# **Fix:** Play a new song with ${getCmd("play")} to start fresh!`
        )
    );
}

function addSupportPage(container, getCmd) {
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### 🤝 Support & Links\n" +
            "-# Get help, report bugs, or learn more."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**Need help or found a bug?**\n" +
            "-# Our team is ready to help you with any issues."
        )
    );

    const supportButton = new ButtonBuilder()
        .setLabel("Join Support Server")
        .setURL("https://discord.gg/MRjEUhDCpZ")
        .setStyle(ButtonStyle.Link);

    container.addActionRowComponents(new ActionRowBuilder().addComponents(supportButton));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "**How to Report a Bug**\n\n" +
            "**1.** Note what command you were using\n" +
            "-# Include the exact command and any error shown.\n\n" +
            "**2.** Join our Support Server\n" +
            "-# Use the **Join Support Server** button above.\n\n" +
            "**3.** Open a ticket\n" +
            "-# Or ask in the support channel.\n\n" +
            "**4.** Attach evidence\n" +
            "-# Screenshots or recordings help us fix faster!"
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `**Bot Info Commands**\n` +
            `**1.** ${getCmd("stats")}\n` +
            `-# See ping, uptime, and memory\n` +
            `**2.** ${getCmd("status")}\n` +
            `-# See Lavalink connection status\n` +
            `**3.** ${getCmd("help")}\n` +
            `-# You're here!`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "-# Musicify is [open source](https://github.com/codebymitch/Musicify)."
        )
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show all Musicify commands and features"),

    async execute(interaction, client) {
        const container = await buildHelpPage(client, "home");

        await interaction.reply({
            components: [container],
            flags: MessageFlags.IsComponentsV2,
        });
    },

    // Exports for use in buttonHandler
    buildHelpPage,
};
