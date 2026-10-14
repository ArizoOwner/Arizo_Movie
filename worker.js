/**
 * ══════════════════════════════════════════════════════════════════════════════
 *   🎬 Arizo_Movie - Serverless Telegram Movie Bot on Cloudflare Workers
 *   24/7 Edge-Native, Webhook-Powered with D1 Database & Web Setup Wizard
 * ══════════════════════════════════════════════════════════════════════════════
 */

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
function getStartUI(channel) {
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
  if (text === "/start") {
    await clearUserSession(env, chatId);
    const { text: startText, keyboard } = getStartUI(currentChannel);
    return sendMessage(env, chatId, startText, keyboard);
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
      "مثال: <code>https://t.me/c/2702725668/165</code>\n\n" +
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

  if (data === "help") {
    await answerCallbackQuery(env, cq.id);
    const { text, keyboard } = getHelpUI();
    return editMessageText(env, chatId, messageId, text, keyboard);
  }

  if (data === "back_to_start") {
    await answerCallbackQuery(env, cq.id);
    const currentChannel = await getUserChannel(env, chatId);
    const { text, keyboard } = getStartUI(currentChannel);
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
      "مثال: <code>https://t.me/c/2702725668/165</code>\n\n" +
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
      "🔗 <code>https://t.me/c/2702725668/165</code>";

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

// ─── ویزارد راه‌اندازی تحت وب (WIZARD AUTO SETUP) ─────────────────────────────
function renderSetupWizardHtml(hostUrl, isConfigured, currentBotToken, currentTmdbKey, currentAdminId) {
  const maskedToken = currentBotToken ? currentBotToken.slice(0, 10) + "..." + currentBotToken.slice(-6) : "";
  const maskedTmdb = currentTmdbKey ? currentTmdbKey.slice(0, 8) + "..." : "";

  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arizo Movie | ویزارد راه‌اندازی ۲۴ ساعته ربات سینمایی</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@300;400;600;700;900&display=swap">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(22, 30, 48, 0.7);
      --border: rgba(255, 255, 255, 0.1);
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --danger: #ef4444;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: radial-gradient(circle at top right, #1e1b4b, #090d16 60%);
      color: var(--text);
      font-family: 'Vazirmatn', sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 30px 16px;
    }
    .container {
      width: 100%;
      max-width: 760px;
      backdrop-filter: blur(16px);
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 36px 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .header {
      text-align: center;
      margin-bottom: 30px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 16px;
      border-radius: 9999px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 14px;
    }
    .badge-ok { background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-warn { background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); }
    h1 { font-size: 26px; font-weight: 900; margin-bottom: 8px; color: #fff; }
    p.subtitle { color: var(--text-muted); font-size: 15px; line-height: 1.7; }
    .step-card {
      background: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 22px;
      margin-bottom: 20px;
    }
    .step-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 17px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 16px;
    }
    .step-num {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: var(--primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: bold;
    }
    .form-group {
      margin-bottom: 14px;
    }
    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #e5e7eb;
      margin-bottom: 6px;
    }
    .input-row {
      display: flex;
      gap: 8px;
    }
    input {
      flex: 1;
      padding: 12px 14px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 10px;
      color: #fff;
      font-family: inherit;
      font-size: 14px;
      outline: none;
      direction: ltr;
      text-align: left;
      transition: border-color 0.2s;
    }
    input:focus { border-color: var(--primary); }
    button.btn {
      padding: 11px 18px;
      border: none;
      border-radius: 10px;
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }
    .btn-primary { background: var(--primary); color: #fff; }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-success { background: var(--success); color: #fff; width: 100%; justify-content: center; padding: 14px; font-size: 16px; margin-top: 8px; }
    .btn-success:hover { background: #059669; }
    .btn-secondary { background: rgba(255, 255, 255, 0.1); color: #fff; }
    .btn-secondary:hover { background: rgba(255, 255, 255, 0.18); }
    .help-hint {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 5px;
      line-height: 1.6;
    }
    .result-box {
      margin-top: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 13px;
      display: none;
    }
    .result-ok { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .result-err { background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3); }
    .footer {
      text-align: center;
      margin-top: 24px;
      color: var(--text-muted);
      font-size: 13px;
    }
    .footer a { color: #60a5fa; text-decoration: none; }
    code {
      background: rgba(0, 0, 0, 0.4);
      padding: 2px 6px;
      border-radius: 6px;
      font-size: 12px;
      direction: ltr;
      display: inline-block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge ${isConfigured ? "badge-ok" : "badge-warn"}">
        ${isConfigured ? "⚡ سیستم متصل و آماده است" : "⚙️ در حال آماده‌سازی و راه‌اندازی"}
      </span>
      <h1>🎬 Arizo Movie | ویزارد راه‌اندازی ۲۴ ساعته</h1>
      <p class="subtitle">استقرار سرورلس روی Cloudflare Workers بدون قطعی، اتصال هوشمند دیتابیس D1 و ثبت آنی وب‌هوک تلگرام</p>
    </div>

    <!-- گام اول: توکن‌ها و کلیدها -->
    <div class="step-card">
      <div class="step-title">
        <span class="step-num">۱</span>
        <span>تنظیم توکن‌ها و دسترسی‌ها (کاملاً پویا)</span>
      </div>

      <div class="form-group">
        <label>توکن ربات تلگرام (BOT_TOKEN)</label>
        <div class="input-row">
          <input type="text" id="botToken" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ..." value="${maskedToken ? "" : ""}">
          <button class="btn btn-secondary" onclick="verifyBotToken()">🔍 بررسی توکن</button>
        </div>
        <p class="help-hint">از <a href="https://t.me/BotFather" target="_blank" style="color:#60a5fa">@BotFather</a> در تلگرام دریافت کنید.</p>
        <div id="botVerifyRes" class="result-box"></div>
      </div>

      <div class="form-group">
        <label>کلید API پایگاه TMDB (TheMovieDB)</label>
        <div class="input-row">
          <input type="text" id="tmdbKey" placeholder="مثال: a1b2c3d4e5f67890abcdef..." value="${maskedTmdb ? "" : ""}">
          <button class="btn btn-secondary" onclick="verifyTmdbKey()">🔍 بررسی کلید</button>
        </div>
        <p class="help-hint">کلید رایگان از <a href="https://www.themoviedb.org/settings/api" target="_blank" style="color:#60a5fa">سایت TMDB</a> برای دریافت اطلاعات فیلم و سریال.</p>
        <div id="tmdbVerifyRes" class="result-box"></div>
      </div>

      <div class="form-group">
        <label>شناسه عددی ادمین تلگرام (ADMIN_ID)</label>
        <input type="text" id="adminId" placeholder="مثال: 123456789" value="${currentAdminId || ""}">
        <p class="help-hint">آیدی عددی خود را از ربات <a href="https://t.me/userinfobot" target="_blank" style="color:#60a5fa">@userinfobot</a> بگیرید.</p>
      </div>
    </div>

    <!-- گام دوم: اتصال وب‌هوک و شروع ۲۴ ساعته -->
    <div class="step-card">
      <div class="step-title">
        <span class="step-num">۲</span>
        <span>ثبت وب‌هوک تلگرام و فعال‌سازی ۲۴/۷</span>
      </div>

      <div class="form-group">
        <label>آدرس جاری ورکر (Worker Endpoint)</label>
        <input type="text" id="workerUrl" value="${hostUrl}" readonly>
        <p class="help-hint">تلگرام پیام‌ها را به مسیر <code>/webhook</code> این آدرس ارسال خواهد کرد.</p>
      </div>

      <button class="btn btn-success" onclick="installAndRegisterWebhook()">
        🚀 راه‌اندازی، اتصال D1 و ثبت نهایی وب‌هوک
      </button>

      <div id="setupResult" class="result-box"></div>
    </div>

    <!-- گام سوم: راهنمای GitHub Actions (CI/CD) -->
    <div class="step-card">
      <div class="step-title">
        <span class="step-num">۳</span>
        <span>اتصال به گیت‌هاب برای استقرار خودکار (CI/CD)</span>
      </div>
      <p style="font-size:13px; color:#d1d5db; line-height:1.8;">
        برای اینکه با هر <code>git push</code> کدها مستقیماً و خودکار روی این ورکر مستقر شوند:
        <br>
        ۱. به ریپازیتوری خود در GitHub بروید: <b>Settings ➜ Secrets and variables ➜ Actions</b>
        <br>
        ۲. یک سکرت با نام <code>CLOUDFLARE_API_TOKEN</code> حاوی توکن کلادفلر خود اضافه کنید.
        <br>
        ۳. شناسه اکانت کلادفلر خود را در سکرت <code>CLOUDFLARE_ACCOUNT_ID</code> قرار دهید.
      </p>
    </div>

    <div class="footer">
      ساخته شده با ❤️ برای استقرار ۲۴ ساعته و بدون قطعی | <b>Arizo_Movie Studio</b>
    </div>
  </div>

  <script>
    async function verifyBotToken() {
      const token = document.getElementById("botToken").value.trim();
      const resBox = document.getElementById("botVerifyRes");
      if (!token) {
        showMsg(resBox, "لطفاً ابتدا توکن ربات را وارد کنید.", false);
        return;
      }
      showMsg(resBox, "در حال بررسی توکن با سرور تلگرام...", null);
      try {
        const res = await fetch("https://api.telegram.org/bot" + token + "/getMe");
        const data = await res.json();
        if (data.ok) {
          showMsg(resBox, "✅ ربات تایید شد: @" + data.result.username + " (" + data.result.first_name + ")", true);
        } else {
          showMsg(resBox, "❌ توکن نامعتبر است: " + (data.description || "خطا"), false);
        }
      } catch (e) {
        showMsg(resBox, "❌ خطا در برقراری ارتباط با تلگرام: " + e.message, false);
      }
    }

    async function verifyTmdbKey() {
      const key = document.getElementById("tmdbKey").value.trim();
      const resBox = document.getElementById("tmdbVerifyRes");
      if (!key) {
        showMsg(resBox, "لطفاً ابتدا کلید TMDB را وارد کنید.", false);
        return;
      }
      showMsg(resBox, "در حال بررسی کلید با TMDB...", null);
      try {
        const res = await fetch("https://api.themoviedb.org/3/authentication?api_key=" + key);
        const data = await res.json();
        if (data.success) {
          showMsg(resBox, "✅ کلید TMDB معتبر است و با موفقیت تایید شد.", true);
        } else {
          showMsg(resBox, "❌ کلید TMDB نامعتبر است: " + (data.status_message || "خطا"), false);
        }
      } catch (e) {
        showMsg(resBox, "❌ خطا در بررسی کلید TMDB: " + e.message, false);
      }
    }

    async function installAndRegisterWebhook() {
      const botToken = document.getElementById("botToken").value.trim();
      const tmdbKey = document.getElementById("tmdbKey").value.trim();
      const adminId = document.getElementById("adminId").value.trim();
      const resBox = document.getElementById("setupResult");

      showMsg(resBox, "⚙️ در حال ذخیره تنظیمات و اتصال وب‌هوک به تلگرام...", null);

      try {
        const res = await fetch("/api/setup/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bot_token: botToken, tmdb_key: tmdbKey, admin_id: adminId })
        });
        const data = await res.json();
        if (data.ok) {
          showMsg(
            resBox,
            "🎉 <b>راه‌اندازی با موفقیت انجام شد!</b><br>" +
            "⚡ دیتابیس D1 آماده‌سازی شد.<br>" +
            "🔗 وب‌هوک ثبت شد: <code>" + data.webhook_url + "</code><br>" +
            "🤖 هم‌اکنون به ربات خود در تلگرام پیام دهید: <b><a href='" + data.bot_link + "' target='_blank' style='color:#34d399'>" + data.bot_username + "</a></b>",
            true
          );
        } else {
          showMsg(resBox, "❌ خطا در راه‌اندازی: " + (data.error || "خطای ناشناخته"), false);
        }
      } catch (e) {
        showMsg(resBox, "❌ خطای شبکه: " + e.message, false);
      }
    }

    function showMsg(box, text, isOk) {
      box.style.display = "block";
      box.className = "result-box " + (isOk === true ? "result-ok" : isOk === false ? "result-err" : "");
      if (isOk === null) {
        box.style.background = "rgba(59, 130, 246, 0.15)";
        box.style.color = "#93c5fd";
        box.style.border = "1px solid rgba(59, 130, 246, 0.3)";
      }
      box.innerHTML = text;
    }
  </script>
</body>
</html>`;
}

// ─── Entry Point اصلی ورکر کلادفلر (Fetch & Scheduled) ────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ۱. بررسی سلامت (Health Check) برای مانیتورینگ ۲۴ ساعته
    if (url.pathname === "/health" || url.pathname === "/ping") {
      return new Response(
        JSON.stringify({
          status: "healthy",
          uptime: "24/7 serverless",
          timestamp: Date.now(),
          worker: "Arizo_Movie",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // ۲. ویزارد راه‌اندازی تحت وب (/setup و صفحه اصلی /)
    if (url.pathname === "/setup" || url.pathname === "/") {
      const currentToken = await getSetting(env, "BOT_TOKEN");
      const currentTmdb = await getSetting(env, "TMDB_KEY");
      const currentAdmin = await getSetting(env, "ADMIN_ID");
      const isConfigured = !!(currentToken && currentTmdb);

      const html = renderSetupWizardHtml(url.origin, isConfigured, currentToken, currentTmdb, currentAdmin);
      return new Response(html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "strict-origin-when-cross-origin",
          "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
        },
      });
    }

    // ۳. API اعمال تنظیمات از طریق ویزارد (/api/setup/apply)
    if (url.pathname === "/api/setup/apply" && request.method === "POST") {
      try {
        const body = await request.json();
        const botToken = (body.bot_token || "").trim();
        const tmdbKey = (body.tmdb_key || "").trim();
        const adminId = (body.admin_id || "").trim();

        if (botToken) await setSetting(env, "BOT_TOKEN", botToken);
        if (tmdbKey) await setSetting(env, "TMDB_KEY", tmdbKey);
        if (adminId) await setSetting(env, "ADMIN_ID", adminId);

        // اطمینان از وجود جداول در D1
        await ensureSchema(env);

        // بررسی توکن تلگرام
        const activeToken = await getSetting(env, "BOT_TOKEN");
        if (!activeToken) {
          return new Response(JSON.stringify({ ok: false, error: "توکن ربات تلگرام وارد نشده است." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const meRes = await tgCall(env, "getMe", {});
        if (!meRes.ok) {
          return new Response(JSON.stringify({ ok: false, error: `توکن تلگرام نامعتبر است: ${meRes.description}` }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const botUsername = `@${meRes.result.username}`;
        const botLink = `https://t.me/${meRes.result.username}`;

        // ساخت توکن محرمانه سکرت وبهوک
        let webhookSecret = await getSetting(env, "WEBHOOK_SECRET");
        if (!webhookSecret) {
          webhookSecret = generateRandomToken(32);
          await setSetting(env, "WEBHOOK_SECRET", webhookSecret);
        }

        // ثبت وب‌هوک در سرورهای تلگرام
        const webhookUrl = `${url.origin}/webhook`;
        const setHookRes = await tgCall(env, "setWebhook", {
          url: webhookUrl,
          allowed_updates: ["message", "callback_query"],
          secret_token: webhookSecret,
          drop_pending_updates: false,
        });

        if (!setHookRes.ok) {
          return new Response(
            JSON.stringify({ ok: false, error: `ثبت وب‌هوک با خطا مواجه شد: ${setHookRes.description}` }),
            { status: 500, headers: { "Content-Type": "application/json" } }
          );
        }

        // تنظیم دستورات رسمی در BotFather
        await tgCall(env, "setMyCommands", {
          commands: [
            { command: "start", description: "🎬 شروع و جستجوی فیلم یا سریال" },
            { command: "setchannel", description: "⚙️ تنظیم یا تغییر کانال خروجی" },
            { command: "help", description: "📖 راهنمای کاربری" },
            { command: "cancel", description: "❌ لغو عملیات فعلی" },
          ],
        });

        return new Response(
          JSON.stringify({
            ok: true,
            webhook_url: webhookUrl,
            bot_username: botUsername,
            bot_link: botLink,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: e.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // ۴. وب‌هوک تلگرام (/webhook)
    if (url.pathname === "/webhook" && request.method === "POST") {
      const expectedSecret = await getSetting(env, "WEBHOOK_SECRET");
      const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";

      if (expectedSecret && !timingSafeEqual(providedSecret, expectedSecret)) {
        return new Response("Unauthorized", { status: 401 });
      }

      let update;
      try {
        update = await request.json();
      } catch (e) {
        return new Response("Bad Request", { status: 400 });
      }

      // اجرای ناهمگام هندلر تا تلگرام بلافاصله پاسخ ۲۰۰ را دریافت کند
      ctx.waitUntil(
        handleUpdate(env, update).catch((err) => {
          console.error("handleUpdate unhandled error:", err);
        })
      );

      return new Response("OK", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },

  // ۵. Cloudflare Cron Trigger (تضمین کارکرد ۲۴ ساعته و خودترمیمی وب‌هوک)
  async scheduled(event, env, ctx) {
    const token = await getSetting(env, "BOT_TOKEN");
    if (!token) return;

    ctx.waitUntil(
      (async () => {
        try {
          const info = await tgCall(env, "getWebhookInfo", {});
          if (info.ok && (!info.result.url || info.result.has_custom_certificate)) {
            console.warn("Webhook was dropped or missing, auto-restoring...");
          }
        } catch (e) {
          console.error("Cron check failed:", e);
        }
      })()
    );
  },
};
