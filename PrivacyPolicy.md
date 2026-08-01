# Privacy Policy

**Last Updated:** August 1, 2026

This Privacy Policy explains how **Musicify** ("we," "us," or "our") collects, uses, and stores information when you use the **Musicify** Discord bot (the "Service").

By inviting or using Musicify, you agree to the practices described in this Privacy Policy.

## Information We Collect

Musicify stores only the data needed to operate. Persistent data is kept in a local **SQLite** database on the bot host.

### Server settings (`guilds` table)

For each Discord server Musicify is in, we may store:

- **Server (guild) ID**
- **Channel IDs** — ChatPlay channel and player message IDs
- **ChatPlay settings** — enabled state, slowmode, message deletion, pin player message
- **Playback preferences** — default volume, autoplay, 24/7 mode
- **Bound voice channel ID** — when a server pins playback to a specific voice channel

### Operational logs (`incidents` table)

To monitor bot health and troubleshoot issues, we store a limited log of operational errors:

- **Timestamp**
- **Component** (e.g. Lavalink, player handler)
- **Description** (error summary)

These logs are capped at **50 entries** and are not tied to individual users. They do not include usernames, message content, or song requests.

### Application settings (`app_settings` table)

Internal bot configuration keys (for example, a status webhook message ID) required for the Service to run.

### Data used in memory only (not written to disk)

- **Message content** — read only in channels where ChatPlay is enabled, to detect song requests. Content is processed in memory and is **not logged or stored**.
- **Discord user IDs** — used temporarily for rate limiting and active ChatPlay setup sessions. User IDs are **not persisted** in the database.
- **Queue and playback state** — current track, queue, and player controls exist in memory while the bot is running and are cleared when playback stops or the bot restarts.

## How We Use Your Information

We use the collected information to:

- Provide, operate, and maintain the Service
- Execute commands and manage audio playback
- Persist server-specific preferences across bot restarts
- Run ChatPlay in configured channels
- Diagnose outages and technical issues

## What We Do Not Collect

- Persistent storage of message contents or song search queries
- Playback or queue history
- Full member lists or presence/activity data
- Voice audio, private messages, or file attachments
- IP addresses or Discord account credentials
- Analytics or command-usage telemetry

Usernames, display names, and other profile details fetched from Discord's API may appear in memory during normal operation (for example, showing who requested a track) but are not written to the database.

## Data Storage and Retention

- **Primary storage:** a local SQLite file at `data/musicify.db` on the machine hosting the bot.
- **Backups:** periodic local database snapshots may be saved to `data/backups/`. By default, backups run about once every **7 days**, and up to **4** snapshots are retained. Backups can be disabled or adjusted via environment variables on self-hosted instances.
- **No cloud storage:** the public Musicify instance does not sync server data to third-party cloud databases. All persistent data remains on the bot host unless you self-host and configure storage differently.

Removing Musicify from your server stops new data collection for that server. Existing server settings may remain in the database until manually deleted. See **Your Choices** below.

## Sharing Your Information

We do not sell, trade, or rent your information to third parties.

We may disclose information only:

- With your consent
- To comply with legal obligations, protect our rights, or prevent illegal activity

## Third-Party Services

Musicify relies on third-party services to function, including:

- **Discord** — platform and API ([Discord Privacy Policy](https://discord.com/privacy))
- **Lavalink** — audio streaming and source resolution
- **Audio platforms** — such as Spotify, SoundCloud, Deezer, Apple Music, Tidal, Qobuz, and JioSaavn when you request content from those sources

Your use of those platforms through Musicify may be subject to their own terms and privacy policies.

## Your Choices

- **Stop collection:** remove Musicify from your Discord server at any time.
- **Delete server data:** contact us via our [Support Discord](https://discord.gg/MRjEUhDCpZ) to request deletion of your server's stored settings.
- **Self-hosting:** if you run your own instance, you control the database file and backups on your infrastructure.

## Open Source

Musicify is open source. You can review what data is collected and how it is handled in our [GitHub repository](https://github.com/codebymitch/Musicify), including the database schema in `src/db/migrations.js`.

## Contact Us

If you have questions about this Privacy Policy, reach out via our [Support Discord](https://discord.gg/MRjEUhDCpZ) or open an issue on our [GitHub repository](https://github.com/codebymitch/Musicify).
