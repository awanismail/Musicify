const config = require("../../config");

function getNodeList(client) {
    const nodes = client.riffy?.nodeMap;
    if (!nodes) return [];

    if (Array.isArray(nodes)) return nodes;
    if (nodes instanceof Map) return [...nodes.values()];
    return Object.values(nodes || {});
}

function countConnectedNodes(client) {
    const nodeList = getNodeList(client);
    let connected = 0;
    for (const configNode of config.nodes) {
        const node = nodeList.find((n) => n.name === configNode.name);
        if (node?.connected || node?.isConnected) connected++;
    }
    return connected;
}

function isLavalinkAvailable(client) {
    return countConnectedNodes(client) > 0;
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
    countConnectedNodes,
    isLavalinkAvailable,
    getStatusCommandRef,
    getLavalinkUnavailableError,
};
