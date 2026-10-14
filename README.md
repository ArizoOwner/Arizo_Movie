# 🎬 Arizo_Movie — 24/7 Serverless Telegram Movie Bot

[![Deploy to Cloudflare Workers](https://github.com/ArizoOwner/Arizo_Movie/actions/workflows/deploy.yml/badge.svg)](https://github.com/ArizoOwner/Arizo_Movie/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![Telegram Bot API](https://img.shields.io/badge/Telegram-Bot%20API-2CA5E0?logo=telegram)](https://core.telegram.org/bots/api)
[![TMDB](https://img.shields.io/badge/API-TheMovieDB-01b4e4?logo=themoviedb)](https://www.themoviedb.org/)

[🇮🇷 برای مشاهده راهنمای فارسی کلیک کنید (Persian Documentation)](./README.fa.md)

**Arizo_Movie** is an intelligent, high-performance, 24/7 serverless Telegram bot designed for movie and series channel administrators. It automatically fetches rich international metadata from TheMovieDB (TMDB), generates Persian genre hashtags, renders interactive poster carousels with native styled buttons, connects directly to movie files via message forwards or links, and posts directly to your channel.

Built on **Cloudflare Workers** with a **D1 (SQLite)** database. There is no server for you to run or keep alive: Telegram calls your Worker through a webhook whenever someone messages the bot. Cloudflare's free plan has daily request limits; check [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) if your channel is busy.

---

## ✨ Features

- **⚡ Always-on, serverless**: runs on Cloudflare's edge network, so there is no machine of yours to restart. Availability depends on Cloudflare, Telegram and TMDB, none of which this project can guarantee.
- **🧙‍♂️ Built-in Web Setup Wizard (`/setup`)**: Guarded by a setup key you control; verifies your bot token and TMDB key, creates the tables and registers the webhook.
- **🎬 TMDB Integration**: Multi-search support for both English and Persian titles with accurate release dates, ratings, and media type detection (Movies & Series).
- **🎭 Persian Genre Hashtags**: Automatically translates international TMDB genres into official Persian hashtags (`#اکشن`, `#علمی_تخیلی`, etc.).
- **📺 Smart Series Seasons**: Intelligently handles multi-season TV shows with true broadcast years.
- **🖼 Interactive Poster Carousel**: Browse international high-resolution posters with styled inline buttons (`◀️ Prev`, `Next ▶️`, `💎 Confirm`).
- **🔗 1-Click File Linking**: Forward any media/message from your channel or paste its link (`t.me/c/...`) to instantly generate and post the formatted movie card to your destination channel.
- **🛡 D1 Persistent Database**: Safely retains user sessions, channel preferences, and post records across worker executions.
- **🔄 Webhook Self-Healing**: A cron trigger re-registers the Telegram webhook every 30 minutes if it went missing.
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

### 1. Get the code
```bash
git clone https://github.com/ArizoOwner/Arizo_Movie.git
cd Arizo_Movie
npm install
```

### 2. Deploy the Worker
```bash
npx wrangler login
npx wrangler deploy        # wrangler 4.x creates the D1 database automatically
```

### 3. Set your setup key (required)
The `/setup` wizard only works for someone who knows `SETUP_KEY`. Generate a long random value (at least 24 characters) and store it as a **secret** on the Worker:
```bash
npx wrangler secret put SETUP_KEY
```
Without it, the wizard refuses every request, so a freshly deployed Worker can never be taken over by a stranger who finds the URL.

### 4. Run the wizard
Open `https://arizo-movie.<your-subdomain>.workers.dev/setup`, then:
1. Enter your **setup key**.
2. Enter your **Telegram bot token** ([@BotFather](https://t.me/BotFather)) and your **TMDB API key** ([themoviedb.org](https://www.themoviedb.org/settings/api)). Each one is checked against the real service.
3. Press **Install**. The wizard creates the tables, saves the settings, registers the Telegram webhook and the bot commands.

### 5. Optional: deploy on every push
Add two repository secrets (**Settings ➜ Secrets and variables ➜ Actions**): `CLOUDFLARE_API_TOKEN` (Edit access for Workers and D1) and `CLOUDFLARE_ACCOUNT_ID`. Until both exist the workflow skips the deploy instead of failing.

---

## 🛡 What the wizard does and does not do
- It configures **this** Worker: tables, settings, webhook, commands.
- It does **not** create Cloudflare resources, fork the repository or set GitHub secrets for you. Deploy with wrangler or GitHub Actions as described above.
- The bot token and TMDB key are stored as plain text in your own D1 database (see [PRIVACY.md](PRIVACY.md)). Anyone with access to your Cloudflare account can read them.

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
