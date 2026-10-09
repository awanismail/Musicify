# Reset Discord commands

Run `npm run commands:reset` once during redeploy with BOT_TOKEN and CLIENT_ID configured. It replaces global commands with the current source and clears all server-specific commands for this bot. Normal startup is unchanged. Settings and data remain unchanged. Stop the old bot first to avoid competing registrations. Failures exit nonzero and may be retried.
