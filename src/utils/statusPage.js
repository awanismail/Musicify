const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
} = require("discord.js");
const config = require("../../config");
const { formatIncidents } = require("./incidents");
const { tEn } = require("../i18n");

function getNodeList(client) {
    const nodes = client.riffy?.nodeMap;
    if (!nodes) return [];

    if (Array.isArray(nodes)) return nodes;
    if (nodes instanceof Map) return [...nodes.values()];
    return Object.values(nodes || {});
}

function countConnectedNodes(nodeList) {
    let connected = 0;
    for (const configNode of config.nodes) {
        const node = nodeList.find((n) => n.name === configNode.name);
        if (node?.connected || node?.isConnected) connected++;
    }
    return connected;
}

function getSystemStatus(connectedNodes, totalNodes, t) {
    const lavalinkUp = connectedNodes > 0;
    const lavalinkFullyConnected = connectedNodes === totalNodes && totalNodes > 0;

    if (!lavalinkUp) {
        return { emoji: "🔴", text: t("status.lavalinkUnavailable") };
    }

    if (!lavalinkFullyConnected) {
        return { emoji: "🟡", text: t("status.someNodesOffline") };
    }

    return { emoji: "🟢", text: t("status.allOperational") };
}

function getComponentStatus(connected, t) {
    return connected
        ? { emoji: "🟢", label: t("status.connected") }
        : { emoji: "🔴", label: t("status.disconnected") };
}

function getNodeDisplayName(index, t) {
    return index === 0 ? t("status.mainNode") : t("status.nodeN", { index });
}

function buildStatusContainer(client, { interactive = true, showSupportButton = interactive, t } = {}) {
    const translate = t || ((key, params) => tEn(key, params));
    const nodeList = getNodeList(client);
    const totalNodes = config.nodes.length;
    const connectedNodes = countConnectedNodes(nodeList);
    const { emoji: statusEmoji, text: statusText } = getSystemStatus(
        connectedNodes,
        totalNodes,
        translate
    );

    const uptimeSeconds = process.uptime();
    const startTime = new Date(Date.now() - uptimeSeconds * 1000);
    const startTimestamp = Math.floor(startTime.getTime() / 1000);

    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${statusEmoji} ${statusText}`)
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${translate("status.recentIncidents")}\n` + formatIncidents(translate, 4)
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    const linkButtons = showSupportButton
        ? [
              new ButtonBuilder()
                  .setLabel(translate("status.buttons.supportServer"))
                  .setURL("https://discord.gg/MRjEUhDCpZ")
                  .setStyle(ButtonStyle.Link),
              new ButtonBuilder()
                  .setLabel(translate("common.vote"))
                  .setURL(config.vote.url)
                  .setStyle(ButtonStyle.Link),
          ]
        : [
              new ButtonBuilder()
                  .setLabel(translate("status.buttons.reportIssue"))
                  .setEmoji("🐛")
                  .setURL("https://github.com/codebymitch/Musicify/issues")
                  .setStyle(ButtonStyle.Link),
              new ButtonBuilder()
                  .setLabel(translate("common.vote"))
                  .setURL(config.vote.url)
                  .setStyle(ButtonStyle.Link),
              new ButtonBuilder()
                  .setLabel(translate("status.buttons.suggest"))
                  .setEmoji("💡")
                  .setURL("https://discord.com/channels/1503210009251545152/1503721044291092480")
                  .setStyle(ButtonStyle.Link),
          ];

    container.addActionRowComponents(new ActionRowBuilder().addComponents(...linkButtons));

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${translate("status.uptimeHeading")}\n` +
                `-# 🕒 <t:${startTimestamp}:f> (<t:${startTimestamp}:R>)\n` +
                translate("status.uptimeTimezoneNote")
        )
    );

    container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            `${translate("status.nodesHeading")}\n` +
                translate("status.nodesAvailable", { connected: connectedNodes, total: totalNodes })
        )
    );

    if (interactive) {
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId("node_stats_select")
            .setPlaceholder(translate("status.nodesPlaceholder"))
            .setMinValues(1)
            .setMaxValues(1);

        for (let i = 0; i < config.nodes.length; i++) {
            const configNode = config.nodes[i];
            const connectedNode = nodeList.find((n) => n.name === configNode.name);
            const connected = connectedNode?.connected || connectedNode?.isConnected || false;
            const nodeStatusEmoji = connected ? "🟢" : "🔴";
            const displayName = getNodeDisplayName(i, translate);
            const nodeStatus = getComponentStatus(connected, translate);
            selectMenu.addOptions(
                new StringSelectMenuOptionBuilder()
                    .setLabel(displayName)
                    .setDescription(`${nodeStatusEmoji} ${nodeStatus.label}`)
                    .setValue(`node_${i}`)
            );
        }

        container.addActionRowComponents(new ActionRowBuilder().addComponents(selectMenu));
    } else {
        const nodeLines = config.nodes.map((configNode, i) => {
            const connectedNode = nodeList.find((n) => n.name === configNode.name);
            const connected = connectedNode?.connected || connectedNode?.isConnected || false;
            const displayName = getNodeDisplayName(i, translate);
            const nodeStatus = getComponentStatus(connected, translate);
            return translate("status.nodeHealthLine", {
                emoji: nodeStatus.emoji,
                name: displayName,
                status: nodeStatus.label,
            });
        });

        container.addSeparatorComponents(new SeparatorBuilder().setDivider(true));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `${translate("status.nodeHealthHeading")}\n` + nodeLines.join("\n")
            )
        );

        const updatedAt = Math.floor(Date.now() / 1000);
        container.addSeparatorComponents(new SeparatorBuilder().setDivider(false));
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                translate("status.lastUpdated", { timestamp: updatedAt })
            )
        );
    }

    return container;
}

module.exports = {
    buildStatusContainer,
    countConnectedNodes,
    getSystemStatus,
    getNodeList,
    getComponentStatus,
    getNodeDisplayName,
};
