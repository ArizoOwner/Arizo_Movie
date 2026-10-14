# 🛡️ Security Policy

## 🔒 Supported Versions

Only the latest release running on the `main` branch receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| 2.0.x   | :white_check_mark: |
| < 2.0.0 | :x:                |

---

## 🔑 Token & Secrets Protection Guidelines

1. **Zero Hardcoded Secrets**:
   - Never commit `BOT_TOKEN`, `TMDB_KEY`, `CLOUDFLARE_API_TOKEN`, or any personal access tokens to GitHub.
   - Bot and TMDB credentials are entered in the setup wizard and stored in your own D1 database; `SETUP_KEY` is a Worker secret (`wrangler secret put SETUP_KEY`); CI credentials belong in GitHub Actions Secrets.

2. **Telegram Webhook Verification**:
   - The bot employs Telegram's `secret_token` mechanism (`X-Telegram-Bot-Api-Secret-Token`).
   - The secret is compared with a constant-time check, and requests without it are rejected with 401.

3. **Setup Wizard Protection**:
   - The setup wizard API requires `SETUP_KEY` (checked via SHA-256 digests so neither length nor content leaks through timing), only accepts same-origin JSON requests, and refuses all requests while `SETUP_KEY` is unset or shorter than 24 characters.

4. **Input Sanitization & Output Encoding**:
   - All external movie titles, user messages, and API strings undergo strict HTML escaping (`escapeHtml`) prior to inclusion in Telegram message bodies or the web interface, preventing HTML injection and XSS.

5. **Security Headers**:
   - The wizard is served with a strict Content-Security-Policy plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability within **Arizo_Movie**, please report it responsibly:

1. **Do not open a public GitHub Issue.**
2. Send a private advisory via GitHub or contact the maintainer directly.
3. Include detailed steps to reproduce the issue and potential remediation steps.
4. Maintainers will review and deploy patches within 24–48 hours.

Thank you for helping keep Arizo_Movie secure!
