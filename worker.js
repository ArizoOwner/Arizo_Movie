/**
 * ══════════════════════════════════════════════════════════════════════════════
 *   🎬 Arizo_Movie - Serverless Telegram Movie Bot on Cloudflare Workers
 *   24/7 Edge-Native, Webhook-Powered with D1 Database & Web Setup Wizard
 * ══════════════════════════════════════════════════════════════════════════════
 */

import WIZARD_HTML from "./wizard.html";

// Stamped by scripts/build.mjs. Running straight from source keeps the placeholders,
// which the updater treats as "unknown build, always offer the release".
const APP_VERSION = "__SOURCE__";
const BUILD_ID = "__SOURCE_BUILD__";


// ─── دیکشنری ترجمه ژانرها به فارسی برای هشتگ‌گذاری ───────────────────────────
const GENRE_MAP = {
  action: "اکشن",
  adventure: "ماجراجویی",
  animation: "انیمیشن",
  comedy: "کمدی",
  crime: "جنایی",
  documentary: "مستند",
  drama: "درام",
  family: "خانوادگی",
  fantasy: "فانتزی",
  history: "تاریخی",
  horror: "ترسناک",
  music: "موزیکال",
  mystery: "معمایی",
  romance: "عاشقانه",
  "science fiction": "علمی_تخیلی",
  "sci-fi & fantasy": "علمی_تخیلی_و_فانتزی",
  "tv movie": "فیلم_تلویزیونی",
  thriller: "هیجان_انگیز",
  war: "جنگی",
  "war & politics": "جنگی_و_سیاسی",
  western: "وسترن",
  "action & adventure": "اکشن_و_ماجراجویی",
  reality: "رئالیتی_شو",
  news: "اخبار",
  talk: "گفتگو",
  soap: "سریال_درام",
};

// ─── ابزارهای کمکی و امنیتی ──────────────────────────────────────────────────
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function timingSafeEqual(a, b) {
  const strA = String(a ?? "");
  const strB = String(b ?? "");
  if (strA.length === 0 || strB.length === 0) return false;
  if (strA.length !== strB.length) return false;
  let diff = 0;
  for (let i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

function generateRandomToken(len = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ─── پایگاه داده D1 و ذخیره‌سازی تنظیمات پویا ─────────────────────────────────
async function ensureSchema(env) {
  if (!env.DB) return false;
  try {
    await env.DB.batch([
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)"
      ),
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS user_sessions (chat_id INTEGER PRIMARY KEY, state TEXT, data TEXT, updated_at INTEGER)"
      ),
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS user_channels (chat_id INTEGER PRIMARY KEY, channel_id TEXT NOT NULL, channel_title TEXT, updated_at INTEGER)"
      ),
      env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS post_history (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id INTEGER, channel_id TEXT, post_id TEXT, tmdb_id TEXT, media_type TEXT, title_en TEXT, title_fa TEXT, created_at INTEGER)"
      ),
    ]);
    return true;
  } catch (e) {
    console.error("ensureSchema failed:", e);
    return false;
  }
}

async function getSetting(env, key, defaultValue = "") {
  if (env && env[key]) {
    return String(env[key]);
  }
  if (!env.DB) return defaultValue;
  try {
    const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?")
      .bind(key)
      .first();
    return row ? row.value : defaultValue;
  } catch (e) {
    return defaultValue;
  }
}

async function setSetting(env, key, value) {
  if (!env.DB) return false;
  try {
    await env.DB.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
      .bind(key, String(value))
      .run();
    return true;
  } catch (e) {
    console.error(`setSetting(${key}) failed:`, e);
    return false;
  }
}

async function getUserSession(env, chatId) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT state, data FROM user_sessions WHERE chat_id = ?"
    )
      .bind(chatId)
      .first();
    if (!row) return null;
    return {
      state: row.state,
      data: row.data ? JSON.parse(row.data) : {},
    };
  } catch (e) {
    console.error("getUserSession failed:", e);
    return null;
  }
}

async function setUserSession(env, chatId, state, data) {
  if (!env.DB) return false;
  try {
    await env.DB.prepare(
      "INSERT INTO user_sessions (chat_id, state, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET state = excluded.state, data = excluded.data, updated_at = excluded.updated_at"
    )
      .bind(chatId, state, JSON.stringify(data || {}), Date.now())
      .run();
    return true;
  } catch (e) {
    console.error("setUserSession failed:", e);
    return false;
  }
}

async function clearUserSession(env, chatId) {
  if (!env.DB) return;
  try {
    await env.DB.prepare("DELETE FROM user_sessions WHERE chat_id = ?")
      .bind(chatId)
      .run();
  } catch (e) {
    console.error("clearUserSession failed:", e);
  }
}

async function getUserChannel(env, chatId) {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      "SELECT channel_id, channel_title FROM user_channels WHERE chat_id = ?"
    )
      .bind(chatId)
      .first();
    return row ? row.channel_id : null;
  } catch (e) {
    return null;
  }
}

async function setUserChannel(env, chatId, channelId, channelTitle = "") {
  if (!env.DB) return false;
  try {
    await env.DB.prepare(
      "INSERT INTO user_channels (chat_id, channel_id, channel_title, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chat_id) DO UPDATE SET channel_id = excluded.channel_id, channel_title = excluded.channel_title, updated_at = excluded.updated_at"
    )
      .bind(chatId, String(channelId), channelTitle, Date.now())
      .run();
    return true;
  } catch (e) {
    console.error("setUserChannel failed:", e);
    return false;
  }
}

// ─── تلگرام API Client ────────────────────────────────────────────────────────
async function tgCall(env, method, body) {
  const token = await getSetting(env, "BOT_TOKEN");
  if (!token) {
    return { ok: false, description: "BOT_TOKEN is not configured" };
  }
  const url = `https://api.telegram.org/bot${token}/${method}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error(`tgCall(${method}) error:`, e);
    return { ok: false, description: String(e.message || e) };
  }
}

async function sendMessage(env, chatId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tgCall(env, "sendMessage", body);
}

async function editMessageText(env, chatId, messageId, text, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await tgCall(env, "editMessageText", body);
  if (!res.ok && res.description && res.description.includes("message is not modified")) {
    return { ok: true, not_modified: true };
  }
  return res;
}

async function editMessageMedia(env, chatId, messageId, mediaUrl, caption, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    media: {
      type: "photo",
      media: mediaUrl,
      caption: caption,
      parse_mode: "HTML",
    },
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await tgCall(env, "editMessageMedia", body);
  if (!res.ok && res.description && res.description.includes("message is not modified")) {
    return { ok: true, not_modified: true };
  }
  return res;
}

async function sendPhoto(env, chatId, photoUrl, caption, replyMarkup = null) {
  const body = {
    chat_id: chatId,
    photo: photoUrl,
    caption: caption,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return tgCall(env, "sendPhoto", body);
}

async function answerCallbackQuery(env, callbackQueryId, text = null, showAlert = false) {
  if (!callbackQueryId) return;
  const body = { callback_query_id: callbackQueryId, show_alert: !!showAlert };
  if (text) body.text = text;
  return tgCall(env, "answerCallbackQuery", body);
}

async function deleteMessage(env, chatId, messageId) {
  return tgCall(env, "deleteMessage", { chat_id: chatId, message_id: messageId });
}

// ─── ابزارهای استخراج کانال و لینک ──────────────────────────────────────────
function extractChannelIdOrUsername(text) {
  if (!text) return null;
  const t = text.trim();
  if (t.startsWith("@")) return t;

  const linkPattern = /(?:https?:\/\/)?(?:www\.)?t\.me\/(c\/\d+|[\w_]+)/i;
  const match = t.match(linkPattern);
  if (match) {
    const info = match[1];
    if (info.startsWith("c/")) {
      return parseInt(`-100${info.slice(2)}`, 10);
    }
    return `@${info}`;
  }

  if (t.startsWith("-100") && /^-100\d+$/.test(t)) {
    return parseInt(t, 10);
  }
  if (/^\d+$/.test(t)) {
    return parseInt(`-100${t}`, 10);
  }
  return null;
}

function getForwardInfo(message) {
  try {
    const origin = message.forward_origin;
    if (origin) {
      const postId = origin.message_id ? String(origin.message_id) : null;
      if (origin.chat) {
        if (origin.chat.username) {
          return { postId, channel: origin.chat.username };
        }
        const chatId = String(origin.chat.id);
        const channel = chatId.startsWith("-100") ? `c/${chatId.slice(4)}` : chatId;
        return { postId, channel };
      }
    }
    if (message.forward_from_chat) {
      const postId = message.forward_from_message_id ? String(message.forward_from_message_id) : null;
      if (message.forward_from_chat.username) {
        return { postId, channel: message.forward_from_chat.username };
      }
      const chatId = String(message.forward_from_chat.id);
      const channel = chatId.startsWith("-100") ? `c/${chatId.slice(4)}` : chatId;
      return { postId, channel };
    }
  } catch (e) {
    console.error("getForwardInfo error:", e);
  }
  return { postId: null, channel: null };
}

function extractInfoFromLink(text) {
  if (!text) return { postId: null, channel: null };
  const pattern = /(?:https?:\/\/)?(?:www\.)?t\.me\/(c\/\d+|[\w_]+)\/(\d+)/i;
  const match = text.trim().match(pattern);
  if (match) {
    return { channel: match[1], postId: match[2] };
  }
  return { postId: null, channel: null };
}

// ─── ترجمه و هشتگ‌های فارسی ──────────────────────────────────────────────────
async function translateToPersian(text) {
  if (!text) return text;
  try {
    const url = "https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=fa&dt=t&q=" + encodeURIComponent(text);
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && Array.isArray(data[0])) {
        return data[0].map((seg) => (seg && seg[0] ? seg[0] : "")).join("").trim();
      }
    }
  } catch (e) {
    console.error("translateToPersian failed:", e);
  }
  return text;
}

function getPersianGenres(genresList) {
  if (!Array.isArray(genresList)) return "";
  const persianGenres = [];
  for (const g of genresList) {
    const name = (g.name || "").trim();
    if (!name) continue;

    if (/[؀-ۿ]/.test(name)) {
      const clean = name.replace(/\s+/g, "_").replace(/-/g, "_");
      persianGenres.push(`#${clean}`);
    } else {
      const engLower = name.toLowerCase();
      const faName = GENRE_MAP[engLower] || name;
      const clean = faName.replace(/\s+/g, "_").replace(/-/g, "_").replace(/&/g, "و");
      persianGenres.push(`#${clean}`);
    }
  }
  return persianGenres.join(" ");
}

// ─── TMDB API Client ──────────────────────────────────────────────────────────
async function searchTmdb(env, query) {
  const tmdbKey = await getSetting(env, "TMDB_KEY");
  if (!tmdbKey) return [];
  const url = `https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${encodeURIComponent(query)}&language=fa-IR&include_adult=false`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || [];
    return results.filter((x) => x.media_type === "movie" || x.media_type === "tv").slice(0, 5);
  } catch (e) {
    console.error("searchTmdb error:", e);
    return [];
  }
}

async function getTmdbDetails(env, tmdbId, mediaType) {
  const tmdbKey = await getSetting(env, "TMDB_KEY");
  const urlFa = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbKey}&language=fa-IR&append_to_response=translations,external_ids`;
  const urlEn = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${tmdbKey}&language=en-US&append_to_response=external_ids`;

  let faJson = {};
  let enJson = {};
  try {
    const [resFa, resEn] = await Promise.all([fetch(urlFa), fetch(urlEn)]);
    if (resFa.ok) faJson = await resFa.json();
    if (resEn.ok) enJson = await resEn.json();
  } catch (e) {
    console.error("getTmdbDetails fetch error:", e);
  }

  let faTitle = null;
  if (faJson.translations && Array.isArray(faJson.translations.translations)) {
    for (const t of faJson.translations.translations) {
      if (t.iso_639_1 === "fa" && t.data) {
        faTitle = t.data.title || t.data.name || null;
        if (faTitle) break;
      }
    }
  }

  return { fa: faJson, en: enJson, fa_explicit_title: faTitle };
}

async function getTmdbPosters(env, tmdbId, mediaType) {
  const tmdbKey = await getSetting(env, "TMDB_KEY");
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}/images?api_key=${tmdbKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const posters = data.posters || [];
    posters.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
    // از کیفیت w780 استفاده می‌کنیم تا تلگرام با خطای محدودیت حجم ۱۰ مگابایت مواجه نشود
    return posters.slice(0, 10).map((p) => `https://image.tmdb.org/t/p/w780${p.file_path}`);
  } catch (e) {
    console.error("getTmdbPosters error:", e);
    return [];
  }
}

function getIntelligentSeasons(year, enData, faData) {
  const startYear = /^\d{4}$/.test(String(year)) ? parseInt(year, 10) : 2026;
  const defaultSeason = `<b>${startYear}</b> Season 1`;

  const seasonsList = enData.seasons || faData.seasons;
  if (Array.isArray(seasonsList) && seasonsList.length > 0) {
    const valid = seasonsList.filter((s) => s.season_number > 0);
    if (valid.length > 0) {
      return valid
        .map((s) => {
          const sYear = s.air_date ? s.air_date.slice(0, 4) : startYear + (s.season_number - 1);
          return `<b>${sYear}</b> Season ${s.season_number}`;
        })
        .join("\n");
    }
  }

  const numSeasons = parseInt(enData.number_of_seasons || faData.number_of_seasons || 1, 10);
  if (numSeasons > 1) {
    const lines = [defaultSeason];
    for (let i = 2; i <= numSeasons; i++) {
      lines.push(`<b>${startYear + (i - 1)}</b> Season ${i}`);
    }
    return lines.join("\n");
  }
  return defaultSeason;
}

