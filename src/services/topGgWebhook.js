const http = require("http");
const crypto = require("crypto");
const config = require("../../config");
const { handleVoteReceived } = require("./voteThankYou");

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

function parseSignatureHeader(header) {
    if (!header) return null;

    const parts = {};
    for (const segment of header.split(",")) {
        const [key, value] = segment.split("=");
        if (key && value) parts[key.trim()] = value.trim();
    }

    if (!parts.t || !parts.v1) return null;
    return { timestamp: parts.t, signature: parts.v1 };
}

function verifyV1Signature(rawBody, signatureHeader, secret) {
    const parsed = parseSignatureHeader(signatureHeader);
    if (!parsed || !secret) return false;

    const payload = `${parsed.timestamp}.${rawBody}`;
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    try {
        return crypto.timingSafeEqual(
            Buffer.from(parsed.signature, "hex"),
            Buffer.from(expected, "hex")
        );
    } catch {
        return false;
    }
}

function verifyLegacyAuth(authHeader, secret) {
    if (!authHeader || !secret) return false;
    return authHeader === secret;
}

function normalizeUserId(value) {
    if (value == null) return null;

    if (typeof value === "string" || typeof value === "number") {
        const id = String(value).trim();
        return /^\d{5,}$/.test(id) ? id : null;
    }

    if (typeof value === "object") {
        const candidates = [
            value.platform_id,
            value.platformId,
            value.discord_id,
            value.discordId,
            value.id,
            value.userId,
            value.user_id,
        ];

        for (const candidate of candidates) {
            const normalized = normalizeUserId(candidate);
            if (normalized) return normalized;
        }
    }

    return null;
}

function normalizeVoteQuery(query) {
    if (query == null || query === "") return null;

    if (typeof query === "string") {
        const trimmed = query.trim();
        if (!trimmed) return null;
        return trimmed.startsWith("?") ? trimmed : `?${trimmed.replace(/^\?/, "")}`;
    }

    if (typeof query === "object") {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(query)) {
            if (value != null && value !== "") {
                params.set(key, String(value));
            }
        }
        const serialized = params.toString();
        return serialized ? `?${serialized}` : null;
    }

    return null;
}

function extractVotePayload(body) {
    if (!body) return null;

    const payload = body.data && typeof body.data === "object" ? body.data : body;

    const userId = normalizeUserId(
        payload.user ??
            payload.userId ??
            payload.user_id ??
            body.user ??
            body.userId ??
            body.user_id
    );

    if (!userId) return null;

    const type = body.type ?? body.event ?? payload.type ?? body.data?.type;
    if (type && type !== "upvote" && type !== "vote.create" && type !== "test" && type !== "webhook.test") {
        return null;
    }

    const query = normalizeVoteQuery(
        payload.query ??
            body.query ??
            body.data?.query ??
            body.metadata?.query ??
            body.data?.metadata?.query
    );

    return {
        userId,
        query,
        isTest: type === "test" || type === "webhook.test",
    };
}

function isAuthorized(req, rawBody) {
    const secret = config.vote.webhookSecret;
    if (!secret) return false;

    const signatureHeader = req.headers["x-topgg-signature"];
    if (signatureHeader && verifyV1Signature(rawBody.toString("utf8"), signatureHeader, secret)) {
        return true;
    }

    const authHeader = req.headers.authorization;
    if (verifyLegacyAuth(authHeader, secret)) {
        return true;
    }

    return false;
}

function startTopGgWebhookServer(client) {
    const secret = config.vote.webhookSecret;
    const webhookPath = config.vote.webhookPath;
    const port = Number(process.env.PORT || process.env.TOP_GG_WEBHOOK_PORT || 0);

    if (!secret) {
        console.log("[Musicify] TOP_GG_WEBHOOK_SECRET not set — vote webhook server disabled.");
        return null;
    }

    if (!port) {
        console.warn(
            "[Musicify] No PORT or TOP_GG_WEBHOOK_PORT — vote webhook server disabled."
        );
        return null;
    }

    const server = http.createServer(async (req, res) => {
        if (req.method !== "POST" || req.url?.split("?")[0] !== webhookPath) {
            res.writeHead(404);
            res.end();
            return;
        }

        try {
            const rawBody = await readRawBody(req);

            if (!isAuthorized(req, rawBody)) {
                console.warn("[Musicify] Rejected top.gg webhook — invalid signature/auth.");
                res.writeHead(401);
                res.end("Unauthorized");
                return;
            }

            const body = JSON.parse(rawBody.toString("utf8"));
            const vote = extractVotePayload(body);

            if (!vote) {
                res.writeHead(400);
                res.end("Bad Request");
                return;
            }

            res.writeHead(200);
            res.end("OK");

            if (!vote.isTest) {
                void handleVoteReceived(client, vote).catch((err) => {
                    console.error("[Musicify] Vote thank-you handler failed:", err.message);
                });
            } else {
                console.log("[Musicify] top.gg webhook test received.");
            }
        } catch (err) {
            console.error("[Musicify] top.gg webhook error:", err.message);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end("Error");
            }
        }
    });

    server.listen(port, () => {
        console.log(
            `[Musicify] top.gg vote webhook listening on port ${port} at ${webhookPath}`
        );
    });

    return server;
}

module.exports = {
    startTopGgWebhookServer,
};
