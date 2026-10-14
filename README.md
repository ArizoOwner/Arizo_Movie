# 🎬 Arizo_Movie — 24/7 Serverless Telegram Movie Bot

[![Deploy to Cloudflare Workers](https://github.com/ArizoOwner/Arizo_Movie/actions/workflows/deploy.yml/badge.svg)](https://github.com/ArizoOwner/Arizo_Movie/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram)](https://core.telegram.org/bots/api)
[![TMDB](https://img.shields.io/badge/API-TheMovieDB-01b4e4?logo=themoviedb)](https://www.themoviedb.org/)

[🇮🇷 برای مشاهده راهنمای فارسی کلیک کنید (Persian Documentation)](./README.fa.md)

**Arizo_Movie** is an intelligent, high-performance, 24/7 serverless Telegram bot designed for movie and series channel administrators. It automatically fetches rich international metadata from TheMovieDB (TMDB), generates Persian genre hashtags, renders interactive poster carousels with native styled buttons, connects directly to movie files via message forwards or links, and posts directly to your channel.

Built natively on **Cloudflare Workers** with **D1 SQLite Database**, running continuously around the clock with **zero server costs**, 0ms cold starts, and zero downtime.

---

## ✨ Features

- **⚡ 24/7 Serverless Architecture**: Runs on Cloudflare's global edge network across 300+ locations. Never goes offline or sleeps.
- **🧙‍♂️ Built-in Web Setup Wizard (`/setup`)**: Dark-mode glassmorphism interface for 1-click configuration, dynamic API credential verification, and webhook registration.
- **🎬 TMDB Integration**: Multi-search support for both English and Persian titles with accurate release dates, ratings, and media type detection (Movies & Series).
- **🎭 Persian Genre Hashtags**: Automatically translates international TMDB genres into official Persian hashtags (`#اکشن`, `#علمی_تخیلی`, etc.).
- **📺 Smart Series Seasons**: Intelligently handles multi-season TV shows with true broadcast years.
- **🖼 Interactive Poster Carousel**: Browse international high-resolution posters with styled inline buttons (`◀️ Prev`, `Next ▶️`, `💎 Confirm`).
- **🔗 1-Click File Linking**: Forward any media/message from your channel or paste its link (`t.me/c/...`) to instantly generate and post the formatted movie card to your destination channel.
- **🛡 D1 Persistent Database**: Safely retains user sessions, channel preferences, and post records across worker executions.
- **🔄 Self-Healing & Cron Check**: Automatic scheduled checks to ensure Telegram Webhooks remain healthy and connected 24/7.
- **🚀 Automated CI/CD**: Automatic deployment to Cloudflare Workers on every `git push` via GitHub Actions.

---

## 🏗 Architecture

```
[ Telegram User ] ─── HTTPS Webhook ───> [ Cloudflare Worker ]
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                           [ TheMovieDB API ]       [ Cloudflare D1 ]
                           (Metadata & Posters)    (Sessions & Channels)
                                    │                       │
                                    └───────────┬───────────┘
                                                ▼
                                    [ Target Telegram Channel ]
```

---

## 🚀 Quick Start Guide

### 1. Fork or Clone the Repository
```bash
git clone https://github.com/ArizoOwner/Arizo_Movie.git
cd Arizo_Movie
```

### 2. Configure GitHub Secrets (for Automatic Deployment)
Add the following secrets to your repository under **Settings ➜ Secrets and variables ➜ Actions**:
- `CLOUDFLARE_API_TOKEN`: Your Cloudflare API Token with Workers & D1 permissions.
- `CLOUDFLARE_ACCOUNT_ID`: Your Cloudflare Account ID found in the dashboard URL or Workers page.

Once configured, any push to the `main` branch will automatically build and deploy the Worker!

### 3. Initialize D1 Database (CLI)
```bash
npx wrangler d1 create arizo-movie-db
# Copy the database_id into wrangler.toml
npx wrangler d1 execute arizo-movie-db --file=./schema.sql
npx wrangler deploy
```

---

## 🧙‍♂️ Web Setup Wizard (`/setup`)

Once deployed, visit your Worker URL in your browser:
```
https://arizo-movie.<your-subdomain>.workers.dev/setup
```

1. **Telegram Bot Token**: Enter your token from [@BotFather](https://t.me/BotFather) and click **"🔍 Verify Token"**.
2. **TMDB API Key**: Enter your key from [TheMovieDB API](https://www.themoviedb.org/settings/api) and click **"🔍 Verify Key"**.
3. **Admin ID**: (Optional) Enter your Telegram numerical ID.
4. Click **"🚀 Launch & Register Webhook"**.

The wizard will test all credentials, create tables in D1, register the Telegram Webhook with secret token validation, set up bot commands, and give you a direct link to start using your bot immediately!

---

## 🤖 Bot Commands

| Command | Description |
|---|---|
| `/start` | Open the main menu, check channel status, and start searching |
| `/setchannel` | Connect or change your destination channel (`@public` or private link) |
| `/help` | Detailed guide on linking messages, selecting posters, and posting |
| `/cancel` | Cancel the current operation and reset the session |

---

## 🐳 Python Alternative (Optional Docker/Local Run)

If you prefer running the Python version with Polling:

```bash
# Set your environment variables
export BOT_TOKEN="your_telegram_bot_token"
export TMDB_KEY="your_tmdb_api_key"

# Install dependencies and run
pip install -r requirements.txt
python app3.py
```

Or using Docker:
```bash
docker build -t arizo-movie .
docker run -d --name arizo-movie -e BOT_TOKEN="xxx" -e TMDB_KEY="yyy" arizo-movie
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