function buildCaption(titleEn, titleFa, year, mediaType, rating, genresStr, seasonsInfo, channel, postId) {
  const hashtag = mediaType === "tv" ? "#سریال" : "#فیلم";
  const link = `t.me/${channel}/${postId}`;

  let caption = `${hashtag}\n\n| <b>${escapeHtml(titleEn)}</b> |\n| <b>${escapeHtml(titleFa)}</b> |\n\n`;

  if (rating && rating !== "0") {
    caption += `⭐️ <b>امتیاز:</b> ${escapeHtml(rating)}/10\n`;
  }
  if (genresStr) {
    caption += `🎭 <b>ژانر:</b> ${genresStr}\n`;
  }

  if (mediaType === "tv") {
    caption += `\n${seasonsInfo}\n\n`;
  } else {
    caption += `\n<b>${escapeHtml(year)}</b>\n\n`;
  }

  caption += `<b>Link=</b> ${escapeHtml(link)}`;
  return caption;
}

// ─── طراحی رابط کاربری (UI) و پیام‌های ربات ──────────────────────────────────
function getStartUI(channel, isOwnerUser = false) {
  const channelBadge = channel ? `🟢 <code>${escapeHtml(channel)}</code>` : "🔴 <i>تنظیم نشده (نیاز به اتصال)</i>";

  const text =
    "╔══════════════════════════╗\n" +
    "  🎬 <b>MOVIEBOT STUDIO | نسل جدید</b>\n" +
    "╚══════════════════════════╝\n\n" +
    `📡 <b>کانال مقصد:</b> ${channelBadge}\n` +
    "─────────────────────────\n" +
    "✨ <b>دستیار هوشمند ۲۴ ساعته انتشار پست‌های سینمایی</b>\n\n" +
    "⚡ <b>قابلیت‌های نسل جدید:</b>\n" +
    "▫️ اتصال مستقیم به دیتابیس TMDB و دریافت خودکار مشخصات\n" +
    "▫️ نگارش دقیق عنوان فارسی و انگلیسی به همراه سال تولید\n" +
    "▫️ هشتگ‌گذاری هوشمند فارسی ژانرها بر اساس استاندارد سینمایی\n" +
    "▫️ گالری پوسترهای باکیفیت بین‌المللی با قابلیت ورق زدن\n" +
    "▫️ اتصال خودکار به فایل کانال با فوروارد یا ارسال لینک پست\n" +
    "▫️ بدون قطعی و سرورلس (اجرا روی لبه کلادفلر ۲۴/۷)\n\n" +
    "👇 <b>هم‌اکنون نام فیلم یا سریال را ارسال کنید:</b>\n" +
    "📥 <i>مثال: Inception یا Breaking Bad یا متری شیش و نیم</i>";

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: channel ? "⚙️ تغییر کانال مقصد" : "📡 تنظیم کانال خروجی",
          callback_data: "set_channel",
          style: "primary",
        },
        { text: "📖 راهنمای کاربری", callback_data: "help", style: "danger" },
      ],
      ...(isOwnerUser
        ? [
            [{ text: "🔄 بررسی بروزرسانی", callback_data: "upd_check", style: "success" }],
            [{ text: "🛑 توقف و حذف ربات", callback_data: "stop_ask", style: "danger" }],
          ]
        : []),
    ],
  };

  return { text, keyboard };
}

function getHelpUI() {
  const text =
    "<blockquote>╭─────────────────────────╮\n" +
    "  📖 <b>راهنمای گام‌به‌گام MovieBot</b>\n" +
    "╰─────────────────────────╯\n\n" +
    "<b>۱. تنظیم کانال مقصد:</b>\n" +
    "برای اینکه ربات بتواند پست‌ها را مستقیماً منتشر کند، باید در کانال شما <b>ادمین با دسترسی ارسال پیام</b> باشد. سپس آیدی عمومی (@Channel) یا لینک پست کانال خصوصی را ارسال کنید.\n\n" +
    "<b>۲. جستجوی عنوان:</b>\n" +
    "نام فارسی یا انگلیسی اثر را بفرستید. در صورت وجود چند عنوان، لیست گزینه‌ها همراه با سال ساخت نمایش داده می‌شود.\n\n" +
    "<b>۳. انتخاب پوستر:</b>\n" +
    "از دکمه‌های ◀️ و ▶️ برای انتخاب از بین پوسترهای اصلی استفاده کرده و تایید را بزنید.\n\n" +
    "<b>۴. اتصال به فایل فیلم:</b>\n" +
    "پیام حاوی فایل فیلم را از کانال به ربات <b>Forward</b> کنید یا <b>لینک پیام کانال</b> را بفرستید تا فوراً پست با پوستر و لینک مستقیم در کانال شما منتشر شود.</blockquote>\n\n" +
    "⚙️ <b>دستورات سریع:</b>\n" +
    "▫️ /start - منوی اصلی\n" +
    "▫️ /setchannel - تنظیم یا تغییر کانال مقصد\n" +
    "▫️ /cancel - انصراف از عملیات جاری";

  const keyboard = {
    inline_keyboard: [
      [{ text: "🔙 بازگشت به منوی اصلی", callback_data: "back_to_start", style: "primary" }],
    ],
  };

  return { text, keyboard };
}

// ─── پردازش آپدیت‌های تلگرام (Bot Handlers) ──────────────────────────────────
async function handleUpdate(env, update) {
  if (update.callback_query) {
    return handleCallbackQuery(env, update.callback_query);
  }
  if (update.message) {
    return handleMessage(env, update.message);
  }
}

async function handleMessage(env, message) {
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  // دریافت کانال ذخیره‌شده کاربر
  const currentChannel = await getUserChannel(env, chatId);
  const session = (await getUserSession(env, chatId)) || { state: "IDLE", data: {} };

  // دستورات عمومی
  if (text.startsWith("/start own_")) {
    return handleOwnerClaim(env, message, text.slice("/start own_".length).trim());
  }

  if (text === "/start") {
    await clearUserSession(env, chatId);
    const owner = await isOwner(env, message.from && message.from.id, message.chat.type);
    const { text: startText, keyboard } = getStartUI(currentChannel, owner);
    return sendMessage(env, chatId, startText, keyboard);
  }

  if (text === "/update") {
    if (!(await isOwner(env, message.from && message.from.id, message.chat.type))) return;
    return showUpdateCheck(env, chatId, null);
  }

  if (text === "/uninstall") {
    if (!(await isOwner(env, message.from && message.from.id, message.chat.type))) return;
    return showStopAsk(env, chatId, null);
  }

  if (text === "/help") {
    const { text: helpText, keyboard } = getHelpUI();
    return sendMessage(env, chatId, helpText, keyboard);
  }

  if (text === "/setchannel") {
    await setUserSession(env, chatId, "WAITING_CHANNEL", {});
    const promptText =
      "╭─────────────────────────╮\n" +
      "  ⚙️ <b>تنظیم کانال خروجی | کانال مقصد</b>\n" +
      "╰─────────────────────────╯\n\n" +
      "برای انتشار خودکار پست‌ها در کانال، یکی از ۲ روش زیر را انجام دهید:\n\n" +
      "📌 <b>روش اول (کانال عمومی):</b>\n" +
      "آیدی عمومی کانال را با <code>@</code> بفرستید:\n" +
      "مثال: <code>@MyMovieChannel</code>\n\n" +
      "📌 <b>روش دوم (کانال خصوصی):</b>\n" +
      "لینک یکی از پست‌های کانال خود را ارسال کنید:\n" +
      "مثال: <code>https://t.me/c/1234567890/123</code>\n\n" +
      "⚠️ <i>الزام مهم: ربات حتماً باید در کانال شما عضو و ادمین با دسترسی ارسال پیام (Post Messages) باشد.</i>";

    const keyboard = {
      inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel", style: "danger" }]],
    };
    return sendMessage(env, chatId, promptText, keyboard);
  }

  if (text === "/cancel") {
    await clearUserSession(env, chatId);
    const cancelText = "❌ <b>عملیات جاری لغو شد.</b>\n\nنام فیلم یا سریال مورد نظر را ارسال فرمایید:";
    const keyboard = {
      inline_keyboard: [
        [
          { text: "🎬 جستجوی اثر جدید", callback_data: "search_again", style: "primary" },
          { text: "⚙️ تغییر کانال مقصد", callback_data: "set_channel", style: "danger" },
        ],
      ],
    };
    return sendMessage(env, chatId, cancelText, keyboard);
  }

  // وضعیت: منتظر ورود آیدی/لینک کانال
  if (session.state === "WAITING_CHANNEL") {
    const parsedChannel = extractChannelIdOrUsername(text);
    if (!parsedChannel) {
      const errText =
        "❌ <b>فرمت ورودی نامعتبر است!</b>\n\n" +
        "لطفاً آیدی کانال را به صورت <code>@channel_name</code> یا لینک کامل پست کانال خصوصی بفرستید:";
      const kb = {
        inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel", style: "danger" }]],
      };
      return sendMessage(env, chatId, errText, kb);
    }

    // اعتبارسنجی ادمین بودن کاربر و ربات در کانال
    try {
      const memberRes = await tgCall(env, "getChatMember", {
        chat_id: parsedChannel,
        user_id: message.from.id,
      });

      if (!memberRes.ok || !["creator", "administrator"].includes(memberRes.result?.status)) {
        return sendMessage(
          env,
          chatId,
          "⛔️ <b>خطای دسترسی کانال!</b>\n\n" +
            "شما باید مالک (Creator) یا مدیر (Admin) این کانال باشید تا امکان تنظیم آن وجود داشته باشد."
        );
      }
    } catch (e) {
      console.error("Channel verification failed:", e);
      return sendMessage(
        env,
        chatId,
        "⚠️ <b>خطا در بررسی کانال!</b>\n\n" +
          "۱. مطمئن شوید ربات در کانال شما <b>عضو و ادمین با دسترسی ارسال پیام</b> است.\n" +
          "۲. آیدی یا لینک ارسال شده صحیح باشد."
      );
    }

    // ذخیره در دیتابیس
    await setUserChannel(env, chatId, parsedChannel);
    await clearUserSession(env, chatId);

    const successText =
      "✅ <b>کانال مقصد با موفقیت تایید و ذخیره شد!</b>\n" +
      "─────────────────────────\n" +
      `📢 <b>کانال فعال:</b> <code>${escapeHtml(parsedChannel)}</code>\n\n` +
      "🎯 هم‌اکنون <b>نام فیلم یا سریال</b> مورد نظر خود را برای جستجو ارسال کنید:";

    const kb = {
      inline_keyboard: [
        [{ text: "⚙️ تغییر مجدد کانال", callback_data: "set_channel", style: "danger" }],
      ],
    };
    return sendMessage(env, chatId, successText, kb);
  }

  // وضعیت: منتظر فوروارد پیام یا ارسال لینک
  if (session.state === "WAITING_FORWARD") {
    let { postId, channel } = getForwardInfo(message);
    if (!postId) {
      const extracted = extractInfoFromLink(text || message.caption || "");
      postId = extracted.postId;
      channel = extracted.channel;
    }

    if (!postId || !channel) {
      const kb = {
        inline_keyboard: [
          [
            { text: "🖼 تغییر پوستر", callback_data: "back_to_poster", style: "primary" },
            { text: "❌ انصراف", callback_data: "cancel", style: "danger" },
          ],
        ],
      };
      return sendMessage(
        env,
        chatId,
        "⚠️ <b>اطلاعات فایل شناسایی نشد!</b>\n\n" +
          "لطفاً پیام فایل را از کانال خود <b>فوروارد (Forward)</b> کنید یا <b>لینک کامل پیام</b> را بفرستید:",
        kb
      );
    }

    const pending = session.data.pending;
    if (!pending) {
      await clearUserSession(env, chatId);
      return sendMessage(env, chatId, "⚠️ سشن منقضی شده است. لطفاً نام فیلم را مجدداً جستجو کنید.");
    }

    const targetChannel = currentChannel || (await getUserChannel(env, chatId));
    if (!targetChannel) {
      await setUserSession(env, chatId, "WAITING_CHANNEL", {});
      return sendMessage(
        env,
        chatId,
        "⚠️ <b>کانال مقصد تنظیم نشده است!</b>\nلطفاً ابتدا آیدی کانال مقصد را بفرستید:"
      );
    }

    const caption = buildCaption(
      pending.title_en,
      pending.title_fa,
      pending.year,
      pending.media_type,
      pending.rating,
      pending.genres_str,
      pending.seasons_info,
      channel,
      postId
    );

    const posters = pending.posters || [];
    const posterIndex = pending.poster_index || 0;
    const posterUrl = posters[posterIndex] || null;

    let directPostUrl = null;
    if (String(channel).startsWith("c/")) {
      directPostUrl = `https://t.me/${channel}/${postId}`;
    } else if (!String(channel).startsWith("-100")) {
      const cleanCh = String(channel).replace(/^@/, "");
      directPostUrl = `https://t.me/${cleanCh}/${postId}`;
    }

    try {
      let publishRes;
      if (posterUrl) {
        publishRes = await sendPhoto(env, targetChannel, posterUrl, caption);
      } else {
        publishRes = await sendMessage(env, targetChannel, caption);
      }

      if (!publishRes.ok) {
        throw new Error(publishRes.description || "Send error");
      }

      const successCard =
        "╔══════════════════════════╗\n" +
        "  🚀 <b>پست با موفقیت در کانال منتشر شد!</b>\n" +
        "╚══════════════════════════╝\n\n" +
        `🎬 <b>اثر:</b> ${escapeHtml(pending.title_fa)} (${escapeHtml(pending.title_en)})\n` +
        `📢 <b>کانال مقصد:</b> <code>${escapeHtml(targetChannel)}</code>\n` +
        `🔗 <b>شناسه مرجع:</b> <code>#${escapeHtml(postId)}</code>\n` +
        "─────────────────────────\n" +
        "✨ <b>برای ساخت پست بعدی، نام فیلم یا سریال جدید را بفرستید:</b>";

      const kbRows = [];
      if (directPostUrl) {
        kbRows.push([{ text: "🌐 مشاهده پست در کانال", url: directPostUrl, style: "primary" }]);
      }
      kbRows.push([
        { text: "🎬 ایجاد پست جدید", callback_data: "search_again", style: "primary" },
        { text: "⚙️ تنظیمات کانال", callback_data: "set_channel", style: "danger" },
      ]);

      await clearUserSession(env, chatId);
      return sendMessage(env, chatId, successCard, { inline_keyboard: kbRows });
    } catch (e) {
      console.error("Publish to channel failed:", e);
      const fallbackNotice =
        "⚠️ <b>عدم امکان ارسال خودکار به کانال!</b>\n\n" +
        "ربات نتوانست پست را مستقیماً منتشر کند (دسترسی ادمین یا اجازه ارسال پیام ربات در کانال را بررسی کنید).\n" +
        "👇 <b>خروجی نهایی آماده است و در زیر تقدیم شما می‌شود:</b>";

      await sendMessage(env, chatId, fallbackNotice);
      if (posterUrl) {
        await sendPhoto(env, chatId, posterUrl, caption);
      } else {
        await sendMessage(env, chatId, caption);
      }

      const actionKb = {
        inline_keyboard: [
          [
            { text: "🎬 شروع مجدد", callback_data: "search_again", style: "primary" },
            { text: "⚙️ بررسی کانال", callback_data: "set_channel", style: "danger" },
          ],
        ],
      };
      await clearUserSession(env, chatId);
      return sendMessage(env, chatId, "💡 برای اثر بعدی نام فیلم را بفرستید:", actionKb);
    }
  }

  // جستجوی پیش‌فرض: کاربر نام فیلم یا سریال را ارسال کرده است
  if (text) {
    if (!currentChannel) {
      await setUserSession(env, chatId, "WAITING_CHANNEL", {});
      const askChannel =
        "⚠️ <b>کانال مقصد تنظیم نشده است!</b>\n\n" +
        "برای انتشار پست‌ها، ابتدا باید آیدی کانال مقصد را ارسال کنید (مثال: <code>@MyChannel</code>):";
      const kb = {
        inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel", style: "danger" }]],
      };
      return sendMessage(env, chatId, askChannel, kb);
    }

    const waitMsg = await sendMessage(
      env,
      chatId,
      "⚡ <i>در حال جستجو در پایگاه بین‌المللی TMDB...</i>"
    );

    const results = await searchTmdb(env, text);
    if (!results || results.length === 0) {
      const notFoundText =
        "❌ <b>نتیجه‌ای برای این عنوان یافت نشد!</b>\n\n" +
        "💡 <i>پیشنهاد: نام لاتین اثر را امتحان کنید (مثلاً: Interstellar یا Game of Thrones).</i>";
      const kb = {
        inline_keyboard: [
          [
            { text: "🔄 جستجوی مجدد", callback_data: "search_again", style: "primary" },
            { text: "❌ انصراف", callback_data: "cancel", style: "danger" },
          ],
        ],
      };
      if (waitMsg && waitMsg.result) {
        return editMessageText(env, chatId, waitMsg.result.message_id, notFoundText, kb);
      }
      return sendMessage(env, chatId, notFoundText, kb);
    }

    if (results.length === 1) {
      if (waitMsg && waitMsg.result) {
        await deleteMessage(env, chatId, waitMsg.result.message_id);
      }
      return showResultAndPosters(env, chatId, results[0]);
    }

    const kbRows = [];
    const searchMap = {};
    for (const item of results) {
      const isMovie = item.media_type === "movie";
      const badge = isMovie ? "🎬 فیلم" : "📺 سریال";
      let name = isMovie ? item.title : item.name;
      name = name || item.original_title || item.original_name || "عنوان ناشناخته";

      const yearRaw = isMovie ? item.release_date : item.first_air_date;
      const year = yearRaw ? `(${yearRaw.slice(0, 4)})` : "";

      let label = `${badge} | ${name} ${year}`.trim();
      if (label.length > 55) label = label.slice(0, 52) + "...";

      const key = `${item.id}_${item.media_type}`;
      searchMap[key] = item;
      kbRows.push([{ text: label, callback_data: `sel_${key}`, style: "primary" }]);
    }

    kbRows.push([
      { text: "🔄 جستجوی دوباره", callback_data: "search_again", style: "danger" },
      { text: "❌ لغو", callback_data: "cancel", style: "danger" },
    ]);

    await setUserSession(env, chatId, "WAITING_MOVIE_SELECT", { search_results: searchMap });

    const listText =
      "🎯 <b>نتایج یافت شده برای عنوان شما:</b>\n" +
      "─────────────────────────\n" +
      "لطفاً گزینه دقیق مورد نظر خود را از لیست زیر انتخاب فرمایید:";

    if (waitMsg && waitMsg.result) {
      await deleteMessage(env, chatId, waitMsg.result.message_id);
    }
    return sendMessage(env, chatId, listText, { inline_keyboard: kbRows });
  }
}

