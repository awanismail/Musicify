const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    MediaGalleryBuilder,
    MediaGalleryItemBuilder,
    SectionBuilder,
    ThumbnailBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
} = require("discord.js");
const { ButtonStyle } = require("discord.js");

/**
 * Format milliseconds to mm:ss
 */
function formatDuration(ms) {
    if (!ms || isNaN(ms)) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function truncateText(text, max, fallback = "Unknown") {
    const value = (text || fallback).trim();
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(1, max - 1))}…`;
}

/** Single-line queue entry — compact for mobile */
function formatQueueTrackLine(index, track, { titleMax = 34, authorMax = 18 } = {}) {
    const title = truncateText(track.info?.title, titleMax);
    const author = truncateText(track.info?.author, authorMax, "?");
    const duration = formatDuration(track.info?.length);
    return `-# **${index}.** ${title} — ${author} · \`${duration}\``;
}

function formatUpNextPreview(queue, maxItems = 3) {
    if (!queue?.length) {
        return null;
    }

    const lines = ["-# **Up next**"];
    const upcoming = queue.slice(0, maxItems);
    for (let i = 0; i < upcoming.length; i++) {
        lines.push(formatQueueTrackLine(i + 1, upcoming[i], { titleMax: 32, authorMax: 16 }));
    }
    if (queue.length > maxItems) {
        lines.push(`-# ***+${queue.length - maxItems} in queue***`);
    }
    return lines.join("\n");
}

/** Discord select option values are capped at 100 chars — use index, not URI */
function buildSongSuggestionSelectMenu(suggestions) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("song_suggestion")
        .setPlaceholder("🎶 Pick a similar song")
        .setMinValues(1)
        .setMaxValues(1);

    const items = suggestions.slice(0, 10);
    for (let i = 0; i < items.length; i++) {
        const suggestion = items[i];
        selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(suggestion.info?.title, 100))
                .setDescription(truncateText(suggestion.info?.author, 100, "Unknown Artist"))
                .setValue(String(i))
        );
    }

    return selectMenu;
}

/**
 * Create the "Now Playing" container using Components V2
 * Design matches the example screenshot with -# subtext
 */
