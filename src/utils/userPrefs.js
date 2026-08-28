const db = require("../db/sqlite");

const SELECT_USER = db.prepare(
    "SELECT vote_prompt_snoozed_until FROM users WHERE user_id = ?"
);
const UPSERT_SNOOZE = db.prepare(`
    INSERT INTO users (user_id, vote_prompt_snoozed_until)
    VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET vote_prompt_snoozed_until = excluded.vote_prompt_snoozed_until
`);

function isVotePromptSnoozed(userId) {
    if (!userId) return true;

    const row = SELECT_USER.get(userId);
    if (!row?.vote_prompt_snoozed_until) return false;

    return row.vote_prompt_snoozed_until > Date.now();
}

function snoozeVotePrompt(userId, durationMs) {
    if (!userId) return;

    UPSERT_SNOOZE.run(userId, Date.now() + durationMs);
}

module.exports = {
    isVotePromptSnoozed,
    snoozeVotePrompt,
};