async function handleCallbackQuery(env, cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const data = cq.data || "";

  if (data === "noop") {
    return answerCallbackQuery(env, cq.id);
  }

  if (data.startsWith("upd_")) {
    if (!(await isOwner(env, cq.from && cq.from.id, cq.message.chat.type))) {
      return answerCallbackQuery(env, cq.id, "⛔️ این بخش فقط برای مالک ربات است.", true);
    }
    await answerCallbackQuery(env, cq.id);
    if (data === "upd_check") return showUpdateCheck(env, chatId, messageId);
    if (data === "upd_verify") return verifyUpdate(env, chatId, messageId);
    if (data === "upd_rollback") return confirmRollback(env, chatId, messageId);
    if (data === "upd_rollback_go") return performRollback(env, chatId, messageId);
    const go = data.match(/^upd_go_([0-9a-f]{12})$/);
    if (go) return performUpdate(env, chatId, messageId, go[1]);
    return;
  }

  if (data === "cancel") {
    await clearUserSession(env, chatId);
    await answerCallbackQuery(env, cq.id, "عملیات لغو شد.");
    await deleteMessage(env, chatId, messageId);
    const cancelText = "❌ <b>عملیات لغو شد.</b>\n\nنام فیلم یا سریال جدید را ارسال فرمایید:";
    const kb = {
      inline_keyboard: [
        [
          { text: "🔍 جستجوی جدید", callback_data: "search_again", style: "primary" },
          { text: "⚙️ تغییر کانال مقصد", callback_data: "set_channel", style: "danger" },
        ],
      ],
    };
    return sendMessage(env, chatId, cancelText, kb);
  }

  if (data.startsWith("stop_")) {
    if (!(await isOwner(env, cq.from && cq.from.id, cq.message.chat.type))) {
      return answerCallbackQuery(env, cq.id, "⛔️ این بخش فقط برای مالک ربات است.", true);
    }
    await answerCallbackQuery(env, cq.id);
    if (data === "stop_ask") return showStopAsk(env, chatId, messageId);
    const go = data.match(/^stop_go_([0-9a-f]{16})$/);
    if (go) return performStop(env, chatId, messageId, go[1]);
    return;
  }

  if (data === "help") {
    await answerCallbackQuery(env, cq.id);
    const { text, keyboard } = getHelpUI();
    return editMessageText(env, chatId, messageId, text, keyboard);
  }

  if (data === "back_to_start") {
    await answerCallbackQuery(env, cq.id);
    const currentChannel = await getUserChannel(env, chatId);
    const owner = await isOwner(env, cq.from && cq.from.id, cq.message.chat.type);
    const { text, keyboard } = getStartUI(currentChannel, owner);
    return editMessageText(env, chatId, messageId, text, keyboard);
  }

  if (data === "set_channel") {
    await answerCallbackQuery(env, cq.id);
    await setUserSession(env, chatId, "WAITING_CHANNEL", {});
    const promptText =
      "╭─────────────────────────╮\n" +
      "  ⚙️ <b>تنظیم کانال خروجی | کانال مقصد</b>\n" +
      "╰─────────────────────────╯\n\n" +
      "برای انتشار خودکار پست‌ها در کانال، یکی از ۲ روش زیر را انجام دهید:\n\n" +
      "📌 <b>روش اول (کانال عمومی):</b>\n" +
      "آیدی عمومی کانال را با <code>@</code> بفرستید:\n" +
      "مثال: <code>@MyMovieChannel</code>\n\n" +
      "📌 <b>روش دوم (کانال خصوصی):</b>\n" +
      "لینک یکی از پست‌های کانال خود را ارسال کنید:\n" +
      "مثال: <code>https://t.me/c/1234567890/123</code>\n\n" +
      "⚠️ <i>الزام مهم: ربات حتماً باید در کانال شما عضو و ادمین با دسترسی ارسال پیام (Post Messages) باشد.</i>";

    const kb = {
      inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel", style: "danger" }]],
    };
    return sendMessage(env, chatId, promptText, kb);
  }

  if (data === "search_again") {
    await answerCallbackQuery(env, cq.id);
    await clearUserSession(env, chatId);
    const sText =
      "🔍 <b>جستجوی عنوان سینمایی جدید:</b>\n" +
      "─────────────────────────\n" +
      "لطفاً نام فیلم یا سریال مورد نظر خود را بنویسید:\n" +
      "📥 <i>مثال: Oppenheimer یا Succession</i>";
    const kb = {
      inline_keyboard: [[{ text: "❌ انصراف", callback_data: "cancel", style: "danger" }]],
    };
    return sendMessage(env, chatId, sText, kb);
  }

  if (data.startsWith("sel_")) {
    await answerCallbackQuery(env, cq.id);
    const key = data.replace("sel_", "");
    const session = await getUserSession(env, chatId);
    const item = session?.data?.search_results?.[key];
    if (!item) {
      return answerCallbackQuery(env, cq.id, "⚠️ این جستجو منقضی شده است. لطفاً دوباره نام اثر را بنویسید.", true);
    }
    await deleteMessage(env, chatId, messageId);
    return showResultAndPosters(env, chatId, item);
  }

  if (data === "next_poster" || data === "prev_poster") {
    const session = await getUserSession(env, chatId);
    const pending = session?.data?.pending;
    if (!pending) {
      return answerCallbackQuery(env, cq.id, "سشن منقضی شده است.", true);
    }

    const posters = pending.posters || [];
    let idx = pending.poster_index || 0;
    if (data === "next_poster") {
      if (idx + 1 >= posters.length) {
        return answerCallbackQuery(env, cq.id, "این آخرین پوستر موجود است ✨");
      }
      idx++;
    } else {
      if (idx - 1 < 0) {
        return answerCallbackQuery(env, cq.id, "این اولین پوستر موجود است ✨");
      }
      idx--;
    }

    pending.poster_index = idx;
    await setUserSession(env, chatId, "WAITING_POSTER", { pending });
    await answerCallbackQuery(env, cq.id);
    return renderPosterGallery(env, chatId, messageId, pending, true);
  }

  if (data === "poster_info") {
    const session = await getUserSession(env, chatId);
    const pending = session?.data?.pending;
    if (pending) {
      const idx = (pending.poster_index || 0) + 1;
      const total = (pending.posters || []).length;
      return answerCallbackQuery(env, cq.id, `🖼 پوستر شماره ${idx} از مجموع ${total} پوستر`);
    }
    return answerCallbackQuery(env, cq.id);
  }

  if (data === "confirm_poster") {
    await answerCallbackQuery(env, cq.id, "پوستر تایید شد ✅");
    const session = await getUserSession(env, chatId);
    const pending = session?.data?.pending;
    if (!pending) {
      return sendMessage(env, chatId, "سشن منقضی شده است.");
    }

    await setUserSession(env, chatId, "WAITING_FORWARD", { pending });
    const currentChannel = await getUserChannel(env, chatId);
    const chDisplay = currentChannel ? `<code>${escapeHtml(currentChannel)}</code>` : "<i>تنظیم نشده</i>";

    const stepText =
      "╭─────────────────────────╮\n" +
      "  🎯 <b>مرحله آخر: اتصال به فایل کانال</b>\n" +
      "╰─────────────────────────╯\n\n" +
      "✨ پوستر و مشخصات اثر با موفقیت تایید گردید.\n" +
      `📢 <b>کانال مقصد:</b> ${chDisplay}\n\n` +
      "👇 <b>یکی از ۲ اقدام زیر را برای انتشار نهایی انجام دهید:</b>\n\n" +
      "<b>1️⃣ ارسال با فوروارد:</b>\n" +
      "پیام فایل یا ویدیو را از کانال خود به این ربات <b>Forward</b> کنید.\n\n" +
      "<b>2️⃣ ارسال لینک مستقیم:</b>\n" +
      "یا لینک مستقیم پیام کانال را ارسال فرمایید:\n" +
      "🔗 <code>https://t.me/c/1234567890/123</code>";

    const kb = {
      inline_keyboard: [
        [
          { text: "🖼 تغییر مجدد پوستر", callback_data: "back_to_poster", style: "primary" },
          { text: "❌ انصراف", callback_data: "cancel", style: "danger" },
        ],
      ],
    };
    return sendMessage(env, chatId, stepText, kb);
  }

  if (data === "back_to_poster") {
    await answerCallbackQuery(env, cq.id);
    const session = await getUserSession(env, chatId);
    const pending = session?.data?.pending;
    if (!pending) {
      return sendMessage(env, chatId, "⚠️ سشن منقضی شده است.");
    }
    await setUserSession(env, chatId, "WAITING_POSTER", { pending });
    return renderPosterGallery(env, chatId, null, pending, false);
  }

  return answerCallbackQuery(env, cq.id);
}