function createNowPlayingContainer(track, player, guildData, musicardBuffer) {
    const container = new ContainerBuilder();

    // --- Now Playing header + track info with thumbnail ---
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**Now Playing — ${track.info.title || "Unknown"}**\n` +
                `-# By ${track.info.author || "Unknown Artist"}`
            ),
            new TextDisplayBuilder().setContent(
                `-# Requested by <@${track.info.requester?.id || track.info.requester}>`
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(
                track.info.artworkUrl || track.info.thumbnail || "https://i.imgur.com/4YFmJMi.png"
            )
        );

    container.addSectionComponents(section);

    // --- Separator ---
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // --- Status: Autoplay / Loop / Volume ---
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `Autoplay: ${guildData.autoplay ? "On" : "Off"}\n` +
            `Loop: ${capitalize(guildData.loop)}\n` +
            `Volume: ${guildData.volume}%`
        )
    );

    // --- Separator + up next (only when queue has tracks) ---
    const upNext = formatUpNextPreview(player.queue);
    if (upNext) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(upNext)
        );
    }

    // --- Musicard image ---
    if (musicardBuffer) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL("attachment://musicard.png")
            )
        );
    }

    // --- Song suggestions dropdown ---
    if (guildData.suggestions && guildData.suggestions.length > 0) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                buildSongSuggestionSelectMenu(guildData.suggestions)
            )
        );
    }

    // --- Row 1: Shuffle | Previous | Pause/Play | Next | Loop ---
    const isPaused = player.paused;
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("shuffle")
            .setEmoji("🔀")
            .setStyle(guildData.shuffle ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("previous")
            .setEmoji("⏮️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("pause_resume")
            .setEmoji(isPaused ? "▶️" : "⏸️")
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("skip")
            .setEmoji("⏭️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("loop")
            .setEmoji("🔁")
            .setStyle(guildData.loop !== "none" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

    // --- Row 2: Autoplay | Vol Down | Stop | Vol Up | Queue ---
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("autoplay")
            .setEmoji("📻")
            .setStyle(guildData.autoplay ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("vol_down")
            .setEmoji("🔉")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("stop")
            .setEmoji("⏹️")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("vol_up")
            .setEmoji("🔊")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("queue")
            .setEmoji("📜")
            .setStyle(ButtonStyle.Secondary)
    );

    container.addActionRowComponents(row1, row2);
    return container;
}



/**
 * Create a ChatPlay idle container (no image, disabled buttons)
 */
function buildChatPlayHeaderContent() {
    return (
        "## <:Musicify_Logo:1517828581638541493> Musicify ChatPlay\n" +
        "-# *Type a song name in this channel to play it!*\n" +
        "-# I'll search, play it in your voice channel, and keep this message updated."
    );
}

function formatChatPlayIdleStatusLine(guildData = {}) {
    if (guildData.chatPlayEnabled === false) {
        if (guildData.twentyFourSeven) {
            return "-# **Status:** Not waiting 24 hours, 7 days a week for a song request...";
        }
        return "-# **Status:** Not waiting for a song request...";
    }
    if (guildData.twentyFourSeven) {
        return "-# **Status:** Waiting 24 hours, 7 days a week for a song request...";
    }
    return "-# **Status:** Waiting for a song request...";
}

function createChatPlayIdleContainer(guildData = {}) {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildChatPlayHeaderContent())
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatChatPlayIdleStatusLine(guildData))
    );

    // Disabled control buttons
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("previous").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("pause_resume").setEmoji("⏸️").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("loop").setEmoji("🔁").setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("autoplay").setEmoji("📻").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("vol_down").setEmoji("🔉").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId("vol_up").setEmoji("🔊").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("queue").setEmoji("📜").setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    container.addActionRowComponents(row1, row2);

    return container;
}

function formatChatPlayStatusLine(guildData) {
    return (
        `Autoplay: ${guildData.autoplay ? "On" : "Off"}\n` +
        `Loop: ${capitalize(guildData.loop)}\n` +
        `Volume: ${guildData.volume}%`
    );
}

/**
 * Create a ChatPlay now-playing container (includes ChatPlay header + now playing info)
 */
function createChatPlayNowPlayingContainer(track, player, guildData, musicardBuffer) {
    const container = new ContainerBuilder();

    // --- ChatPlay Header (always visible) ---
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildChatPlayHeaderContent())
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // --- Now Playing header + track info with thumbnail ---
    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `**Now Playing — ${track.info.title || "Unknown"}**\n` +
                `-# By ${track.info.author || "Unknown Artist"}`
            ),
            new TextDisplayBuilder().setContent(
                `-# Requested by <@${track.info.requester?.id || track.info.requester}>`
            )
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(
                track.info.artworkUrl || track.info.thumbnail || "https://i.imgur.com/4YFmJMi.png"
            )
        );

    container.addSectionComponents(section);

    // --- Separator ---
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // --- Status: Autoplay / Loop / Volume ---
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatChatPlayStatusLine(guildData))
    );

    // --- Separator + up next (only when queue has tracks) ---
    const upNext = formatUpNextPreview(player.queue);
    if (upNext) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(upNext)
        );
    }

    // --- Musicard image ---
    if (musicardBuffer) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL("attachment://musicard.png")
            )
        );
    }

    // --- Song suggestions dropdown ---
    if (guildData.suggestions && guildData.suggestions.length > 0) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                buildSongSuggestionSelectMenu(guildData.suggestions)
            )
        );
    }

    // --- Row 1: Shuffle | Previous | Pause/Play | Next | Loop ---
    const isPaused = player.paused;
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("shuffle")
            .setEmoji("🔀")
            .setStyle(guildData.shuffle ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("previous")
            .setEmoji("⏮️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("pause_resume")
            .setEmoji(isPaused ? "▶️" : "⏸️")
            .setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("skip")
            .setEmoji("⏭️")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("loop")
            .setEmoji("🔁")
            .setStyle(guildData.loop !== "none" ? ButtonStyle.Primary : ButtonStyle.Secondary)
    );

    // --- Row 2: Autoplay | Vol Down | Stop | Vol Up | Queue ---
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("autoplay")
            .setEmoji("📻")
            .setStyle(guildData.autoplay ? ButtonStyle.Primary : ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("vol_down")
            .setEmoji("🔉")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("stop")
            .setEmoji("⏹️")
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId("vol_up")
            .setEmoji("🔊")
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId("queue")
            .setEmoji("📜")
            .setStyle(ButtonStyle.Secondary)
    );

    container.addActionRowComponents(row1, row2);

    return container;
}

