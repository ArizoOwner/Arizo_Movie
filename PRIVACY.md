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
- Tokens (`BOT_TOKEN`, `TMDB_KEY`) are stored encrypted within your Cloudflare Worker environment and D1 database.
- Webhook endpoints are protected using a dynamically generated `secret_token` header.
- Credentials are never transmitted to any third-party analytics or external repository.

### 3. Data Retention & Deletion
- User session states are automatically cleared upon workflow completion or when invoking `/cancel`.
- Channel administrators have complete access to inspect or wipe their Cloudflare D1 tables at any time using standard SQL commands.