// ─── نمایش اطلاعات و گالری پوسترها ───────────────────────────────────────────
async function showResultAndPosters(env, chatId, item) {
  const tmdbId = item.id;
  const mediaType = item.media_type;

  const details = await getTmdbDetails(env, tmdbId, mediaType);
  const faData = details.fa || {};
  const enData = details.en || {};
  const faExplicit = details.fa_explicit_title;

  const ratingVal = faData.vote_average || enData.vote_average || 0;
  const rating = ratingVal ? String(Math.round(ratingVal * 10) / 10) : "0";

  const genresList = faData.genres || enData.genres || [];
  const genresStr = getPersianGenres(genresList);

  let titleEn = "";
  let titleFa = "";
  let year = "2026";
  let seasonsInfo = "";

  if (mediaType === "movie") {
    titleEn = enData.title || enData.original_title || "";
    titleFa = faExplicit || faData.title || faData.original_title || titleEn;
    if (!/[؀-ۿ]/.test(titleFa) || titleFa === titleEn) {
      titleFa = await translateToPersian(titleEn);
    }
    const relDate = enData.release_date || faData.release_date || "";
    year = /^\d{4}/.test(relDate) ? relDate.slice(0, 4) : "2026";
  } else {
    titleEn = enData.name || enData.original_name || "";
    titleFa = faExplicit || faData.name || faData.original_name || titleEn;
    if (!/[؀-ۿ]/.test(titleFa) || titleFa === titleEn) {
      titleFa = await translateToPersian(titleEn);
    }
    const firstAir = enData.first_air_date || faData.first_air_date || "";
    year = /^\d{4}/.test(firstAir) ? firstAir.slice(0, 4) : "2026";
    seasonsInfo = getIntelligentSeasons(year, enData, faData);
  }

  let posters = await getTmdbPosters(env, tmdbId, mediaType);
  if (!posters || posters.length === 0) {
    const fallbackPath = enData.poster_path || faData.poster_path;
    if (fallbackPath) {
      posters = [`https://image.tmdb.org/t/p/w780${fallbackPath}`];
    }
  }

  const pending = {
    title_en: titleEn,
    title_fa: titleFa,
    year: year,
    media_type: mediaType,
    rating: rating,
    genres_str: genresStr,
    seasons_info: seasonsInfo,
    posters: posters || [],
    poster_index: 0,
  };

  await setUserSession(env, chatId, "WAITING_POSTER", { pending });
  return renderPosterGallery(env, chatId, null, pending, false);
}

async function renderPosterGallery(env, chatId, messageId, pending, isEdit = false) {
  const posters = pending.posters || [];
  const index = pending.poster_index || 0;
  const total = posters.length;

  const previewCaption = buildCaption(
    pending.title_en,
    pending.title_fa,
    pending.year,
    pending.media_type,
    pending.rating,
    pending.genres_str,
    pending.seasons_info,
    "YourChannel",
    "XXXXX"
  );

  const captionText =
    "<blockquote>╭─────────────────────────╮\n" +
    "  🖼 <b>گالری پوسترها | پیش‌نمایش خروجی</b>\n" +
    "╰─────────────────────────╯\n\n" +
    `${previewCaption}</blockquote>\n\n` +
    "💡 <i>پوستر دلخواه را با دکمه‌های ناوبری انتخاب و تایید فرمایید.</i>";

  if (!posters || posters.length === 0) {
    const kb = {
      inline_keyboard: [
        [{ text: "✨ تایید بدون پوستر", callback_data: "confirm_poster", style: "success" }],
        [{ text: "🔄 جستجوی دیگر", callback_data: "search_again", style: "danger" }],
      ],
    };
    return sendMessage(env, chatId, `⚠️ <b>پوستری یافت نشد!</b>\n\n${captionText}`, kb);
  }

  const posterUrl = posters[index];

  const navRow = [
    { text: "◀️ قبلی", callback_data: "prev_poster", style: "primary" },
    { text: `🖼 پوستر ${index + 1} از ${total}`, callback_data: "poster_info", style: "danger" },
    { text: "بعدی ▶️", callback_data: "next_poster", style: "primary" },
  ];
  const confirmRow = [
    { text: "💎 انتخاب و تایید این پوستر ➜", callback_data: "confirm_poster", style: "success" },
  ];
  const actionRow = [
    { text: "🔄 جستجوی دوباره", callback_data: "search_again", style: "danger" },
    { text: "❌ لغو", callback_data: "cancel", style: "danger" },
  ];

  const keyboard = { inline_keyboard: [navRow, confirmRow, actionRow] };

  if (isEdit && messageId) {
    return editMessageMedia(env, chatId, messageId, posterUrl, captionText, keyboard);
  }
  return sendPhoto(env, chatId, posterUrl, captionText, keyboard);
}

// ─── Setup wizard (served from wizard.html) + authenticated setup API ─────────
const SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};


const BOT_TOKEN_RE = /^\d{5,}:[A-Za-z0-9_-]{30,}$/;
const TMDB_KEY_RE = /^[a-f0-9]{32}$/i;
const MAX_SETUP_BODY = 10_000;
const CF_API = "https://api.cloudflare.com/client/v4";
const CRON_EXPRESSION = "*/30 * * * *";

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

function fail(status, fa, en, code) {
  return jsonResponse({ ok: false, fa, en, code }, status);
}