/**
 * Create queue display container with pagination
 */
function createQueueContainer(queue, currentTrack, page = 0) {
    const container = new ContainerBuilder();
    const pageSize = 12;
    const totalTracks = queue?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));

    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const lines = [];
    lines.push(`### Queue · ${totalTracks}`);

    if (currentTrack) {
        const title = truncateText(currentTrack.info?.title, 40);
        const author = truncateText(currentTrack.info?.author, 22, "?");
        lines.push(
            `-# **Now Playing:** **${title}** — ${author} · \`${formatDuration(currentTrack.info?.length)}\``
        );
        if (queue?.length) {
            lines.push("");
        }
    }

    if (queue?.length) {
        const start = page * pageSize;
        const end = Math.min(start + pageSize, queue.length);
        for (let i = start; i < end; i++) {
            lines.push(formatQueueTrackLine(i + 1, queue[i]));
        }
    }

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(lines.join("\n"))
    );

    if (totalPages > 1) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("queue_first")
                    .setEmoji("⏮")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId("queue_prev")
                    .setEmoji("◀️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page === 0),
                new ButtonBuilder()
                    .setCustomId("queue_page_info")
                    .setLabel(`${page + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId("queue_next")
                    .setEmoji("▶️")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1),
                new ButtonBuilder()
                    .setCustomId("queue_last")
                    .setEmoji("⏭")
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(page >= totalPages - 1)
            )
        );
    }

    return container;
}

function capitalize(str) {
    if (!str) return "None";
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Create a ChatPlay container with loading state
 */
function createChatPlayLoadingContainer() {
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "## <:Musicify_Logo:1517828581638541493> Musicify ChatPlay\n" +
            "-# *Type a song name in this channel to play it!*\n" +
            "-# I'll search, play it in your voice channel, and keep this message updated."
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "-# **Status:** Searching for your song..."
        )
    );

    // Disabled control buttons
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("shuffle").setEmoji("🔀").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("previous").setEmoji("⏮️").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("pause_resume").setEmoji("⏸️").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("skip").setEmoji("⏭️").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("loop").setEmoji("🔁").setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("autoplay").setEmoji("📻").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("vol_down").setEmoji("🔉").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("stop").setEmoji("⏹️").setStyle(ButtonStyle.Danger).setDisabled(true),
        new ButtonBuilder().setCustomId("vol_up").setEmoji("🔊").setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId("queue").setEmoji("📜").setStyle(ButtonStyle.Secondary).setDisabled(true)
    );

    container.addActionRowComponents(row1, row2);
    return container;
}

function createStopConfirmContainer(queueLength) {
    const container = new ContainerBuilder();
    const songLabel = queueLength === 1 ? "song" : "songs";

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            "### ⚠️ Stop playback?\n\n" +
            `There are **${queueLength}** ${songLabel} in the queue.\n\n` +
            "-# Press **stop** again or confirm below within 15 seconds."
        )
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("stop_confirm")
                .setLabel("STOP")
                .setStyle(ButtonStyle.Danger)
        )
    );

    return container;
}

module.exports = {
    createNowPlayingContainer,
    createChatPlayIdleContainer,
    createChatPlayNowPlayingContainer,
    createChatPlayLoadingContainer,
    createQueueContainer,
    createStopConfirmContainer,
    formatDuration,
};
