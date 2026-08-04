const config = require("../../config");
const db = require("../db/sqlite");
const { t, tEn, SUPPORTED_LANGUAGES, resolveGuildLocale } = require("../i18n");

const MAX_INCIDENTS = 50;

const UNIMPORTANT_PATTERNS = [
    "unexpected server response",
    "timeout",
    "socket hang up",
    "ECONNRESET",
];

const SELECT_RECENT = db.prepare(`
    SELECT timestamp, component, description
    FROM incidents
    ORDER BY timestamp DESC
    LIMIT ?
`);

const SELECT_ALL = db.prepare(`
    SELECT timestamp, component, description
    FROM incidents
    ORDER BY timestamp DESC
`);

const SELECT_BY_COMPONENT = db.prepare(`
    SELECT timestamp, component, description
    FROM incidents
    WHERE component = ?
    ORDER BY timestamp DESC
`);

const SELECT_DUPLICATE = db.prepare(`
    SELECT 1
    FROM incidents
    WHERE component = ?
      AND description = ?
      AND timestamp > ?
    LIMIT 1
`);

const INSERT_INCIDENT = db.prepare(`
    INSERT INTO incidents (timestamp, component, description)
    VALUES (?, ?, ?)
`);

const DELETE_OLDEST = db.prepare(`
    DELETE FROM incidents
    WHERE id IN (
        SELECT id FROM incidents
        ORDER BY timestamp ASC
        LIMIT ?
    )
`);

function isImportantIncident(description) {
    const lowerDesc = description.toLowerCase();
    return !UNIMPORTANT_PATTERNS.some((pattern) => lowerDesc.includes(pattern.toLowerCase()));
}

function localeToDateString(locale, date) {
    const bcp47 = SUPPORTED_LANGUAGES[locale]?.discordLocale || locale;
    return date.toLocaleDateString(bcp47, {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

function anonymizeNodeNames(description) {
    let result = description;
    for (let i = 0; i < config.nodes.length; i++) {
        const nodeName = config.nodes[i].name;
        const displayName = i === 0 ? tEn("status.mainNode") : tEn("status.nodeN", { index: i });
        result = result.split(nodeName).join(displayName);
    }
    return result;
}

function trimIncidents() {
    const count = db.prepare("SELECT COUNT(*) AS count FROM incidents").get().count;
    if (count > MAX_INCIDENTS) {
        DELETE_OLDEST.run(count - MAX_INCIDENTS);
    }
}

function recordIncident(component, description) {
    if (!isImportantIncident(description)) {
        return false;
    }

    const anonymizedDesc = anonymizeNodeNames(description);
    const now = Date.now();
    const fiveMinutesAgo = now - 5 * 60 * 1000;

    if (SELECT_DUPLICATE.get(component, anonymizedDesc, fiveMinutesAgo)) {
        return false;
    }

    INSERT_INCIDENT.run(now, component, anonymizedDesc);
    trimIncidents();
    return true;
}

function getIncidents() {
    return SELECT_ALL.all();
}

function getIncidentsForComponent(component) {
    return SELECT_BY_COMPONENT.all(component);
}

function formatIncidents(t, limit = 4) {
    const incidents = SELECT_RECENT.all(limit);

    if (incidents.length === 0) {
        return t("status.noIncidents");
    }

    return incidents
        .map((i) =>
            t("status.incidentLine", {
                timestamp: Math.floor(i.timestamp / 1000),
                component: i.component,
                description: i.description,
            })
        )
        .join("\n");
}

function formatPastIncidents(locale, days = 7) {
    const incidents = SELECT_ALL.all();
    const lines = [];
    const now = new Date();

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
        const date = new Date(now);
        date.setHours(0, 0, 0, 0);
        date.setDate(date.getDate() - dayOffset);

        const nextDay = new Date(date);
        nextDay.setDate(nextDay.getDate() + 1);

        const dayStart = date.getTime();
        const dayEnd = nextDay.getTime();
        const dayIncidents = incidents.filter(
            (i) => i.timestamp >= dayStart && i.timestamp < dayEnd
        );

        const dateLabel = localeToDateString(locale, date);

        if (dayIncidents.length === 0) {
            lines.push(`**${dateLabel}**\n${t(locale, "status.noIncidents")}`);
        } else {
            const entries = dayIncidents
                .map((i) =>
                    t(locale, "status.incidentLine", {
                        timestamp: Math.floor(i.timestamp / 1000),
                        component: i.component,
                        description: i.description,
                    })
                )
                .join("\n");
            lines.push(`**${dateLabel}**\n${entries}`);
        }
    }

    return lines.join("\n\n");
}

function formatPastIncidentsForGuild(guildId, client, days = 7) {
    const locale = resolveGuildLocale(guildId, client);
    return formatPastIncidents(locale, days);
}

module.exports = {
    recordIncident,
    getIncidents,
    getIncidentsForComponent,
    formatIncidents,
    formatPastIncidents,
    formatPastIncidentsForGuild,
    localeToDateString,
};