async function sha256(value) {
  const data = new TextEncoder().encode(String(value));
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

// Compares digests so neither the content nor the length of a secret leaks via timing.
async function safeEqual(a, b) {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ── Cloudflare API helpers (used only when the owner pastes an API token) ─────
async function cfFetch(token, path, init = {}) {
  try {
    const res = await fetch(CF_API + path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {
      /* non-JSON body */
    }
    return { ok: res.ok && !!data && data.success !== false, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: null };
  }
}

function cfErrorText(res) {
  const first = res && res.data && res.data.errors && res.data.errors[0];
  return first && first.message ? String(first.message).slice(0, 200) : `HTTP ${res ? res.status : "?"}`;
}

// A workers.dev host looks like <script>.<account-subdomain>.workers.dev.
function parseWorkersDevHost(hostname) {
  const parts = String(hostname).toLowerCase().split(".");
  if (parts.length === 4 && parts[2] === "workers" && parts[3] === "dev") {
    return { script: parts[0], subdomain: parts[1] };
  }
  return null;
}

// Anchor ownership to Cloudflare's routing records for the requested hostname,
// never just to a script name supplied by a caller. Custom Domains keep setup
// usable when an account's workers.dev routes fail before the Worker can run.
async function proveCloudflareOwner(cfToken, url) {
  const host = parseWorkersDevHost(url.hostname);
  const accounts = await cfFetch(cfToken, "/accounts?per_page=50");
  if (!accounts.ok) {
    return {
      error: fail(
        401,
        "توکن Cloudflare معتبر نیست یا دسترسی «Account Settings: Read» ندارد.",
        "The Cloudflare token is invalid or lacks Account Settings: Read.",
        "bad_cf_token"
      ),
    };
  }
  for (const acc of (accounts.data.result || []).slice(0, 8)) {
    let scriptName;
    if (host) {
      const sub = await cfFetch(cfToken, `/accounts/${acc.id}/workers/subdomain`);
      if (!sub.ok || !sub.data.result || sub.data.result.subdomain !== host.subdomain) continue;
      scriptName = host.script;
    } else {
      const domains = await cfFetch(cfToken, `/accounts/${acc.id}/workers/domains?per_page=100`);
      if (!domains.ok) continue;
      const route = (domains.data.result || []).find(
        (d) => String(d.hostname || "").toLowerCase() === url.hostname.toLowerCase() && d.environment === "production"
      );
      if (!route || !WORKER_NAME_RE.test(route.service || "")) continue;
      scriptName = route.service;
    }
    const script = await cfFetch(cfToken, `/accounts/${acc.id}/workers/scripts/${scriptName}/settings`);
    if (script.ok) return { accountId: acc.id, script: scriptName };
  }
  return {
    error: fail(
      403,
      "این توکن به اکانتی که این Worker روی آن اجرا می‌شود دسترسی ندارد.",
      "This token has no access to the account that runs this Worker.",
      "not_owner"
    ),
  };
}

// Returns { via, ... } on success or { error: Response } on failure.
async function authorizeSetup(env, body, url) {
  if (typeof body.setupKey === "string" && body.setupKey) {
    const expected = env.SETUP_KEY ? String(env.SETUP_KEY) : "";
    if (expected.length >= 24 && (await safeEqual(body.setupKey, expected))) return { via: "key" };
    return { error: fail(401, "کلید راه‌اندازی اشتباه است.", "Wrong setup key.", "bad_key") };
  }
  if (typeof body.cfToken === "string" && body.cfToken) {
    const proof = await proveCloudflareOwner(body.cfToken.trim(), url);
    if (proof.error) return proof;
    return { via: "cloudflare", cfToken: body.cfToken.trim(), accountId: proof.accountId, script: proof.script };
  }
  return {
    error: fail(401, "توکن Cloudflare یا کلید راه‌اندازی لازم است.", "A Cloudflare token or setup key is required.", "no_credentials"),
  };
}

async function isConfigured(env) {
  if (!env.DB) return false;
  const [bot, tmdb, secret] = await Promise.all([
    getSetting(env, "BOT_TOKEN"),
    getSetting(env, "TMDB_KEY"),
    getSetting(env, "WEBHOOK_SECRET"),
  ]);
  return !!(bot && tmdb && secret);
}

async function telegramGetMe(botToken) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    return await res.json();
  } catch (e) {
    return { ok: false };
  }
}

// Creates (or reuses) a D1 database and binds it to this Worker as DB, keeping
// every binding the Worker already has (variables and secrets such as SETUP_KEY).
async function createAndBindDatabase(auth) {
  const { cfToken, accountId, script } = auth;
  const dbName = `${script}-db`.slice(0, 60);

  const db = await getOrCreateDatabase(cfToken, accountId, dbName);
  if (db.error) return db.error;
  const dbId = db.dbId;

  const current = await cfFetch(cfToken, `/accounts/${accountId}/workers/scripts/${script}/settings`);
  if (!current.ok) {
    return fail(502, "خواندن تنظیمات Worker ناموفق بود.", `Reading the Worker settings failed. (${cfErrorText(current)})`, "settings_read_failed");
  }
  const keep = ((current.data.result && current.data.result.bindings) || [])
    .filter((b) => b.name !== "DB")
    .map((b) => ({ name: b.name, type: "inherit" }));
  const settings = { bindings: [...keep, { name: "DB", type: "d1", id: dbId }] };

  const form = new FormData();
  form.append("settings", new Blob([JSON.stringify(settings)], { type: "application/json" }));
  const patched = await cfFetch(cfToken, `/accounts/${accountId}/workers/scripts/${script}/settings`, {
    method: "PATCH",
    body: form,
  });
  if (!patched.ok) {
    return fail(
      502,
      `اتصال دیتابیس به Worker ناموفق بود. دسترسی «Workers Scripts: Edit» را بررسی کنید. (${cfErrorText(patched)})`,
      `Binding the database to the Worker failed. Check Workers Scripts: Edit. (${cfErrorText(patched)})`,
      "bind_failed"
    );
  }
  return jsonResponse({ ok: true });
}

// ─── Owner and in-bot updates ─────────────────────────────────────────────────
// The owner (claimed once through a link from the setup wizard) can check the
// GitHub release for a newer worker.js from inside Telegram and, after an
// explicit confirmation, replace this Worker's code. Bindings, secrets, cron and
// the database are kept; the previous version stays available for rollback.
const UPDATE_REPO_DEFAULT = "ArizoOwner/Arizo_Movie";
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const IS_SOURCE_BUILD = BUILD_ID.startsWith("__");
const CLAIM_TTL_MS = 2 * 60 * 60 * 1000;

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function updateRepo(env) {
  const repo = String(env.UPDATE_REPO || "").trim();
  return REPO_RE.test(repo) ? repo : UPDATE_REPO_DEFAULT;
}

async function isOwner(env, userId, chatType) {
  if (chatType !== "private" || !userId) return false;
  const admin = await getSetting(env, "ADMIN_ID");
  return !!admin && String(admin) === String(userId);
}

async function handleOwnerClaim(env, message, code) {
  const chatId = message.chat.id;
  if (message.chat.type !== "private" || !message.from) return;
  const hash = await getSetting(env, "OWNER_CLAIM_HASH");
  const exp = Number(await getSetting(env, "OWNER_CLAIM_EXP")) || 0;
  const given = toHex(await sha256(code));
  if (!hash || Date.now() > exp || !(await safeEqual(given, hash))) {
    return sendMessage(
      env,
      chatId,
      "⛔️ <b>لینک مالکیت نامعتبر یا منقضی است.</b>\n\nویزارد راه‌اندازی را دوباره اجرا کنید تا لینک تازه بگیرید."
    );
  }
  await setSetting(env, "ADMIN_ID", String(message.from.id));
  await setSetting(env, "OWNER_CLAIM_HASH", "");
  await setSetting(env, "OWNER_CLAIM_EXP", "0");
  const { text, keyboard } = getStartUI(await getUserChannel(env, chatId), true);
  await sendMessage(env, chatId, "👑 <b>شما مالک این ربات شدید.</b>\nاز این پس دکمهٔ «بررسی بروزرسانی» در منوی اصلی برای شما نمایش داده می‌شود.");
  return sendMessage(env, chatId, text, keyboard);
}

// ── release lookup ────────────────────────────────────────────────────────────
function parseBuildInfo(text) {
  const id = (text.match(/const BUILD_ID = "([0-9a-f]{12})";/) || [])[1] || null;
  const version = (text.match(/const APP_VERSION = "([0-9A-Za-z.+-]{1,32})";/) || [])[1] || null;
  return { id, version };
}

// The build id is the first 12 hex chars of the SHA-256 of the file with the id
// zeroed. Recomputing it detects a truncated or altered download.
async function releaseIntegrityOk(text, id) {
  const zeros = "0".repeat(12);
  const probe = text.replace(`const BUILD_ID = "${id}";`, `const BUILD_ID = "${zeros}";`);
  return toHex(await sha256(probe)).slice(0, 12) === id;
}

async function fetchLatestRelease(env) {
  const repo = updateRepo(env);
  const base = `https://github.com/${repo}/releases/latest`;
  const headers = { "User-Agent": "Arizo-Movie-Updater", "Cache-Control": "no-cache" };

  let tag = null;
  try {
    const head = await fetch(base, { redirect: "manual", headers });
    const m = (head.headers.get("Location") || "").match(/\/releases\/tag\/([^/?#]+)$/);
    if (m) tag = decodeURIComponent(m[1]);
  } catch (e) {
    /* the tag is only informational */
  }

  let res;
  try {
    res = await fetch(`${base}/download/worker.js`, { redirect: "follow", headers, cf: { cacheTtl: 0 } });
  } catch (e) {
    return { error: "unreachable" };
  }
  if (!res.ok) return { error: "missing" };
  if (Number(res.headers.get("Content-Length") || 0) > MAX_RELEASE_BYTES) return { error: "invalid" };
  const text = await res.text();
  if (text.length > MAX_RELEASE_BYTES || !text.includes("export default")) return { error: "invalid" };
  const info = parseBuildInfo(text);
  if (!info.id || !(await releaseIntegrityOk(text, info.id))) return { error: "invalid" };
  return {
    text,
    tag,
    version: info.version,
    buildId: info.id,
    url: tag ? `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}` : base,
  };
}

async function getUpdateConfig(env) {
  const token = env.CF_API_TOKEN ? String(env.CF_API_TOKEN) : "";
  const accountId = await getSetting(env, "CF_ACCOUNT_ID");
  const script = await getSetting(env, "CF_SCRIPT_NAME");
  if (!token || !ACCOUNT_ID_RE.test(accountId) || !WORKER_NAME_RE.test(script)) return null;
  return { token, accountId, script };
}

function describeBuild(version, id) {
  const short = `<code>${escapeHtml(String(id).slice(0, 7))}</code>`;
  if (!version) return short;
  const label = version.startsWith("__") ? "نسخهٔ سورس" : version;
  return `<code>${escapeHtml(label)}</code> · ${short}`;
}

function updateErrorText(code) {
  if (code === "missing") return "فایل ریلیز در GitHub پیدا نشد.";
  if (code === "invalid") return "فایل ریلیز معتبر نبود (یکپارچگی تأیید نشد) و برای امنیت رد شد.";
  return "ارتباط با GitHub برقرار نشد.";
}

function responder(env, chatId, messageId) {
  return (text, keyboard) =>
    messageId ? editMessageText(env, chatId, messageId, text, keyboard) : sendMessage(env, chatId, text, keyboard);
}

const BACK_BUTTON = [{ text: "🔙 بازگشت به منو", callback_data: "back_to_start", style: "primary" }];
const CHECK_BUTTON = { text: "🔄 بررسی دوباره", callback_data: "upd_check", style: "primary" };

async function showUpdateCheck(env, chatId, messageId) {
  const show = responder(env, chatId, messageId);
  const rel = await fetchLatestRelease(env);
  if (rel.error) {
    return show(`⚠️ <b>بررسی بروزرسانی ناموفق بود</b>\n\n${updateErrorText(rel.error)}`, {
      inline_keyboard: [[CHECK_BUTTON], BACK_BUTTON],
    });
  }

  const prevVersion = await getSetting(env, "UPDATE_PREV_VERSION");
  const rollbackRow = UUID_RE.test(prevVersion)
    ? [[{ text: "↩️ بازگشت به نسخهٔ قبلی", callback_data: "upd_rollback", style: "danger" }]]
    : [];

  if (!IS_SOURCE_BUILD && rel.buildId === BUILD_ID) {
    return show(
      `✅ <b>ربات به‌روز است</b>\n\nنسخهٔ فعلی: ${describeBuild(APP_VERSION, BUILD_ID)}\n📎 <a href="${escapeHtml(rel.url)}">صفحهٔ ریلیز</a>`,
      { inline_keyboard: [[CHECK_BUTTON], ...rollbackRow, BACK_BUTTON] }
    );
  }

  const sameVersion = !IS_SOURCE_BUILD && rel.version === APP_VERSION;
  const note = sameVersion
    ? "\nℹ️ شمارهٔ نسخه همان است، ولی فایل همین ریلیز بعد از نصب شما بروزرسانی شده است."
    : IS_SOURCE_BUILD
      ? "\nℹ️ این کپی از روی سورس مستقر شده؛ بروزرسانی آن را با فایل رسمی ریلیز جایگزین می‌کند."
      : "";
  const text =
    "🆕 <b>بروزرسانی موجود است</b>\n\n" +
    `فعلی: ${describeBuild(APP_VERSION, BUILD_ID)}\n` +
    `جدید: ${describeBuild(rel.version, rel.buildId)}${note}\n` +
    `📎 <a href="${escapeHtml(rel.url)}">یادداشت‌های انتشار</a>\n\n` +
    "با تأیید شما فایل ربات از ریلیز رسمی GitHub دانلود و جایگزین می‌شود. تنظیمات، رمزها و دیتابیس دست‌نخورده می‌مانند.";

  const cfg = await getUpdateConfig(env);
  if (!cfg) {
    const origin = await getSetting(env, "WORKER_ORIGIN");
    const setupRow = origin ? [[{ text: "⚙️ باز کردن ویزارد", url: `${origin}/setup`, style: "primary" }]] : [];
    return show(
      text +
        "\n\n🔒 <b>بروزرسانی از داخل ربات فعال نیست.</b>\nبرای فعال کردن، ویزارد را اجرا کنید و گزینهٔ «بروزرسانی از داخل تلگرام» را بزنید؛ یا فایل را خودتان در Cloudflare جایگزین کنید.",
      { inline_keyboard: [...setupRow, [CHECK_BUTTON], BACK_BUTTON] }
    );
  }
  return show(text, {
    inline_keyboard: [
      [{ text: "✅ بروزرسانی کن", callback_data: `upd_go_${rel.buildId}`, style: "success" }],
      [{ text: "❌ لغو", callback_data: "back_to_start", style: "danger" }],
      ...rollbackRow,
    ],
  });
}

async function clearUpdateRecord(env) {
  for (const key of ["UPDATE_PREV_VERSION", "UPDATE_PREV_BUILD", "UPDATE_TARGET_BUILD", "UPDATE_TARGET_VERSION", "UPDATE_CHAT"]) {
    await setSetting(env, key, "");
  }
}

async function performUpdate(env, chatId, messageId, wantId) {
  const show = responder(env, chatId, messageId);
  const cfg = await getUpdateConfig(env);
  if (!cfg) return showUpdateCheck(env, chatId, messageId);

  const rel = await fetchLatestRelease(env);
  if (rel.error) {
    return show(`⚠️ <b>بروزرسانی انجام نشد</b>\n\n${updateErrorText(rel.error)}`, { inline_keyboard: [[CHECK_BUTTON], BACK_BUTTON] });
  }
  // The owner confirmed one specific build; if the release changed since, ask again.
  if (rel.buildId !== wantId) return showUpdateCheck(env, chatId, messageId);
  if (!IS_SOURCE_BUILD && rel.buildId === BUILD_ID) return showUpdateCheck(env, chatId, messageId);

  const base = `/accounts/${cfg.accountId}/workers/scripts/${cfg.script}`;
  const current = await cfFetch(cfg.token, `${base}/settings`);
  if (!current.ok) {
    return show(
      `⚠️ <b>دسترسی به Cloudflare ناموفق بود</b>\n\n${escapeHtml(cfErrorText(current))}\nشاید توکن منقضی یا باطل شده باشد؛ ویزارد را دوباره اجرا کنید.`,
      { inline_keyboard: [[CHECK_BUTTON], BACK_BUTTON] }
    );
  }
  const settings = current.data.result || {};

  // Remember the running version so the owner can roll back.
  let prevVersion = "";
  const deployments = await cfFetch(cfg.token, `${base}/deployments`);
  if (deployments.ok) {
    const live = ((deployments.data.result && deployments.data.result.deployments) || [])[0];
    const versions = ((live && live.versions) || []).slice().sort((a, b) => (b.percentage || 0) - (a.percentage || 0));
    prevVersion = (versions[0] && versions[0].version_id) || "";
  }
  await setSetting(env, "UPDATE_PREV_VERSION", prevVersion);
  await setSetting(env, "UPDATE_PREV_BUILD", BUILD_ID);
  await setSetting(env, "UPDATE_TARGET_BUILD", rel.buildId);
  await setSetting(env, "UPDATE_TARGET_VERSION", rel.version || "");
  await setSetting(env, "UPDATE_CHAT", String(chatId));

  const metadata = {
    main_module: "worker.js",
    compatibility_date: settings.compatibility_date || "2024-04-01",
    compatibility_flags: settings.compatibility_flags || [],
    bindings: (settings.bindings || []).map((b) => ({ name: b.name, type: "inherit" })),
  };
  // A plain upload resets these to their defaults (observed on real Cloudflare for
  // `observability`), so send back whatever the Worker already had.
  for (const key of ["observability", "placement", "limits", "tags", "tail_consumers", "logpush"]) {
    if (settings[key] !== undefined && settings[key] !== null) metadata[key] = settings[key];
  }
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("worker.js", new Blob([rel.text], { type: "application/javascript+module" }), "worker.js");
  const upload = await cfFetch(cfg.token, `${base}?bindings_inherit=strict`, { method: "PUT", body: form });
  if (!upload.ok) {
    await clearUpdateRecord(env);
    return show(
      `⚠️ <b>بروزرسانی انجام نشد</b>\n\nCloudflare فایل را نپذیرفت: ${escapeHtml(cfErrorText(upload))}\nنسخهٔ فعلی بدون تغییر ماند.`,
      { inline_keyboard: [[CHECK_BUTTON], BACK_BUTTON] }
    );
  }

  const rows = [[{ text: "🔍 تأیید اجرای نسخهٔ جدید", callback_data: "upd_verify", style: "success" }]];
  if (UUID_RE.test(prevVersion)) rows.push([{ text: "↩️ بازگشت به نسخهٔ قبلی", callback_data: "upd_rollback", style: "danger" }]);
  return show(
    "⬆️ <b>نسخهٔ جدید آپلود شد.</b>\n\nفعال شدنش معمولاً چند ثانیه طول می‌کشد. حدود ۱۰ ثانیه صبر کنید و بعد دکمهٔ «تأیید اجرا» را بزنید.",
    { inline_keyboard: rows }
  );
}

async function verifyUpdate(env, chatId, messageId) {
  const show = responder(env, chatId, messageId);
  const target = await getSetting(env, "UPDATE_TARGET_BUILD");
  const prevVersion = await getSetting(env, "UPDATE_PREV_VERSION");
  const rollbackRow = UUID_RE.test(prevVersion)
    ? [[{ text: "↩️ بازگشت به نسخهٔ قبلی", callback_data: "upd_rollback", style: "danger" }]]
    : [];

  if (!target) {
    return show(`ℹ️ بروزرسانی در انتظار نیست.\nنسخهٔ در حال اجرا: ${describeBuild(APP_VERSION, BUILD_ID)}`, {
      inline_keyboard: [[CHECK_BUTTON], ...rollbackRow, BACK_BUTTON],
    });
  }
  if (target === BUILD_ID) {
    await setSetting(env, "UPDATE_TARGET_BUILD", "");
    await setSetting(env, "UPDATE_CHAT", "");
    return show(`✅ <b>نسخهٔ جدید در حال اجراست</b>\n\n${describeBuild(APP_VERSION, BUILD_ID)}`, {
      inline_keyboard: [...rollbackRow, BACK_BUTTON],
    });
  }
  return show("⏳ هنوز نسخهٔ جدید فعال نشده. چند ثانیه بعد دوباره دکمه را بزنید.", {
    inline_keyboard: [[{ text: "🔍 تأیید اجرای نسخهٔ جدید", callback_data: "upd_verify", style: "success" }], ...rollbackRow],
  });
}

async function confirmRollback(env, chatId, messageId) {
  const show = responder(env, chatId, messageId);
  const prevVersion = await getSetting(env, "UPDATE_PREV_VERSION");
  const prevBuild = await getSetting(env, "UPDATE_PREV_BUILD");
  if (!UUID_RE.test(prevVersion)) {
    return show("ℹ️ نسخهٔ قبلی‌ای برای بازگشت ثبت نشده است.", { inline_keyboard: [BACK_BUTTON] });
  }
  return show(
    `↩️ <b>بازگشت به نسخهٔ قبلی؟</b>\n\nنسخهٔ قبلی: ${describeBuild("", prevBuild || "?")}\nتنظیمات و دیتابیس دست‌نخورده می‌مانند.`,
    {
      inline_keyboard: [
        [{ text: "✅ بله، برگرد", callback_data: "upd_rollback_go", style: "danger" }],
        [{ text: "❌ انصراف", callback_data: "back_to_start", style: "primary" }],
      ],
    }
  );
}

async function performRollback(env, chatId, messageId) {
  const show = responder(env, chatId, messageId);
  const cfg = await getUpdateConfig(env);
  const prevVersion = await getSetting(env, "UPDATE_PREV_VERSION");
  if (!cfg || !UUID_RE.test(prevVersion)) {
    return show("⚠️ بازگشت ممکن نیست (نسخهٔ قبلی یا دسترسی Cloudflare ثبت نشده).", { inline_keyboard: [BACK_BUTTON] });
  }
  const res = await cfFetch(cfg.token, `/accounts/${cfg.accountId}/workers/scripts/${cfg.script}/deployments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy: "percentage", versions: [{ version_id: prevVersion, percentage: 100 }] }),
  });
  if (!res.ok) {
    return show(`⚠️ <b>بازگشت انجام نشد</b>\n\n${escapeHtml(cfErrorText(res))}`, { inline_keyboard: [BACK_BUTTON] });
  }
  await clearUpdateRecord(env);
  return show("✅ <b>بازگشت ثبت شد.</b>\nنسخهٔ قبلی طی چند ثانیه فعال می‌شود.", { inline_keyboard: [BACK_BUTTON] });
}

// Called from cron: once the new code is the one running, tell the owner.
async function announcePendingUpdate(env) {
  const target = await getSetting(env, "UPDATE_TARGET_BUILD");
  const chat = await getSetting(env, "UPDATE_CHAT");
  if (!target || !chat || target !== BUILD_ID) return;
  await sendMessage(env, chat, `✅ <b>بروزرسانی کامل شد.</b>\n${describeBuild(APP_VERSION, BUILD_ID)}`);
  await setSetting(env, "UPDATE_TARGET_BUILD", "");
  await setSetting(env, "UPDATE_CHAT", "");
}

// ─── Stop and remove the bot ──────────────────────────────────────────────────
// Owner-only and two taps. Always: remove the Telegram webhook and command menu,
// then erase the bot's data. With the stored Cloudflare token (opt-in) it also
// deletes the D1 database and the Worker itself. It cannot revoke the bot token,
// the TMDB key or the Cloudflare token: those stay valid until the owner revokes
// them, and the final message says so.
const STOP_CODE_TTL_MS = 10 * 60 * 1000;
const STOP_MAX_NEIGHBOURS = 25;
const OWN_TABLES = ["settings", "user_sessions", "user_channels", "post_history"];

async function tgRaw(token, method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    return { ok: false };
  }
}

// What a removal would touch. The database is deleted only when this Worker is its
// only user; if another Worker binds the same database, or that cannot be checked,
// the database is left alone.
async function planRemoval(env) {
  const plan = { mode: "data", script: null, dbId: null, dbName: null, shared: null, neighbours: [], cfFailed: false };
  const cfg = await getUpdateConfig(env);
  if (!cfg) return plan;

  const base = `/accounts/${cfg.accountId}/workers/scripts`;
  const own = await cfFetch(cfg.token, `${base}/${cfg.script}/settings`);
  if (!own.ok) {
    plan.cfFailed = true;
    return plan;
  }
  plan.mode = "full";
  plan.script = cfg.script;

  const binding = ((own.data.result && own.data.result.bindings) || []).find((b) => b.name === "DB" && b.type === "d1");
  plan.dbId = binding && UUID_RE.test(String(binding.id || "")) ? binding.id : null;
  if (!plan.dbId) {
    plan.shared = "unknown";
    return plan;
  }

  const [info, list] = await Promise.all([
    cfFetch(cfg.token, `/accounts/${cfg.accountId}/d1/database/${plan.dbId}`),
    cfFetch(cfg.token, base),
  ]);
  plan.dbName = info.ok && info.data.result ? info.data.result.name || null : null;
  const others = list.ok ? (list.data.result || []).map((s) => s.id).filter((n) => n && n !== cfg.script) : null;
  if (!others || others.length > STOP_MAX_NEIGHBOURS) {
    plan.shared = "unknown";
    return plan;
  }
  const checks = await Promise.all(
    others.map(async (name) => {
      const st = await cfFetch(cfg.token, `${base}/${name}/settings`);
      if (!st.ok) return { name, unknown: true };
      const uses = ((st.data.result && st.data.result.bindings) || []).some((b) => b.type === "d1" && b.id === plan.dbId);
      return { name, uses };
    })
  );
  plan.neighbours = checks.filter((c) => c.uses).map((c) => c.name);
  plan.shared = checks.some((c) => c.unknown) ? "unknown" : plan.neighbours.length ? "yes" : "no";
  return plan;
}

function planSignature(plan) {
  return [plan.mode, plan.script || "", plan.dbId || "", plan.shared, plan.neighbours.join(",")].join("|");
}

const STOP_MANUAL =
  "<b>این‌ها را فقط خودتان می‌توانید انجام دهید:</b>\n" +
  "1️⃣ BotFather: دستور <code>/deletebot</code> (ربات و توکنش را کامل پاک می‌کند)\n" +
  "2️⃣ TMDB: کلید API را از تنظیمات حساب حذف کنید\n" +
  "3️⃣ Cloudflare: توکن API را باطل کنید (اگر بروزرسانی از داخل تلگرام را روشن کرده بودید)\n" +
  "4️⃣ کانال: ربات را از ادمین‌ها بردارید";

function stopSummary(plan) {
  const lines = ["• وب‌هوک تلگرام و منوی دستورها پاک می‌شود؛ ربات دیگر به هیچ پیامی جواب نمی‌دهد."];
  if (plan.mode === "full") {
    const dbLabel = plan.dbName ? `<code>${escapeHtml(plan.dbName)}</code>` : "ربات";
    if (plan.shared === "no") {
      lines.push(`• دیتابیس ${dbLabel} با همهٔ داده‌هایش (توکن‌ها، کانال‌ها، سشن‌ها) حذف می‌شود.`);
    } else if (plan.shared === "yes") {
      lines.push(
        `• ⚠️ دیتابیس ${dbLabel} حذف <b>نمی‌شود</b> چون Worker دیگری هم از آن استفاده می‌کند (${plan.neighbours
          .map((n) => escapeHtml(n))
          .join("، ")}). داده‌هایش، از جمله توکن ربات و کلید TMDB به‌صورت متن ساده، همان‌جا می‌ماند.`
      );
      lines.push("• ⚠️ آن Worker همین توکن ربات را از همان دیتابیس می‌خواند؛ پس با پاک شدن وب‌هوک، ربات او هم دیگر پیام نمی‌گیرد.");
    } else {
      lines.push(
        `• ⚠️ دیتابیس ${dbLabel} حذف <b>نمی‌شود</b> چون نتوانستم مطمئن شوم Worker دیگری از آن استفاده نمی‌کند. داده‌هایش، از جمله توکن ربات و کلید TMDB به‌صورت متن ساده، همان‌جا می‌ماند.`
      );
    }
    lines.push(`• خود Worker <code>${escapeHtml(plan.script)}</code> از Cloudflare حذف می‌شود.`);
  } else {
    lines.push(
      "• همهٔ داده‌های ربات در دیتابیس (توکن ربات، کلید TMDB، کانال‌ها، سشن‌ها) پاک می‌شود. ⚠️ اگر Worker دیگری هم از همین دیتابیس استفاده کند، داده‌های آن هم پاک می‌شود."
    );
    lines.push(
      plan.cfFailed
        ? "• توکن Cloudflare ذخیره‌شده کار نکرد، پس خود Worker و دیتابیس خالی را باید در داشبورد Cloudflare پاک کنید."
        : "• بروزرسانی از داخل تلگرام روشن نیست، پس خود Worker و دیتابیس خالی را باید در داشبورد Cloudflare پاک کنید."
    );
  }
  return lines.join("\n");
}

async function showStopAsk(env, chatId, messageId, knownPlan, changed) {
  const show = responder(env, chatId, messageId);
  const plan = knownPlan || (await planRemoval(env));
  const code = generateRandomToken(8);
  const saved =
    (await setSetting(env, "STOP_CODE", code)) &&
    (await setSetting(env, "STOP_EXP", String(Date.now() + STOP_CODE_TTL_MS))) &&
    (await setSetting(env, "STOP_PLAN", planSignature(plan)));
  if (!saved) {
    return show("⚠️ ذخیرهٔ وضعیت در دیتابیس ناموفق بود؛ دوباره امتحان کنید.", { inline_keyboard: [BACK_BUTTON] });
  }
  const text =
    "🛑 <b>توقف و حذف ربات</b>\n\n" +
    (changed ? "ℹ️ وضعیت از دفعهٔ قبل تغییر کرده؛ لطفاً دوباره بخوانید و تأیید کنید.\n\n" : "") +
    "<b>با تأیید شما این کارها انجام می‌شود:</b>\n" +
    stopSummary(plan) +
    "\n\n" +
    STOP_MANUAL +
    "\n\n⚠️ <b>این کار برگشت‌پذیر نیست.</b> این تأیید ۱۰ دقیقه اعتبار دارد.";
  return show(text, {
    inline_keyboard: [
      [{ text: "🗑 بله، متوقف و حذف کن", callback_data: `stop_go_${code}`, style: "danger" }],
      [{ text: "❌ انصراف", callback_data: "back_to_start", style: "primary" }],
    ],
  });
}

async function wipeOwnTables(env) {
  if (!env.DB) return false;
  try {
    await env.DB.batch(OWN_TABLES.map((t) => env.DB.prepare(`DROP TABLE IF EXISTS ${t}`)));
    return true;
  } catch (e) {
    console.error("wipeOwnTables failed:", e);
    return false;
  }
}

async function performStop(env, chatId, messageId, code) {
  const show = responder(env, chatId, messageId);

  const storedCode = await getSetting(env, "STOP_CODE");
  const exp = Number(await getSetting(env, "STOP_EXP")) || 0;
  const storedPlan = await getSetting(env, "STOP_PLAN");
  const matches = !!storedCode && (await safeEqual(code, storedCode));
  if (!matches || Date.now() > exp) {
    return show("⌛️ این تأیید منقضی شده یا قبلاً استفاده شده است.", {
      inline_keyboard: [[{ text: "🛑 دوباره", callback_data: "stop_ask", style: "danger" }], BACK_BUTTON],
    });
  }
  // single use: burn it before doing anything
  await setSetting(env, "STOP_CODE", "");
  await setSetting(env, "STOP_EXP", "0");

  // The owner confirmed one specific plan; if what would be touched changed, ask again.
  const plan = await planRemoval(env);
  if (planSignature(plan) !== storedPlan) return showStopAsk(env, chatId, messageId, plan, true);

  const botToken = await getSetting(env, "BOT_TOKEN");
  const cfg = await getUpdateConfig(env);

  // Keep the cron from putting the webhook back. Not written when the database may
  // be shared: a flag there would also stop the other Worker.
  if (plan.mode === "data" || plan.shared === "no") await setSetting(env, "STOPPED", "1");
  await show("⏳ <b>در حال توقف و حذف…</b>\nاین پیام چند ثانیه دیگر به‌روز می‌شود.", { inline_keyboard: [] });

  const lines = [];
  if (botToken) {
    const hook = await tgRaw(botToken, "deleteWebhook", { drop_pending_updates: true });
    await tgRaw(botToken, "deleteMyCommands", {});
    lines.push(
      hook.ok
        ? "✅ وب‌هوک تلگرام و منوی دستورها پاک شد."
        : "⚠️ تلگرام حذف وب‌هوک را نپذیرفت (شاید توکن قبلاً باطل شده). با BotFather ربات را پاک کنید."
    );
  } else {
    lines.push("ℹ️ توکن ربات در دیتابیس نبود، پس وب‌هوکی برای پاک کردن پیدا نشد.");
  }

  let deleteWorker = false;
  if (plan.mode === "full" && cfg) {
    if (plan.shared === "no" && plan.dbId) {
      const del = await cfFetch(cfg.token, `/accounts/${cfg.accountId}/d1/database/${plan.dbId}`, { method: "DELETE" });
      if (del.ok) {
        lines.push("✅ دیتابیس حذف شد.");
      } else {
        const wiped = await wipeOwnTables(env);
        lines.push(
          wiped
            ? `⚠️ حذف دیتابیس ناموفق بود (${escapeHtml(cfErrorText(del))}) ولی داده‌هایش پاک شد. دیتابیس خالی را در داشبورد Cloudflare حذف کنید.`
            : `⚠️ نه حذف دیتابیس (${escapeHtml(cfErrorText(del))}) و نه پاک کردن داده‌ها انجام شد. حتماً توکن ربات را با BotFather باطل کنید.`
        );
      }
    } else if (plan.shared === "yes") {
      lines.push(`ℹ️ دیتابیس دست‌نخورده ماند چون Worker دیگری (${plan.neighbours.map((n) => escapeHtml(n)).join("، ")}) هم از آن استفاده می‌کند.`);
    } else {
      lines.push("ℹ️ دیتابیس دست‌نخورده ماند چون نتوانستم مطمئن شوم Worker دیگری از آن استفاده نمی‌کند.");
    }
    deleteWorker = true;
  } else {
    const wiped = await wipeOwnTables(env);
    lines.push(wiped ? "✅ همهٔ داده‌های ربات پاک شد." : "⚠️ پاک کردن داده‌ها ناموفق بود. توکن ربات را با BotFather باطل کنید.");
  }

  const tail = deleteWorker
    ? "⏳ حذف Worker شروع شد و تا چند ثانیه دیگر کامل می‌شود. اگر بعد از یک دقیقه آدرسش هنوز باز می‌شود، در داشبورد Cloudflare پاکش کنید."
    : "ℹ️ خود Worker و دیتابیس خالی در Cloudflare مانده‌اند؛ آن‌ها را از داشبورد Cloudflare حذف کنید.";
  const finalText = `🛑 <b>ربات متوقف شد.</b>\n\n${lines.join("\n")}\n${tail}\n\n${STOP_MANUAL}`;

  // The data (and with it the stored token) may already be gone, so talk to Telegram
  // with the token read above instead of through the database.
  const say = async (text) => {
    if (!botToken) return;
    const base = { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true };
    const edited = messageId ? await tgRaw(botToken, "editMessageText", { ...base, message_id: messageId }) : { ok: false };
    if (!edited.ok) await tgRaw(botToken, "sendMessage", base);
  };
  await say(finalText);

  if (deleteWorker) {
    const res = await cfFetch(cfg.token, `/accounts/${cfg.accountId}/workers/scripts/${cfg.script}`, { method: "DELETE" });
    if (!res.ok) {
      await say(
        `⚠️ <b>حذف Worker ناموفق بود:</b> ${escapeHtml(cfErrorText(res))}\nدر داشبورد Cloudflare، Worker «${escapeHtml(cfg.script)}» را دستی حذف کنید.\n\n${STOP_MANUAL}`
      );
    }
  }
}

async function storeUpdateToken(auth) {
  const { cfToken, accountId, script } = auth;
  const base = `/accounts/${accountId}/workers/scripts/${script}/settings`;
  const current = await cfFetch(cfToken, base);
  if (!current.ok) {
    return { error: fail(502, "خواندن تنظیمات Worker ناموفق بود.", `Reading the Worker settings failed. (${cfErrorText(current)})`, "settings_read_failed") };
  }
  const keep = ((current.data.result && current.data.result.bindings) || [])
    .filter((b) => b.name !== "CF_API_TOKEN")
    .map((b) => ({ name: b.name, type: "inherit" }));
  const settings = { bindings: [...keep, { name: "CF_API_TOKEN", type: "secret_text", text: cfToken }] };
  const form = new FormData();
  form.append("settings", new Blob([JSON.stringify(settings)], { type: "application/json" }));
  const patched = await cfFetch(cfToken, base, { method: "PATCH", body: form });
  if (!patched.ok) {
    return { error: fail(502, `ذخیرهٔ توکن بروزرسانی ناموفق بود. (${cfErrorText(patched)})`, `Storing the update token failed. (${cfErrorText(patched)})`, "update_token_failed") };
  }
  return { ok: true };
}

async function handleSetupApi(request, env, url) {
  const step = url.pathname.slice("/api/setup/".length);

  // Public, read-only: lets the wizard decide which banner and steps to show.
  if (step === "status" && request.method === "GET") {
    const host = parseWorkersDevHost(url.hostname);
    return jsonResponse({
      ok: true,
      configured: await isConfigured(env),
      hasDb: !!env.DB,
      hasKey: !!(env.SETUP_KEY && String(env.SETUP_KEY).length >= 24),
      canUseToken: true,
      script: host ? host.script : null,
      installer: installerEnabled(env),
      version: APP_VERSION,
      build: BUILD_ID,
    });
  }

  if (request.method !== "POST") {
    return fail(405, "متد مجاز نیست.", "Method not allowed.", "bad_method");
  }
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    return fail(403, "درخواست از مبدأ نامعتبر.", "Cross-origin request refused.", "bad_origin");
  }
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
    return fail(415, "نوع درخواست نامعتبر است.", "Expected application/json.", "bad_type");
  }
  if (Number(request.headers.get("Content-Length") || 0) > MAX_SETUP_BODY) {
    return fail(413, "درخواست بیش از حد بزرگ است.", "Request too large.", "too_large");
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return fail(400, "بدنهٔ درخواست نامعتبر است.", "Invalid JSON body.", "bad_json");
  }
  if (!body || typeof body !== "object") {
    return fail(400, "بدنهٔ درخواست نامعتبر است.", "Invalid JSON body.", "bad_json");
  }

  const auth = await authorizeSetup(env, body, url);
  if (auth.error) return auth.error;

  if (step === "key/verify" || step === "cloudflare/verify") {
    return jsonResponse({ ok: true, via: auth.via, script: auth.script || null });
  }

  if (step === "telegram/verify") {
    const token = String(body.botToken || "").trim();
    if (!BOT_TOKEN_RE.test(token)) {
      return fail(400, "قالب توکن ربات معتبر نیست.", "Bot token format is invalid.", "bad_bot_token");
    }
    const me = await telegramGetMe(token);
    if (!me.ok) {
      return fail(400, "تلگرام این توکن را نپذیرفت.", "Telegram rejected this token.", "bot_rejected");
    }
    return jsonResponse({ ok: true, username: me.result.username });
  }

  if (step === "tmdb/verify") {
    const key = String(body.tmdbKey || "").trim();
    if (!TMDB_KEY_RE.test(key)) {
      return fail(400, "قالب کلید TMDB معتبر نیست (۳۲ کاراکتر هگز).", "TMDB key format is invalid (32 hex chars).", "bad_tmdb_key");
    }
    let data = null;
    try {
      const res = await fetch(`https://api.themoviedb.org/3/authentication?api_key=${key}`);
      data = await res.json();
    } catch (e) {
      return fail(502, "ارتباط با TMDB برقرار نشد.", "Could not reach TMDB.", "tmdb_unreachable");
    }
    if (!data || !data.success) {
      return fail(400, "TMDB این کلید را نپذیرفت.", "TMDB rejected this key.", "tmdb_rejected");
    }
    return jsonResponse({ ok: true });
  }

  if (step === "install/database") {
    if (env.DB) return jsonResponse({ ok: true, skipped: true });
    if (auth.via !== "cloudflare") {
      return fail(
        409,
        "دیتابیس D1 به این Worker وصل نیست. با توکن Cloudflare وارد شوید تا ویزارد آن را بسازد.",
        "No D1 database is bound. Sign in with a Cloudflare token so the wizard can create one.",
        "need_cf_token"
      );
    }
    return createAndBindDatabase(auth);
  }

  if (step === "install/save") {
    const botToken = String(body.botToken || "").trim();
    const tmdbKey = String(body.tmdbKey || "").trim();
    if (!BOT_TOKEN_RE.test(botToken)) {
      return fail(400, "قالب توکن ربات معتبر نیست.", "Bot token format is invalid.", "bad_bot_token");
    }
    if (!TMDB_KEY_RE.test(tmdbKey)) {
      return fail(400, "قالب کلید TMDB معتبر نیست.", "TMDB key format is invalid.", "bad_tmdb_key");
    }
    if (!env.DB) {
      return fail(500, "دیتابیس D1 با نام DB به این Worker متصل نیست.", "No D1 database is bound as DB on this Worker.", "no_db");
    }
    if (!(await ensureSchema(env))) {
      return fail(500, "ساخت جدول‌ها در D1 ناموفق بود.", "Creating the D1 tables failed.", "schema_failed");
    }
    const saved =
      (await setSetting(env, "BOT_TOKEN", botToken)) &&
      (await setSetting(env, "TMDB_KEY", tmdbKey)) &&
      (await setSetting(env, "WORKER_ORIGIN", url.origin)) &&
      (auth.via === "cloudflare"
        ? (await setSetting(env, "CF_ACCOUNT_ID", auth.accountId)) && (await setSetting(env, "CF_SCRIPT_NAME", auth.script))
        : true);
    if (!saved) {
      return fail(500, "ذخیرهٔ تنظیمات در D1 ناموفق بود.", "Saving the settings to D1 failed.", "save_failed");
    }
    let secret = await getSetting(env, "WEBHOOK_SECRET");
    if (!secret) {
      secret = generateRandomToken(32);
      if (!(await setSetting(env, "WEBHOOK_SECRET", secret))) {
        return fail(500, "ذخیرهٔ تنظیمات در D1 ناموفق بود.", "Saving the settings to D1 failed.", "save_failed");
      }
    }
    return jsonResponse({ ok: true });
  }

  // Optional: lets the owner update from inside Telegram. The token is stored as a
  // Worker secret (never in D1), so it cannot be read back through the database.
  if (step === "install/updates") {
    if (auth.via !== "cloudflare") {
      return fail(409, "برای فعال کردن بروزرسانی از داخل ربات، با توکن Cloudflare وارد شوید.", "Sign in with a Cloudflare token to enable in-bot updates.", "need_cf_token");
    }
    if (!env.DB) {
      return fail(409, "ابتدا دیتابیس باید وصل شود.", "Bind the database first.", "no_db");
    }
    // Which account/script to update. Stored before the token so a failure below
    // leaves nothing usable behind (no token means no update).
    const recorded =
      (await setSetting(env, "CF_ACCOUNT_ID", auth.accountId)) && (await setSetting(env, "CF_SCRIPT_NAME", auth.script));
    if (!recorded) {
      return fail(500, "ذخیرهٔ تنظیمات در D1 ناموفق بود.", "Saving the settings to D1 failed.", "save_failed");
    }
    const patched = await storeUpdateToken(auth);
    if (patched.error) return patched.error;
    return jsonResponse({ ok: true });
  }

  if (step === "install/owner") {
    if (!env.DB) return fail(409, "ابتدا مرحلهٔ ذخیره باید انجام شود.", "Run the save step first.", "not_saved");
    const me = await telegramGetMe(await getSetting(env, "BOT_TOKEN"));
    if (!me.ok) return fail(502, "تلگرام توکن ذخیره‌شده را نپذیرفت.", "Telegram rejected the stored token.", "bot_rejected");
    const code = generateRandomToken(16);
    await setSetting(env, "OWNER_CLAIM_HASH", toHex(await sha256(code)));
    await setSetting(env, "OWNER_CLAIM_EXP", String(Date.now() + CLAIM_TTL_MS));
    return jsonResponse({
      ok: true,
      botUsername: me.result.username,
      claimUrl: `https://t.me/${me.result.username}?start=own_${code}`,
    });
  }

  if (step === "install/webhook") {
    const token = await getSetting(env, "BOT_TOKEN");
    const secret = await getSetting(env, "WEBHOOK_SECRET");
    if (!token || !secret) {
      return fail(409, "ابتدا مرحلهٔ ذخیره باید انجام شود.", "Run the save step first.", "not_saved");
    }
    const me = await telegramGetMe(token);
    if (!me.ok) {
      return fail(502, "تلگرام توکن ذخیره‌شده را نپذیرفت.", "Telegram rejected the stored token.", "bot_rejected");
    }
    const webhookUrl = `${url.origin}/webhook`;
    const hook = await tgCall(env, "setWebhook", {
      url: webhookUrl,
      allowed_updates: ["message", "callback_query"],
      secret_token: secret,
    });
    if (!hook.ok) {
      return fail(502, "ثبت وب‌هوک در تلگرام ناموفق بود.", "Telegram refused to register the webhook.", "webhook_failed");
    }
    return jsonResponse({ ok: true, webhookUrl, botUsername: me.result.username });
  }

  if (step === "install/commands") {
    const res = await tgCall(env, "setMyCommands", {
      commands: [
        { command: "start", description: "🎬 شروع و جستجوی فیلم یا سریال" },
        { command: "setchannel", description: "⚙️ تنظیم یا تغییر کانال خروجی" },
        { command: "help", description: "📖 راهنمای کاربری" },
        { command: "cancel", description: "❌ لغو عملیات فعلی" },
      ],
    });
    if (!res.ok) {
      return fail(502, "ثبت دستورات ربات ناموفق بود.", "Registering the bot commands failed.", "commands_failed");
    }
    return jsonResponse({ ok: true });
  }

  // Optional: a Worker pasted into the dashboard has no cron yet. Not fatal.
  if (step === "install/schedule") {
    if (auth.via !== "cloudflare") return jsonResponse({ ok: true, skipped: true });
    const res = await cfFetch(auth.cfToken, `/accounts/${auth.accountId}/workers/scripts/${auth.script}/schedules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ cron: CRON_EXPRESSION }]),
    });
    if (!res.ok) {
      return jsonResponse({ ok: true, warning: `cron: ${cfErrorText(res)}` });
    }
    return jsonResponse({ ok: true });
  }

  return fail(404, "مسیر پیدا نشد.", "Unknown setup step.", "not_found");
}

// ─── Hosted installer (public instance only: deploy with PUBLIC_INSTALLER=true) ─
// A visitor pastes a Cloudflare API token and this Worker deploys a copy of the
// bot into THEIR account. The token is used for the calls below and never stored.
// The bot token and TMDB key are NOT handled here: the visitor enters them on
// their own Worker afterwards.
const RELEASE_URL = "https://github.com/ArizoOwner/Arizo_Movie/releases/latest/download/worker.js";
const MAX_RELEASE_BYTES = 1_500_000;
const WORKER_NAME_RE = /^[a-z0-9][a-z0-9-]{0,53}$/;
const SUBDOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const ACCOUNT_ID_RE = /^[a-f0-9]{32}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function installerEnabled(env) {
  return String(env.PUBLIC_INSTALLER || "") === "true";
}

// The wizard is a single page: inline script/style plus Google Fonts. On the
// public instance it may also poll a freshly deployed Worker's /health.
function wizardCsp(env) {
  const connect = installerEnabled(env) ? "'self' https://*.workers.dev" : "'self'";
  return (
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; " +
    `font-src https://fonts.gstatic.com; connect-src ${connect}; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  );
}

async function getOrCreateDatabase(cfToken, accountId, dbName) {
  const found = await cfFetch(cfToken, `/accounts/${accountId}/d1/database?name=${encodeURIComponent(dbName)}`);
  if (found.ok) {
    const hit = (found.data.result || []).find((d) => d.name === dbName);
    if (hit) return { dbId: hit.uuid };
  }
  const created = await cfFetch(cfToken, `/accounts/${accountId}/d1/database`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: dbName }),
  });
  if (!created.ok) {
    return {
      error: fail(
        502,
        `ساخت دیتابیس D1 ناموفق بود. دسترسی «D1: Edit» را بررسی کنید. (${cfErrorText(created)})`,
        `Creating the D1 database failed. Check the D1: Edit permission. (${cfErrorText(created)})`,
        "d1_create_failed"
      ),
    };
  }
  return { dbId: created.data.result.uuid };
}

async function readJsonRequest(request, url) {
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) {
    return { error: fail(403, "درخواست از مبدأ نامعتبر.", "Cross-origin request refused.", "bad_origin") };
  }
  if (!(request.headers.get("Content-Type") || "").includes("application/json")) {
    return { error: fail(415, "نوع درخواست نامعتبر است.", "Expected application/json.", "bad_type") };
  }
  if (Number(request.headers.get("Content-Length") || 0) > MAX_SETUP_BODY) {
    return { error: fail(413, "درخواست بیش از حد بزرگ است.", "Request too large.", "too_large") };
  }
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return { error: fail(400, "بدنهٔ درخواست نامعتبر است.", "Invalid JSON body.", "bad_json") };
  }
  if (!body || typeof body !== "object") {
    return { error: fail(400, "بدنهٔ درخواست نامعتبر است.", "Invalid JSON body.", "bad_json") };
  }
  return { body };
}

