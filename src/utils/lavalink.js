const config = require("../../config");

function getConfigNodeName(configNode, index = 0) {
    return configNode.name || configNode.host || `node-${index}`;
}

function getNodeFromMap(client, configNode, index = 0) {
    const name = getConfigNodeName(configNode, index);
    return client.riffy?.nodeMap?.get(name) ?? null;
}

function isNodeConnected(node) {
    return Boolean(node?.connected || node?.isConnected);
}

function getNodeList(client) {
    const nodes = client.riffy?.nodeMap;
    if (!nodes) return [];

    if (Array.isArray(nodes)) return nodes;
    if (nodes instanceof Map) return [...nodes.values()];
    return Object.values(nodes || {});
}

function countConnectedNodes(client) {
    let connected = 0;
    for (let i = 0; i < config.nodes.length; i++) {
        const node = getNodeFromMap(client, config.nodes[i], i);
        if (isNodeConnected(node)) connected++;
    }
    return connected;
}

function isLavalinkAvailable(client) {
    return countConnectedNodes(client) > 0;
}

/** First connected node in config order (primary, then backups). */
function getPreferredNode(client) {
    if (!client.riffy?.initiated) return null;

    for (let i = 0; i < config.nodes.length; i++) {
        const node = getNodeFromMap(client, config.nodes[i], i);
        if (isNodeConnected(node)) return node;
    }

    return null;
}

function getPrimaryConfigNode() {
    return config.nodes[0] ?? null;
}

function getPrimaryNodeName() {
    const primary = getPrimaryConfigNode();
    return primary ? getConfigNodeName(primary, 0) : null;
}

function isPrimaryNode(node) {
    if (!node) return false;
    const primaryName = getPrimaryNodeName();
    return Boolean(primaryName && node.name === primaryName);
}

function createPreferredConnection(client, options) {
    if (!client.riffy?.initiated) {
        throw new Error("Riffy is not initialized");
    }

    const existing = client.riffy.players.get(options.guildId);
    if (existing) return existing;

    const node = getPreferredNode(client);
    if (!node) {
        throw new Error("No Lavalink nodes are available");
    }

    return client.riffy.createPlayer(node, options);
}

async function getStatusCommandRef(client) {
    try {
        const commands = await client.application.commands.fetch();
        const statusCmd = commands.find((c) => c.name === "status");
        return statusCmd ? `</status:${statusCmd.id}>` : "`/status`";
    } catch {
        return "`/status`";
    }
}

async function getLavalinkUnavailableError(client) {
    const statusRef = await getStatusCommandRef(client);
    return {
        key: "errors.lavalink.unavailable",
        params: { statusRef },
    };
}

module.exports = {
    getNodeList,
    getConfigNodeName,
    getPreferredNode,
    getPrimaryNodeName,
    isPrimaryNode,
    createPreferredConnection,
    countConnectedNodes,
    isLavalinkAvailable,
    getStatusCommandRef,
    getLavalinkUnavailableError,
};
