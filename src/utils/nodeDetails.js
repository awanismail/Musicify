const { TextDisplayBuilder, SeparatorBuilder } = require("discord.js");

/**
 * Add detailed node info to a container (no host/password exposed)
 * Shared between node-stats command and button handler dropdown
 *
 * Uses the bold-label + subtext design pattern.
 */
function addNodeDetails(t, container, node, index) {
    const connected = node.connected || node.isConnected || false;
    const statusEmoji = connected ? "🟢" : "🔴";
    const statusText = connected ? t("status.connected") : t("status.disconnected");
    const nodeName = node.name || t("status.nodeN", { index: index + 1 });

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // Node identity + connection info
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `### ${statusEmoji} ${nodeName}\n\n` +
            `${t("common.labels.status")}\n` +
            `-# ${statusText}\n` +
            `${t("status.restVersion")}\n` +
            `-# ${node.restVersion || t("common.na")}`
        )
    );

    if (!connected || !node.stats) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(t("status.nodeOffline"))
        );
        return;
    }

    const stats = node.stats;

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // Players
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${t("status.playersHeading")}\n\n` +
            `${t("status.playersActive")}\n` +
            `-# 🎶 ${stats.playingPlayers || 0}\n` +
            `${t("status.playersTotal")}\n` +
            `-# 📻 ${stats.players || 0}`
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    // CPU
    let cpuContent = `${t("status.cpuHeading")}\n\n`;
    if (stats.cpu) {
        cpuContent +=
            `${t("status.cpuCores")}\n` +
            `-# 🖥️ ${stats.cpu.cores || t("common.na")}\n` +
            `${t("status.cpuSystemLoad")}\n` +
            `-# ⚙️ ${(stats.cpu.systemLoad * 100).toFixed(1)}%\n` +
            `${t("status.cpuLavalinkLoad")}\n` +
            `-# 🔧 ${(stats.cpu.lavalinkLoad * 100).toFixed(1)}%`;
    } else {
        cpuContent += t("status.noCpuData");
    }

    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(cpuContent));
}

module.exports = { addNodeDetails };