// Only ever fetches the fixed release URL above, so a caller cannot make this
// Worker request anything else.
async function fetchReleaseSource() {
  let res;
  try {
    res = await fetch(RELEASE_URL, { redirect: "follow", cf: { cacheTtl: 300, cacheEverything: true } });
  } catch (e) {
    return { error: fail(502, "دانلود فایل ربات از GitHub ناموفق بود.", "Downloading the bot file from GitHub failed.", "release_unreachable") };
  }
  if (!res.ok) {
    return {
      error: fail(
        502,
        `فایل ریلیز ربات پیدا نشد (HTTP ${res.status}).`,
        `The bot release file was not found (HTTP ${res.status}).`,
        "release_missing"
      ),
    };
  }
  const declared = Number(res.headers.get("Content-Length") || 0);
  const text = declared > MAX_RELEASE_BYTES ? "" : await res.text();
  if (!text || text.length > MAX_RELEASE_BYTES || !text.includes("export default") || !text.includes("Arizo_Movie")) {
    return { error: fail(502, "فایل ریلیز معتبر نیست.", "The release file is not valid.", "release_invalid") };
  }
  return { text };
}

async function handleInstallerApi(request, env, url) {
  if (!installerEnabled(env)) {
    return fail(404, "نصب‌کنندهٔ همگانی روی این Worker فعال نیست.", "The hosted installer is not enabled on this Worker.", "installer_off");
  }
  if (request.method !== "POST") {
    return fail(405, "متد مجاز نیست.", "Method not allowed.", "bad_method");
  }
  const parsed = await readJsonRequest(request, url);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const cfToken = typeof body.cfToken === "string" ? body.cfToken.trim() : "";
  if (!cfToken || cfToken.length > 200) {
    return fail(401, "توکن Cloudflare لازم است.", "A Cloudflare token is required.", "no_credentials");
  }
  const step = url.pathname.slice("/api/installer/".length);

  if (step === "verify") {
    const accounts = await cfFetch(cfToken, "/accounts?per_page=50");
    if (!accounts.ok) {
      return fail(
        401,
        "توکن Cloudflare معتبر نیست یا دسترسی «Account Settings: Read» ندارد.",
        "The Cloudflare token is invalid or lacks Account Settings: Read.",
        "bad_cf_token"
      );
    }
    const list = [];
    for (const acc of (accounts.data.result || []).slice(0, 8)) {
      const [sub, scripts, d1] = await Promise.all([
        cfFetch(cfToken, `/accounts/${acc.id}/workers/subdomain`),
        cfFetch(cfToken, `/accounts/${acc.id}/workers/scripts`),
        cfFetch(cfToken, `/accounts/${acc.id}/d1/database?per_page=1`),
      ]);
      list.push({
        id: acc.id,
        name: acc.name,
        subdomain: sub.ok && sub.data.result ? sub.data.result.subdomain || null : null,
        canWorkers: scripts.ok,
        canD1: d1.ok,
      });
    }
    return jsonResponse({ ok: true, accounts: list });
  }

  const accountId = String(body.accountId || "");
  if (!ACCOUNT_ID_RE.test(accountId)) {
    return fail(400, "شناسهٔ اکانت نامعتبر است.", "Invalid account id.", "bad_account");
  }

  if (step === "subdomain") {
    const subdomain = String(body.subdomain || "").trim().toLowerCase();
    if (!SUBDOMAIN_RE.test(subdomain)) {
      return fail(400, "نام زیردامنه نامعتبر است (حروف کوچک، عدد و خط تیره).", "Invalid subdomain (lowercase letters, digits and dashes).", "bad_subdomain");
    }
    const res = await cfFetch(cfToken, `/accounts/${accountId}/workers/subdomain`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subdomain }),
    });
    if (!res.ok) {
      return fail(409, `ثبت زیردامنه ناموفق بود: ${cfErrorText(res)}`, `Registering the subdomain failed: ${cfErrorText(res)}`, "subdomain_failed");
    }
    return jsonResponse({ ok: true, subdomain });
  }

  const workerName = String(body.workerName || "").trim().toLowerCase();
  if (!WORKER_NAME_RE.test(workerName)) {
    return fail(400, "نام Worker نامعتبر است (حروف کوچک، عدد و خط تیره).", "Invalid Worker name (lowercase letters, digits and dashes).", "bad_worker_name");
  }

  if (step === "resources") {
    const db = await getOrCreateDatabase(cfToken, accountId, `${workerName}-db`.slice(0, 60));
    if (db.error) return db.error;
    const existing = await cfFetch(cfToken, `/accounts/${accountId}/workers/scripts/${workerName}/settings`);
    return jsonResponse({ ok: true, dbId: db.dbId, workerExists: existing.ok });
  }

  if (step === "deploy") {
    const dbId = String(body.dbId || "");
    if (!UUID_RE.test(dbId)) {
      return fail(400, "شناسهٔ دیتابیس نامعتبر است.", "Invalid database id.", "bad_db");
    }
    const source = await fetchReleaseSource();
    if (source.error) return source.error;

    // A random key the visitor receives once, to continue on their own Worker.
    const setupKey = generateRandomToken(24);
    const metadata = {
      main_module: "worker.js",
      compatibility_date: "2024-04-01",
      bindings: [
        { type: "d1", name: "DB", id: dbId },
        { type: "secret_text", name: "SETUP_KEY", text: setupKey },
        { type: "plain_text", name: "PROJECT_NAME", text: "Arizo_Movie" },
      ],
    };
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    form.append("worker.js", new Blob([source.text], { type: "application/javascript+module" }), "worker.js");

    const upload = await cfFetch(cfToken, `/accounts/${accountId}/workers/scripts/${workerName}`, {
      method: "PUT",
      body: form,
    });
    if (!upload.ok) {
      return fail(
        502,
        `آپلود Worker ناموفق بود. دسترسی «Workers Scripts: Edit» را بررسی کنید. (${cfErrorText(upload)})`,
        `Uploading the Worker failed. Check the Workers Scripts: Edit permission. (${cfErrorText(upload)})`,
        "upload_failed"
      );
    }
    const enable = await cfFetch(cfToken, `/accounts/${accountId}/workers/scripts/${workerName}/subdomain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });
    if (!enable.ok) {
      return fail(
        502,
        `فعال‌سازی آدرس workers.dev ناموفق بود. (${cfErrorText(enable)})`,
        `Enabling the workers.dev address failed. (${cfErrorText(enable)})`,
        "enable_failed"
      );
    }
    const cron = await cfFetch(cfToken, `/accounts/${accountId}/workers/scripts/${workerName}/schedules`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ cron: CRON_EXPRESSION }]),
    });
    const sub = await cfFetch(cfToken, `/accounts/${accountId}/workers/subdomain`);
    const subdomain = sub.ok && sub.data.result ? sub.data.result.subdomain : null;
    if (!subdomain) {
      return fail(409, "برای این اکانت زیردامنهٔ workers.dev ثبت نشده است.", "This account has no workers.dev subdomain yet.", "no_subdomain");
    }
    return jsonResponse({
      ok: true,
      url: `https://${workerName}.${subdomain}.workers.dev`,
      setupKey,
      cronWarning: cron.ok ? null : cfErrorText(cron),
    });
  }

  return fail(404, "مسیر پیدا نشد.", "Unknown installer step.", "not_found");
}

