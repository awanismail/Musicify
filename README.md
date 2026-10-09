# ![Musicify Cover](/.github/assets/M_Banner.png)

[![Invite Musicify](https://img.shields.io/badge/-Invite%20Musicify-111110?logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTIgMTZjNC04IDQgMiAxMCAwczQtMTAgMTAtNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSIjRkFDQzE1IiBzdHJva2Utd2lkdGg9IjMiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg==&logoColor=white&style=flat-square&logoWidth=20)](https://discord.com/oauth2/authorize?client_id=1502977716196999309)
[![Support Server](https://img.shields.io/badge/-Support%20Server-%235865F2?logo=discord&logoColor=white&style=flat-square&logoWidth=20)](https://discord.gg/MRjEUhDCpZ)

## Musicify

Musicify is a ChatPlay-focused Discord music bot that also operates like a standard music bot. It is easy to self-host with Docker, or [click here to invite the bot](https://discord.com/oauth2/authorize?client_id=1502977716196999309) and start using it today with no hosting or setup required.

## Features & Commands

- ChatPlay-powered interactions for conversational bot control
- Standard music playback with multi-guild Lavalink support
- Supports queue management, shuffle, seek, volume, loop, and now playing
- Built-in commands for help, bot stats, and track information

## Docker Deployment (Recommended)

This repository includes Docker support for simple deployment.

1. Copy `.env.example` to `.env` and fill in your `BOT_TOKEN` and `CLIENT_ID`.
2. Start the bot:
   ```bash
   docker compose up --build -d
   ```
3. Stop the bot:
   ```bash
   docker compose down
   ```

If startup fails, use:
```bash
docker compose logs -f musicify
```

## Manual Installation Steps

### Prerequisites

- Node.js 22.5 or newer (required for built-in SQLite)
- A Lavalink server (required by `config.js`)
- Discord bot application with proper intents and `BOT_TOKEN`/`CLIENT_ID`

1. Clone the repository:
   ```bash
   git clone https://github.com/codebymitch/Musicify.git
   cd Musicify
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and fill in your `BOT_TOKEN` and `CLIENT_ID`.
4. Copy `config.example.js` to `config.js` and configure your Lavalink server details.
   - Update `host`, `port`, `password`, and `secure` in `config.js`.
   - Ensure your Lavalink server is running and reachable.
5. Start the bot:
   ```bash
   npm start
   ```

## Documentation

### Inspect and remove old Discord server commands

For a full command reset during redeploy, run `npm run commands:reset` once in
the new deployment environment with `BOT_TOKEN` and `CLIENT_ID` configured.
It replaces the global command list with the current source and removes **all
server-specific commands belonging to this bot in every server it has joined**.
It validates the application and verifies the resulting command lists. Settings
and playback data are unchanged. This is a separate deployment step; `npm start`
does not run it automatically. Do not run command registration from an old bot
version at the same time. A failed reset exits nonzero and can be retried.

Run these in the bot environment with `BOT_TOKEN` and `CLIENT_ID` configured.
Replace `SERVER_ID` and `COMMAND_ID` with the actual Discord IDs.

```bash
# Read global and server-specific registrations without changing anything
npm run commands:inspect -- --guild SERVER_ID

# Preview removal of a selected server-specific command
npm run commands:inspect -- --guild SERVER_ID --delete COMMAND_ID

# Apply that removal (multiple command IDs can be separated with commas)
npm run commands:inspect -- --guild SERVER_ID --delete COMMAND_ID --apply
```

The tool checks the token's application, only deletes selected server-specific
commands, and reads the server registrations again to verify removal. Matching
names alone do not prove a command is obsolete. Global commands are preserved;
use `npm run deploy` from the latest code to replace the global command list.
If a request fails midway, inspect again before retrying: earlier deletions may
have succeeded. This tool does not restart the bot or refresh the Discord client.

- [Trademarks](TRADEMARKS.md)
- [Terms of Service](TermsOfService.md)
- [Privacy Policy](PrivacyPolicy.md)

Open an issue or drop into the support server for help.

## License

Musicify is released under the Apache License. See [LICENSE](LICENSE) for details.

## Thank You

Thank you for choosing Musicify for your Discord server! We're constantly working to improve and add new features based on community feedback.

*Last updated: May 2026*
