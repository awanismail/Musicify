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
const { resolveTrackArtworkUrl } = require("./trackArtwork");

function formatDuration(ms) {
    if (!ms || isNaN(ms)) return "0:00";
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function truncateText(text, max, fallback) {
    const value = (text || fallback || "").trim() || fallback || "";
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(1, max - 1))}…`;
}

function formatQueueTrackLine(t, index, track, { titleMax = 34, authorMax = 18 } = {}) {
    const title = truncateText(track.info?.title, titleMax, t("common.unknown"));
    const author = truncateText(track.info?.author, authorMax, "?");
    const duration = formatDuration(track.info?.length);
    return t("player.queueTrackLine", { index, title, author, duration });
}

function formatUpNextPreview(t, queue, maxItems = 3) {
    if (!queue?.length) return null;

    const lines = [t("player.upNext")];
    const upcoming = queue.slice(0, maxItems);
    for (let i = 0; i < upcoming.length; i++) {
        lines.push(formatQueueTrackLine(t, i + 1, upcoming[i], { titleMax: 32, authorMax: 16 }));
    }
    if (queue.length > maxItems) {
        lines.push(t("player.moreInQueue", { count: queue.length - maxItems }));
    }
    return lines.join("\n");
}

function buildSongSuggestionSelectMenu(t, suggestions) {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId("song_suggestion")
        .setPlaceholder(t("components.suggestionsPlaceholder"))
        .setMinValues(1)
        .setMaxValues(1);

    const items = suggestions.slice(0, 10);
    for (let i = 0; i < items.length; i++) {
        const suggestion = items[i];
        selectMenu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(truncateText(suggestion.info?.title, 100, t("common.unknown")))
                .setDescription(
                    truncateText(suggestion.info?.author, 100, t("common.unknownArtist"))
                )
                .setValue(String(i))
        );
    }

    return selectMenu;
}

const LOOP_MODE_KEYS = { none: "off", track: "track", queue: "queue" };

function formatLoopMode(t, mode) {
    if (!mode || mode === "none") return t("common.none");
    const choiceKey = LOOP_MODE_KEYS[mode];
    if (choiceKey) return t(`slash.loop.choices.mode.${choiceKey}`);
    return t("common.unknown");
}

function formatPlayerStatus(t, guildData) {
    return (
        t("player.autoplay", { value: guildData.autoplay ? t("common.on") : t("common.off") }) +
        "\n" +
        t("player.loop", { value: formatLoopMode(t, guildData.loop) }) +
        "\n" +
        t("player.volume", { value: guildData.volume })
    );
}

function createNowPlayingContainer(t, track, player, guildData, musicardBuffer) {
    const container = new ContainerBuilder();
    const title = track.info.title || t("common.unknown");
    const author = track.info.author || t("common.unknownArtist");
    const requesterId = track.info.requester?.id || track.info.requester;

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t("player.nowPlayingHeader", { title })),
            new TextDisplayBuilder().setContent(t("player.byArtist", { author })),
            new TextDisplayBuilder().setContent(t("player.requestedBy", { userId: requesterId }))
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(resolveTrackArtworkUrl(track))
        );

    container.addSectionComponents(section);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatPlayerStatus(t, guildData))
    );

    const upNext = formatUpNextPreview(t, player.queue);
    if (upNext) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(upNext));
    }

    if (musicardBuffer) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL("attachment://musicard.png")
            )
        );
    }

    if (guildData.suggestions?.length > 0) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                buildSongSuggestionSelectMenu(t, guildData.suggestions)
            )
        );
    }

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

function buildChatPlayHeaderContent(t) {
    return t("components.chatplay.header");
}

function formatChatPlayIdleStatusLine(t, guildData = {}) {
    if (guildData.chatPlayEnabled === false) {
        return guildData.twentyFourSeven
            ? t("components.chatplay.statusNotWaiting247")
            : t("components.chatplay.statusNotWaiting");
    }
    return guildData.twentyFourSeven
        ? t("components.chatplay.statusWaiting247")
        : t("components.chatplay.statusWaiting");
}

function createChatPlayIdleContainer(t, guildData = {}) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildChatPlayHeaderContent(t))
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatChatPlayIdleStatusLine(t, guildData))
    );

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

function createChatPlayNowPlayingContainer(t, track, player, guildData, musicardBuffer) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildChatPlayHeaderContent(t))
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    const title = track.info.title || t("common.unknown");
    const author = track.info.author || t("common.unknownArtist");
    const requesterId = track.info.requester?.id || track.info.requester;

    const section = new SectionBuilder()
        .addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t("player.nowPlayingHeader", { title })),
            new TextDisplayBuilder().setContent(t("player.byArtist", { author })),
            new TextDisplayBuilder().setContent(t("player.requestedBy", { userId: requesterId }))
        )
        .setThumbnailAccessory(
            new ThumbnailBuilder().setURL(resolveTrackArtworkUrl(track))
        );

    container.addSectionComponents(section);
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(formatPlayerStatus(t, guildData))
    );

    const upNext = formatUpNextPreview(t, player.queue);
    if (upNext) {
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(upNext));
    }

    if (musicardBuffer) {
        container.addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
                new MediaGalleryItemBuilder().setURL("attachment://musicard.png")
            )
        );
    }

    if (guildData.suggestions?.length > 0) {
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
                buildSongSuggestionSelectMenu(t, guildData.suggestions)
            )
        );
    }

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

function createQueueContainer(t, queue, currentTrack, page = 0) {
    const container = new ContainerBuilder();
    const pageSize = 12;
    const totalTracks = queue?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalTracks / pageSize));

    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;

    const lines = [t("components.queueHeading", { count: totalTracks })];

    if (currentTrack) {
        const title = truncateText(currentTrack.info?.title, 40, t("common.unknown"));
        const author = truncateText(currentTrack.info?.author, 22, "?");
        lines.push(
            t("player.queueNowPlayingLine", {
                title,
                author,
                duration: formatDuration(currentTrack.info?.length),
            })
        );
        if (queue?.length) lines.push("");
    }

    if (queue?.length) {
        const start = page * pageSize;
        const end = Math.min(start + pageSize, queue.length);
        for (let i = start; i < end; i++) {
            lines.push(formatQueueTrackLine(t, i + 1, queue[i]));
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

function createChatPlayLoadingContainer(t) {
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(buildChatPlayHeaderContent(t))
    );
    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(t("components.chatplay.statusLoading"))
    );

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

function createStopConfirmContainer(t, queueLength) {
    const container = new ContainerBuilder();
    const bodyKey =
        queueLength === 1
            ? "components.stopConfirm.bodySingular"
            : "components.stopConfirm.bodyPlural";

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("components.stopConfirm.heading")}\n\n` +
                `${t(bodyKey, { count: queueLength })}\n\n` +
                t("components.stopConfirm.footer")
        )
    );

    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("stop_confirm")
                .setLabel(t("components.stopConfirm.button"))
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