// ─── Entry point (fetch & scheduled) ──────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const isRead = request.method === "GET" || request.method === "HEAD";

    if (url.pathname === "/health") {
      const res = jsonResponse({ status: "ok", worker: "Arizo_Movie" });
      res.headers.set("Access-Control-Allow-Origin", "*");
      return res;
    }

    if (url.pathname === "/setup" && isRead) {
      return new Response(request.method === "HEAD" ? null : WIZARD_HTML, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy": wizardCsp(env),
          ...SECURITY_HEADERS,
        },
      });
    }

    if (url.pathname.startsWith("/api/installer/")) {
      try {
        return await handleInstallerApi(request, env, url);
      } catch (e) {
        console.error("installer api crashed:", e);
        return fail(500, "خطای داخلی سرور.", "Internal error.", "internal");
      }
    }

    if (url.pathname.startsWith("/api/setup/")) {
      try {
        return await handleSetupApi(request, env, url);
      } catch (e) {
        console.error("setup api crashed:", e);
        return fail(500, "خطای داخلی سرور.", "Internal error.", "internal");
      }
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      const expectedSecret = await getSetting(env, "WEBHOOK_SECRET");
      if (!expectedSecret) {
        return new Response("Not configured", { status: 503 });
      }
      const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
      if (!timingSafeEqual(providedSecret, expectedSecret)) {
        return new Response("Unauthorized", { status: 401 });
      }

      let update;
      try {
        update = await request.json();
      } catch (e) {
        return new Response("Bad Request", { status: 400 });
      }

      // Answer Telegram immediately; process the update in the background.
      ctx.waitUntil(
        handleUpdate(env, update).catch((err) => {
          console.error("handleUpdate unhandled error:", err);
        })
      );
      return new Response("OK", { status: 200 });
    }

    // Anything else a browser opens lands on the wizard, so a freshly deployed
    // Worker always shows setup first.
    if (isRead) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/setup", "Cache-Control": "no-store", ...SECURITY_HEADERS },
      });
    }

    return new Response("Not Found", { status: 404 });
  },

  // Cron: if Telegram lost the webhook, register it again.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          if ((await getSetting(env, "STOPPED")) === "1") return;
          const token = await getSetting(env, "BOT_TOKEN");
          const secret = await getSetting(env, "WEBHOOK_SECRET");
          const origin = await getSetting(env, "WORKER_ORIGIN");
          if (!token || !secret || !origin) return;
          await announcePendingUpdate(env);

          const expectedUrl = `${origin}/webhook`;
          const info = await tgCall(env, "getWebhookInfo", {});
          if (info.ok && info.result.url !== expectedUrl) {
            console.warn("Webhook missing or changed, registering it again");
            await tgCall(env, "setWebhook", {
              url: expectedUrl,
              allowed_updates: ["message", "callback_query"],
              secret_token: secret,
            });
          }
        } catch (e) {
          console.error("Cron webhook check failed:", e);
        }
      })()
    );
  },
};
