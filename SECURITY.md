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

   - A Cloudflare token is accepted as proof only if it can read the account that owns the workers.dev subdomain in the request URL, so creating a same-named Worker in another account does not pass the check.

4. **Hosted Installer (public instance only)**:
   - Enabled only when the Worker is deployed with `PUBLIC_INSTALLER=true`; every other copy answers `installer_off`.
   - It uses the visitor's Cloudflare token for the install calls and does not store or log it, but the visitor cannot verify that the running code matches this repository. The README tells visitors to use a dedicated token and delete it afterwards.
   - It downloads only the fixed release URL of this repository, never a caller-supplied URL, and checks size and content before uploading.
   - The setup key it generates is returned once in the response and is stored only as a secret on the visitor's own Worker.

5. **In-bot Updates (opt-in)**:
   - Off unless the owner ticks the box in the wizard. Then the Cloudflare token is stored as a Worker **secret** (`CF_API_TOKEN`), never in D1, and it is never shown back.
   - That token can modify Workers and D1 databases of the accounts selected when it was created. The README and the wizard say so next to the checkbox and recommend a single-account token.
   - The update button and every `upd_*` action are owner-only, private-chat-only, and re-checked on every tap. A stranger cannot trigger a release lookup or an upload.
   - The owner claim link is random, valid for 2 hours, single-use, and only its SHA-256 is stored. Whoever opens it first becomes the owner, so the wizard says to open it immediately.
   - Nothing is installed without a tap on **Update**. The file is fetched only from the fixed GitHub release URL of the configured repository, size-limited, and refused if its embedded fingerprint (`BUILD_ID`) does not match its content. This detects truncation and accidental edits; it does **not** protect against a malicious release published from the repository itself, which is the trust you place in the maintainers.
   - The upload keeps every binding (`inherit`, strict) and the previous version stays available for rollback.

6. **Input Sanitization & Output Encoding**:
   - All external movie titles, user messages, and API strings undergo strict HTML escaping (`escapeHtml`) prior to inclusion in Telegram message bodies or the web interface, preventing HTML injection and XSS.

7. **Security Headers**:
   - The wizard is served with a strict Content-Security-Policy plus `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability within **Arizo_Movie**, please report it responsibly:

1. **Do not open a public GitHub Issue.**
2. Send a private advisory via GitHub or contact the maintainer directly.
3. Include detailed steps to reproduce the issue and potential remediation steps.
4. Maintainers will review and deploy patches within 24–48 hours.

Thank you for helping keep Arizo_Movie secure!
