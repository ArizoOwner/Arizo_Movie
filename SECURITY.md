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
   - All credentials should either be configured via Cloudflare Secrets (`wrangler secret put <NAME>`), GitHub Actions Secrets, or dynamically through the Web Setup Wizard (`/setup`).

2. **Telegram Webhook Verification**:
   - The bot employs Telegram's `secret_token` mechanism (`X-Telegram-Bot-Api-Secret-Token`).
   - Secret validation is executed using **constant-time comparisons (`timingSafeEqual`)** to mitigate timing attack vectors.

3. **Input Sanitization & Output Encoding**:
   - All external movie titles, user messages, and API strings undergo strict HTML escaping (`escapeHtml`) prior to inclusion in Telegram message bodies or the web interface, preventing HTML injection and XSS.

4. **Security Headers**:
   - The Web Setup Wizard serves standard security headers: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy`.

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability within **Arizo_Movie**, please report it responsibly:

1. **Do not open a public GitHub Issue.**
2. Send a private advisory via GitHub or contact the maintainer directly.
3. Include detailed steps to reproduce the issue and potential remediation steps.
4. Maintainers will review and deploy patches within 24–48 hours.

Thank you for helping keep Arizo_Movie secure!
