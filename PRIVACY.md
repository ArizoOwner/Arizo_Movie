# 🔒 Privacy Policy

### 1. Data Collection & Processing
**Arizo_Movie** is designed with privacy-first and decentralized principles:
- **No Telemetry or Tracking**: The software contains no external analytics, tracking scripts, or telemetry beacons.
- **Local Isolated Storage**: All configuration values, channel IDs, and conversational states are stored exclusively inside your own **Cloudflare D1 Database** instance.
- **Third-Party Data Exchange**: Communication occurs solely between:
  1. Your Cloudflare Worker and Telegram Bot API (`api.telegram.org`)
  2. Your Cloudflare Worker and TMDB API (`api.themoviedb.org`)
  3. Google Translate API for Persian title resolution fallback

### 2. Secrets & Credentials
- `BOT_TOKEN` and `TMDB_KEY` entered in the wizard are stored **as plain text** in the `settings` table of your own Cloudflare D1 database. They are not encrypted by this project; they are protected by your Cloudflare account's access controls. Treat anyone with access to that account or database as able to read them.
- `SETUP_KEY` is stored only as a Cloudflare Worker secret and is never written to D1.
- The Telegram webhook is protected by a randomly generated `secret_token` that is checked on every request.
- Credentials are never sent anywhere except Telegram and TMDB, to verify and use them.

### 3. Data Retention & Deletion
- User session states are automatically cleared upon workflow completion or when invoking `/cancel`.
- Channel administrators have complete access to inspect or wipe their Cloudflare D1 tables at any time using standard SQL commands.

### 4. Hosted installer (public instance only)
If you use a public installer instance, the Cloudflare token you paste is sent to that instance's Worker and used for the install calls. The code does not store or log it, but you cannot verify what the running copy does, so use a token created only for this and delete it afterwards. Your bot token and TMDB key are **never** sent to the installer; you enter them on your own Worker.
