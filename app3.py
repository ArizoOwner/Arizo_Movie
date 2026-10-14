import html
import logging
import os
import re
import requests
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, InputMediaPhoto
from telegram.request import HTTPXRequest
from telegram.ext import (
    ApplicationBuilder, CommandHandler, MessageHandler,
    CallbackQueryHandler, ContextTypes, filters, ConversationHandler
)

# ===================== تنظیمات و متغیرهای پیکربندی =====================
# توکن‌ها و کلیدها از متغیرهای محیطی دریافت می‌شوند (بدون کلیدهای هاردکد شده)
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
TMDB_KEY  = os.environ.get("TMDB_KEY", "")
OMDB_KEY  = os.environ.get("OMDB_KEY", "")

# وضعیت‌های چرخه گفت‌وگو (Conversation States)
WAITING_CHANNEL = 0
WAITING_MOVIE   = 1
WAITING_POSTER  = 2
WAITING_FORWARD = 3

# دیکشنری مترجم رسمی ژانرهای TMDB به فارسی برای هشتگ‌گذاری
GENRE_MAP = {
    "action": "اکشن", "adventure": "ماجراجویی", "animation": "انیمیشن",
    "comedy": "کمدی", "crime": "جنایی", "documentary": "مستند",
    "drama": "درام", "family": "خانوادگی", "fantasy": "فانتزی",
    "history": "تاریخی", "horror": "ترسناک", "music": "موزیکال",
    "mystery": "معمایی", "romance": "عاشقانه", "science fiction": "علمی_تخیلی",
    "sci-fi & fantasy": "علمی_تخیلی_و_فانتزی", "tv movie": "فیلم_تلویزیونی",
    "thriller": "هیجان_انگیز", "war": "جنگی", "war & politics": "جنگی_و_سیاسی",
    "western": "وسترن", "action & adventure": "اکشن_و_ماجراجویی",
    "reality": "رئالیتی_شو", "news": "اخبار", "talk": "گفتگو", "soap": "سریال_درام"
}

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO
)
logging.getLogger("httpx").setLevel(logging.WARNING)

# ===================== توابع قالب‌بندی رابط کاربری (UI) =====================

def get_start_ui(channel=None):
    """طراحی مدرن پیام شروع و منوی اصلی نسل جدید"""
    if channel:
        channel_badge = f"🟢 <code>{channel}</code>"
    else:
        channel_badge = "🔴 <i>تنظیم نشده (نیاز به اتصال)</i>"

    text = (
        "╔══════════════════════════╗\n"
        "  🎬 <b>MOVIEBOT STUDIO | نسل جدید</b>\n"
        "╚══════════════════════════╝\n\n"
        f"📡 <b>کانال مقصد:</b> {channel_badge}\n"
        "─────────────────────────\n"
        "✨ <b>دستیار هوشمند آماده‌سازی و انتشار پست‌های سینمایی</b>\n\n"
        "⚡ <b>امکانات کلیدی:</b>\n"
        "▫️ دریافت خودکار مشخصات رسمی از پایگاه TMDB\n"
        "▫️ نگارش دقیق عنوان فارسی و انگلیسی به همراه سال ساخت\n"
        "▫️ امتیاز هوشمند و هشتگ‌گذاری فارسی خودکار ژانرها\n"
        "▫️ انتخاب از میان باکیفیت‌ترین پوسترهای بین‌المللی\n"
        "▫️ اتصال خودکار به فایل و ارسال آنی به کانال شما\n\n"
        "👇 <b>هم‌اکنون نام فیلم یا سریال را ارسال کنید:</b>\n"
        "📥 <i>مثال: Inception یا Game of Thrones یا متری شیش و نیم</i>"
    )
    
    keyboard = []
    if channel:
        keyboard.append([
            InlineKeyboardButton("⚙️ تغییر کانال مقصد", callback_data="set_channel"),
            InlineKeyboardButton("📖 راهنمای کاربری", callback_data="help")
        ])
    else:
        keyboard.append([
            InlineKeyboardButton("📡 تنظیم کانال خروجی", callback_data="set_channel"),
            InlineKeyboardButton("📖 راهنمای کاربری", callback_data="help")
        ])
        
    return text, InlineKeyboardMarkup(keyboard)


def get_help_ui():
    """پیام راهنمای کاربردی با ظاهر مدرن"""
    text = (
        "╭─────────────────────────╮\n"
        "  📖 <b>راهنمای گام‌به‌گام ربات</b>\n"
        "╰─────────────────────────╯\n\n"
        "<b>۱. تنظیم کانال مقصد:</b>\n"
        "برای اینکه ربات بتواند پست‌ها را مستقیماً منتشر کند، باید در کانال شما <b>ادمین با دسترسی ارسال پیام</b> باشد. سپس آیدی کانال عمومی (@Channel) یا لینک پست کانال خصوصی را ارسال کنید.\n\n"
        "<b>۲. جستجوی عنوان:</b>\n"
        "نام فارسی یا انگلیسی اثر را بفرستید. در صورت وجود چند عنوان، لیست گزینه‌ها همراه با سال ساخت و نوع (فیلم/سریال) نمایش داده می‌شود.\n\n"
        "<b>۳. انتخاب پوستر:</b>\n"
        "از دکمه‌های ◀️ و ▶️ برای مشاهده و مقایسه پوسترهای مختلف استفاده کنید و روی دکمه تایید کلیک کنید.\n\n"
        "<b>۴. اتصال به فایل فیلم:</b>\n"
        "پیام مربوط به فیلم را از کانال خود به ربات <b>فوروارد</b> کنید یا <b>لینک پیام کانال</b> را بفرستید تا فوراً پست با پوستر و لینک دانلود مستقیم در کانال مقصد درج شود.\n\n"
        "⚙️ <b>دستورات سریع:</b>\n"
        "▫️ /start - شروع مجدد و رفتن به منو\n"
        "▫️ /setchannel - تغییر یا ثبت کانال مقصد\n"
        "▫️ /cancel - انصراف از عملیات فعلی"
    )
    keyboard = [
        [InlineKeyboardButton("🔙 بازگشت به منوی اصلی", callback_data="back_to_start")]
    ]
    return text, InlineKeyboardMarkup(keyboard)


# ===================== توابع ابزار و API =====================

def clear_session(user_data):
    channel = user_data.get("publish_channel")
    user_data.clear()
    if channel:
        user_data["publish_channel"] = channel


def extract_channel_id_or_username(text):
    text = text.strip()
    if text.startswith("@"):
        return text
        
    link_pattern = r"(?:https?://)?(?:www\.)?t\.me/(c/\d+|[\w_]+)"
    match = re.search(link_pattern, text)
    if match:
        channel_info = match.group(1)
        if channel_info.startswith("c/"):
            chat_id = channel_info[2:]
            return int(f"-100{chat_id}")
        else:
            return f"@{channel_info}"
            
    if text.startswith("-100") and text[4:].isdigit():
        return int(text)
    if text.isdigit():
        return int(f"-100{text}")
        
    return None


def translate_to_persian(text):
    if not text:
        return text
    try:
        url = "https://translate.googleapis.com/translate_a/single"
        params = {"client": "gtx", "sl": "en", "tl": "fa", "dt": "t", "q": text}
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        r = requests.get(url, params=params, headers=headers, timeout=5)
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and isinstance(data[0], list):
                return "".join([seg[0] for seg in data[0] if seg and seg[0]]).strip()
    except Exception as e:
        logging.error(f"Translation error: {e}")
    return text


def get_persian_genres(genres_list):
    """تبدیل، ترجمه و ساخت هشتگ‌های کاملاً فارسی ژانرها"""
    persian_genres = []
    for g in genres_list:
        name = g.get("name", "").strip()
        if not name:
            continue
            
        if any('\u0600' <= char <= '\u06FF' for char in name):
            clean_name = name.replace(' ', '_').replace('-', '_')
            persian_genres.append(f"#{clean_name}")
        else:
            eng_name_lower = name.lower()
            fa_name = GENRE_MAP.get(eng_name_lower, name)
            clean_name = fa_name.replace(' ', '_').replace('-', '_').replace('&', 'و')
            persian_genres.append(f"#{clean_name}")
            
    return " ".join(persian_genres)


def search_tmdb(query):
    url = "https://api.themoviedb.org/3/search/multi"
    params = {"api_key": TMDB_KEY, "query": query, "language": "fa-IR", "include_adult": False}
    r = requests.get(url, params=params, timeout=10)
    if r.status_code != 200:
        return []
    results = r.json().get("results", [])
    return [x for x in results if x.get("media_type") in ("movie", "tv")][:5]


def get_tmdb_details(tmdb_id, media_type):
    url = f"https://api.themoviedb.org/3/{media_type}/{tmdb_id}"
    r_fa = requests.get(url, params={"api_key": TMDB_KEY, "language": "fa-IR", "append_to_response": "translations,external_ids"}, timeout=10)
    r_en = requests.get(url, params={"api_key": TMDB_KEY, "language": "en-US", "append_to_response": "external_ids"}, timeout=10)
    
    fa_json = r_fa.json() if r_fa.status_code == 200 else {}
    en_json = r_en.json() if r_en.status_code == 200 else {}
    
    fa_title = None
    if "translations" in fa_json:
        for t in fa_json["translations"].get("translations", []):
            if t.get("iso_639_1") == "fa":
                fa_title = t.get("data", {}).get("title") or t.get("data", {}).get("name")
                break
                
    return {
        "fa": fa_json,
        "en": en_json,
        "fa_explicit_title": fa_title
    }


def get_intelligent_seasons(year, en_data, fa_data):
    """تعریف متغیر پایدار و دیفالت برای خروجی سیزن‌ها"""
    default_season = f"<b>{year}</b> Season 1"
    try:
        num_seasons = en_data.get("number_of_seasons") or fa_data.get("number_of_seasons")
        if num_seasons and int(num_seasons) > 1:
            num_seasons = int(num_seasons)
            start_year = int(year) if str(year).isdigit() else 2026
            
            season_lines = [default_season]
            for i in range(2, num_seasons + 1):
                current_year = start_year + (i - 1)
                season_lines.append(f"<b>{current_year}</b> Season {i}")
            return "\n".join(season_lines)
    except Exception as e:
        logging.error(f"Error merging season config: {e}")
    return default_season


def get_tmdb_posters(tmdb_id, media_type):
    url = f"https://api.themoviedb.org/3/{media_type}/{tmdb_id}/images"
    r = requests.get(url, params={"api_key": TMDB_KEY}, timeout=10)
    if r.status_code != 200:
        return []
    posters = r.json().get("posters", [])
    posters.sort(key=lambda x: x.get("vote_average", 0), reverse=True)
    # از کیفیت w780 استفاده می‌کنیم تا محدودیت حجم عکس ۱۰ مگابایت تلگرام نقض نشود
    return [f"https://image.tmdb.org/t/p/w780{p['file_path']}" for p in posters[:10]]


def build_caption(title_en, title_fa, year, media_type, rating, genres_str, seasons_info, channel, post_id):
    """ساخت کپشن نهایی بدون کوتیشن با تفکیک دقیق فیلم و سریال و فرار دادن کاراکترهای HTML"""
    hashtag = "#سریال" if media_type == "tv" else "#فیلم"
    link = f"t.me/{html.escape(str(channel))}/{html.escape(str(post_id))}"

    clean_en = html.escape(str(title_en or ""))
    clean_fa = html.escape(str(title_fa or ""))
    clean_year = html.escape(str(year or ""))
    clean_rating = html.escape(str(rating or ""))

    caption = f"{hashtag}\n\n| <b>{clean_en}</b> |\n| <b>{clean_fa}</b> |\n\n"

    if clean_rating and clean_rating != "0":
        caption += f"⭐️ <b>امتیاز:</b> {clean_rating}/10\n"
    if genres_str:
        caption += f"🎭 <b>ژانر:</b> {genres_str}\n"

    if media_type == "tv":
        caption += f"\n{seasons_info}\n\n"
    else:
        caption += f"\n<b>{clean_year}</b>\n\n"

    caption += f"<b>Link=</b> {link}"
    return caption


def get_forward_info(message):
    try:
        origin = message.forward_origin
        if origin and hasattr(origin, "message_id") and hasattr(origin, "chat"):
            post_id = str(origin.message_id)
            if origin.chat.username:
                channel_info = origin.chat.username
            else:
                chat_id = str(origin.chat.id)
                if chat_id.startswith("-100"):
                    channel_info = f"c/{chat_id[4:]}"
                else:
                    channel_info = chat_id
            return post_id, channel_info
    except Exception as e:
        logging.error(f"Error extracting forward info: {e}")
    return None, None


def extract_info_from_link(text):
    if not text:
        return None, None
    text = text.strip()
    link_pattern = r"(?:https?://)?(?:www\.)?t\.me/(c/\d+|[\w_]+)/(\d+)"
    match = re.search(link_pattern, text)
    if match:
        channel_info = match.group(1)
        post_id = match.group(2)
        return post_id, channel_info
    return None, None


# ===================== هندلرهای ربات =====================

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    publish_channel = context.user_data.get("publish_channel")
    text, keyboard = get_start_ui(publish_channel)
    
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await update.message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")
        
    if publish_channel:
        clear_session(context.user_data)
        return WAITING_MOVIE
    else:
        return WAITING_CHANNEL


async def help_command(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text, keyboard = get_help_ui()
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
    else:
        await update.message.reply_text(text, reply_markup=keyboard, parse_mode="HTML")


async def back_to_start_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    publish_channel = context.user_data.get("publish_channel")
    text, keyboard = get_start_ui(publish_channel)
    await query.message.edit_text(text, reply_markup=keyboard, parse_mode="HTML")
    if publish_channel:
        return WAITING_MOVIE
    return WAITING_CHANNEL


async def set_channel_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "╭─────────────────────────╮\n"
        "  ⚙️ <b>تنظیم کانال خروجی | کانال مقصد</b>\n"
        "╰─────────────────────────╯\n\n"
        "برای انتشار مستقیم و خودکار پست‌ها در کانال، یکی از ۲ روش زیر را انجام دهید:\n\n"
        "📌 <b>روش اول (کانال عمومی):</b>\n"
        "آیدی عمومی کانال را با <code>@</code> بفرستید:\n"
        "مثال: <code>@MyMovieChannel</code>\n\n"
        "📌 <b>روش دوم (کانال خصوصی):</b>\n"
        "لینک یکی از پست‌های کانال خود را ارسال کنید:\n"
        "مثال: <code>https://t.me/c/1234567890/123</code>\n\n"
        "⚠️ <i>الزامات مهم: ربات حتماً باید در کانال شما عضو و ادمین با دسترسی ارسال پیام (Post Messages) باشد.</i>"
    )
    keyboard = [
        [InlineKeyboardButton("❌ انصراف و بازگشت", callback_data="cancel")]
    ]
    
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    else:
        await update.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
        
    return WAITING_CHANNEL


async def handle_channel_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = update.message.text.strip()
    channel = extract_channel_id_or_username(text)
    user_id = update.effective_user.id
    
    if not channel:
        keyboard = [[InlineKeyboardButton("❌ انصراف", callback_data="cancel")]]
        await update.message.reply_text(
            "❌ <b>فرمت ورودی نامعتبر است!</b>\n\n"
            "لطفاً آیدی کانال را به صورت <code>@channel_name</code> یا لینک کامل پست کانال خصوصی بفرستید:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
        return WAITING_CHANNEL
        
    try:
        member = await context.bot.get_chat_member(chat_id=channel, user_id=user_id)
        if member.status not in ["creator", "administrator"]:
            await update.message.reply_text(
                "⛔️ <b>خطای دسترسی و حریم خصوصی!</b>\n\n"
                "شما باید مالک (Creator) یا مدیر (Admin) این کانال باشید تا امکان تنظیم آن وجود داشته باشد.",
                parse_mode="HTML"
            )
            return WAITING_CHANNEL
    except Exception as e:
        logging.error(f"Security verification failed: {e}")
        keyboard = [[InlineKeyboardButton("❌ انصراف", callback_data="cancel")]]
        await update.message.reply_text(
            "⚠️ <b>خطا در احراز هویت کانال!</b>\n\n"
            "۱. مطمئن شوید ربات در کانال <b>عضو و ادمین با دسترسی ارسال پیام</b> است.\n"
            "۲. آیدی یا لینک ارسال شده دقیق و صحیح باشد.",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
        return WAITING_CHANNEL
        
    context.user_data["publish_channel"] = channel
    success_text = (
        "✅ <b>کانال مقصد با موفقیت تایید و ذخیره شد!</b>\n"
        "─────────────────────────\n"
        f"📢 <b>کانال فعال:</b> <code>{channel}</code>\n\n"
        "🎯 هم‌اکنون <b>نام فیلم یا سریال</b> مورد نظر خود را برای جستجو ارسال کنید:"
    )
    keyboard = [
        [InlineKeyboardButton("⚙️ تغییر مجدد کانال", callback_data="set_channel")]
    ]
    await update.message.reply_text(success_text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    return WAITING_MOVIE


async def handle_search(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.message.text.strip()
    if not query:
        return WAITING_MOVIE

    clear_session(context.user_data)
    status_msg = await update.message.reply_text("⚡ <i>در حال کاوش در دیتابیس TMDB و دریافت اطلاعات...</i>", parse_mode="HTML")

    results = search_tmdb(query)
    if not results:
        keyboard = [
            [InlineKeyboardButton("🔄 جستجوی مجدد", callback_data="search_again")],
            [InlineKeyboardButton("❌ انصراف", callback_data="cancel")]
        ]
        await status_msg.edit_text(
            "❌ <b>نتیجه‌ای برای این عنوان یافت نشد!</b>\n\n"
            "💡 <i>پیشنهاد: املا یا عنوان لاتین اثر را امتحان کنید (مثلاً: Interstellar).</i>",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
        return WAITING_MOVIE

    if len(results) == 1:
        await status_msg.delete()
        return await show_result(update, context, results[0])

    keyboard = []
    for item in results:
        is_movie = item["media_type"] == "movie"
        badge = "🎬 فیلم" if is_movie else "📺 سریال"
        
        name = item.get("title") if is_movie else item.get("name")
        name = name or item.get("original_title") or item.get("original_name") or "عنوان ناشناخته"
        
        year_raw = item.get("release_date") if is_movie else item.get("first_air_date")
        year = f"({year_raw[:4]})" if year_raw else ""
        
        label = f"{badge} | {name} {year}".strip()
        if len(label) > 55:
            label = label[:52] + "..."
            
        keyboard.append([InlineKeyboardButton(label, callback_data=f"sel_{item['id']}_{item['media_type']}")])

    keyboard.append([
        InlineKeyboardButton("🔄 جستجوی دوباره", callback_data="search_again"),
        InlineKeyboardButton("❌ لغو", callback_data="cancel")
    ])

    context.user_data["search_results"] = {f"{r['id']}_{r['media_type']}": r for r in results}
    await status_msg.delete()
    
    header_text = (
        "🎯 <b>نتایج یافت شده برای عنوان شما:</b>\n"
        "─────────────────────────\n"
        "لطفاً گزینه دقیق مورد نظر خود را از لیست زیر انتخاب فرمایید:"
    )
    await update.message.reply_text(header_text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    return WAITING_MOVIE


async def handle_selection(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    _, tmdb_id, media_type = query.data.split("_", 2)
    cached = context.user_data.get("search_results", {})
    item = cached.get(f"{tmdb_id}_{media_type}")
    if not item:
        keyboard = [[InlineKeyboardButton("🔄 جستجوی جدید", callback_data="search_again")]]
        await query.message.edit_text(
            "⚠️ <b>اطلاعات جستجو منقضی شده است.</b>\nلطفاً دوباره نام اثر را جستجو کنید.",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
        return WAITING_MOVIE
    await query.message.delete()
    return await show_result(update, context, item, from_callback=True)


async def show_result(update: Update, context: ContextTypes.DEFAULT_TYPE, item: dict, from_callback: bool = False):
    tmdb_id = item["id"]
    media_type = item["media_type"]

    details = get_tmdb_details(tmdb_id, media_type)
    fa_data = details["fa"]
    en_data = details["en"]
    fa_explicit = details["fa_explicit_title"]

    rating_val = fa_data.get("vote_average") or en_data.get("vote_average") or 0
    rating = str(round(rating_val, 1)) if rating_val else "0"

    genres_list = fa_data.get("genres") or en_data.get("genres") or []
    genres_str = get_persian_genres(genres_list)

    if media_type == "movie":
        title_en = en_data.get("title") or en_data.get("original_title", "")
        title_fa = fa_explicit or fa_data.get("title") or fa_data.get("original_title", title_en)
        if not any('\u0600' <= char <= '\u06FF' for char in title_fa) or title_fa == title_en:
            title_fa = translate_to_persian(title_en)
        year = (en_data.get("release_date") or fa_data.get("release_date") or "")[:4]
        if not year or not year.isdigit():
            year = "2026"
        seasons_info = ""
    else:
        title_en = en_data.get("name") or en_data.get("original_name", "")
        title_fa = fa_explicit or fa_data.get("name") or fa_data.get("original_name", title_en)
        if not any('\u0600' <= char <= '\u06FF' for char in title_fa) or title_fa == title_en:
            title_fa = translate_to_persian(title_en)
        year = (en_data.get("first_air_date") or fa_data.get("first_air_date") or "")[:4]
        if not year or not year.isdigit():
            year = "2026"
        seasons_info = get_intelligent_seasons(year, en_data, fa_data)

    posters = get_tmdb_posters(tmdb_id, media_type)
    if not posters:
        path = en_data.get("poster_path") or fa_data.get("poster_path")
        if path:
            posters = [f"https://image.tmdb.org/t/p/original{path}"]

    context.user_data["pending"] = {
        "title_en": title_en,
        "title_fa": title_fa,
        "year": year,
        "media_type": media_type,
        "rating": rating,
        "genres_str": genres_str,
        "seasons_info": seasons_info,
        "posters": posters,
        "poster_index": 0,
    }

    await send_poster(update, context, edit=False)
    return WAITING_POSTER


async def send_poster(update: Update, context: ContextTypes.DEFAULT_TYPE, edit: bool = False):
    pending = context.user_data.get("pending")
    if not pending:
        return

    posters = pending.get("posters", [])
    index = pending.get("poster_index", 0)
    total = len(posters)
    chat_id = update.effective_chat.id

    preview_caption = build_caption(
        pending["title_en"], pending["title_fa"], pending["year"],
        pending["media_type"], pending["rating"], pending["genres_str"],
        pending["seasons_info"], "YourChannel", "XXXXX"
    )

    caption_text = (
        "╭─────────────────────────╮\n"
        "  🖼 <b>گالری پوسترها | پیش‌نمایش خروجی</b>\n"
        "╰─────────────────────────╯\n\n"
        f"{preview_caption}\n\n"
        "─────────────────────────\n"
        "💡 <i>پوستر دلخواه را با دکمه‌های ناوبری انتخاب و تایید کنید.</i>"
    )

    if not posters:
        keyboard = [
            [InlineKeyboardButton("✨ تایید بدون پوستر", callback_data="confirm_poster")],
            [InlineKeyboardButton("🔄 جستجوی دیگر", callback_data="search_again")]
        ]
        await context.bot.send_message(
            chat_id=chat_id,
            text=f"⚠️ <b>پوستر اختصاصی یافت نشد!</b>\n\n{caption_text}",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
        return

    poster_url = posters[index]

    nav_row = [
        InlineKeyboardButton("◀️ قبلی", callback_data="prev_poster"),
        InlineKeyboardButton(f"🖼 پوستر {index+1} از {total}", callback_data="poster_info"),
        InlineKeyboardButton("بعدی ▶️", callback_data="next_poster")
    ]
    confirm_row = [
        InlineKeyboardButton("💎 انتخاب و تایید این پوستر ➜", callback_data="confirm_poster")
    ]
    action_row = [
        InlineKeyboardButton("🔄 جستجوی دوباره", callback_data="search_again"),
        InlineKeyboardButton("❌ لغو", callback_data="cancel")
    ]

    keyboard = [nav_row, confirm_row, action_row]

    if edit and update.callback_query:
        try:
            await update.callback_query.message.edit_media(
                media=InputMediaPhoto(media=poster_url, caption=caption_text, parse_mode="HTML"),
                reply_markup=InlineKeyboardMarkup(keyboard)
            )
        except Exception as e:
            if "message is not modified" not in str(e).lower():
                logging.error(f"Error editing poster media: {e}")
    else:
        await context.bot.send_photo(
            chat_id=chat_id,
            photo=poster_url,
            caption=caption_text,
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(keyboard)
        )


async def handle_poster_navigation(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    action = query.data
    
    pending = context.user_data.get("pending")
    if not pending:
        await query.answer("❌ سشن منقضی شده است. مجدداً جستجو کنید.", show_alert=True)
        return WAITING_MOVIE

    posters = pending["posters"]
    index = pending["poster_index"]

    if action == "next_poster":
        if index + 1 >= len(posters):
            await query.answer("این آخرین پوستر موجود در آرشیو است ✨", show_alert=False)
            return WAITING_POSTER
        pending["poster_index"] += 1
    elif action == "prev_poster":
        if index - 1 < 0:
            await query.answer("این اولین پوستر موجود در آرشیو است ✨", show_alert=False)
            return WAITING_POSTER
        pending["poster_index"] -= 1

    await query.answer()
    await send_poster(update, context, edit=True)
    return WAITING_POSTER


async def handle_poster_info(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    pending = context.user_data.get("pending")
    if pending:
        index = pending.get("poster_index", 0) + 1
        total = len(pending.get("posters", []))
        await query.answer(f"🖼 شما در حال مشاهده پوستر {index} از مجموع {total} پوستر هستید.", show_alert=False)
    else:
        await query.answer()


async def handle_confirm_poster(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer("پوستر تایید شد ✅")
    await query.message.edit_reply_markup(reply_markup=None)
    
    publish_channel = context.user_data.get("publish_channel")
    channel_display = f"<code>{publish_channel}</code>" if publish_channel else "<i>تنظیم نشده</i>"

    step_text = (
        "╭─────────────────────────╮\n"
        "  🎯 <b>مرحله آخر: اتصال به فایل کانال</b>\n"
        "╰─────────────────────────╯\n\n"
        "✨ پوستر و مشخصات اثر با موفقیت تایید گردید.\n"
        f"📢 <b>کانال مقصد:</b> {channel_display}\n\n"
        "👇 <b>یکی از ۲ اقدام زیر را برای تکمیل فرایند انجام دهید:</b>\n\n"
        "<b>1️⃣ ارسال با فوروارد:</b>\n"
        "پیام مربوط به فایل/ویدیو را از کانال خود به این ربات <b>Forward</b> کنید.\n\n"
        "<b>2️⃣ ارسال لینک مستقیم:</b>\n"
        "یا لینک مستقیم پیام کانال را ارسال فرمایید:\n"
        "🔗 <code>https://t.me/c/1234567890/123</code>"
    )
    
    keyboard = [
        [
            InlineKeyboardButton("🖼 تغییر مجدد پوستر", callback_data="back_to_poster"),
            InlineKeyboardButton("❌ انصراف", callback_data="cancel")
        ]
    ]
    await query.message.reply_text(step_text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    return WAITING_FORWARD


async def back_to_poster_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    pending = context.user_data.get("pending")
    if not pending:
        await query.message.reply_text("⚠️ اطلاعات اثر منقضی شده است. نام فیلم را مجدداً ارسال کنید.")
        return WAITING_MOVIE
    await send_poster(update, context, edit=False)
    return WAITING_POSTER


async def handle_forward(update: Update, context: ContextTypes.DEFAULT_TYPE):
    message = update.message
    pending = context.user_data.get("pending")
    publish_channel = context.user_data.get("publish_channel")

    if not pending or not publish_channel:
        keyboard = [[InlineKeyboardButton("🚀 شروع مجدد", callback_data="back_to_start")]]
        await message.reply_text(
            "❌ <b>سشن منقضی شده یا کانال مقصد تنظیم نشده است.</b>\nلطفاً ربات را دوباره شروع کنید:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
        return WAITING_CHANNEL

    post_id, channel = get_forward_info(message)

    if not post_id:
        user_input = message.text or message.caption or ""
        post_id, channel = extract_info_from_link(user_input)

    if not post_id or not channel:
        keyboard = [
            [InlineKeyboardButton("🖼 تغییر پوستر", callback_data="back_to_poster")],
            [InlineKeyboardButton("❌ انصراف", callback_data="cancel")]
        ]
        await message.reply_text(
            "⚠️ <b>اطلاعات پیام شناسایی نشد!</b>\n\n"
            "لطفاً پیام فایل را مستقیماً از کانال <b>فوروارد</b> کنید یا <b>لینک کامل پیام</b> را بفرستید:",
            reply_markup=InlineKeyboardMarkup(keyboard),
            parse_mode="HTML"
        )
        return WAITING_FORWARD

    caption = build_caption(
        pending["title_en"], pending["title_fa"], pending["year"],
        pending["media_type"], pending["rating"], pending["genres_str"],
        pending["seasons_info"], channel, post_id
    )

    posters = pending.get("posters", [])
    poster_index = pending.get("poster_index", 0)
    poster_url = posters[poster_index] if posters else None

    direct_post_url = None
    if str(channel).startswith("c/"):
        direct_post_url = f"https://t.me/{channel}/{post_id}"
    elif not str(channel).startswith("-100"):
        clean_ch = str(channel).lstrip("@")
        direct_post_url = f"https://t.me/{clean_ch}/{post_id}"

    try:
        if poster_url:
            await context.bot.send_photo(chat_id=publish_channel, photo=poster_url, caption=caption, parse_mode="HTML")
        else:
            await context.bot.send_message(chat_id=publish_channel, text=caption, parse_mode="HTML")
            
        success_card = (
            "╔══════════════════════════╗\n"
            "  🚀 <b>پست با موفقیت در کانال منتشر شد!</b>\n"
            "╚══════════════════════════╝\n\n"
            f"🎬 <b>اثر:</b> {pending['title_fa']} ({pending['title_en']})\n"
            f"📢 <b>کانال مقصد:</b> <code>{publish_channel}</code>\n"
            f"🔗 <b>شناسه پست مرجع:</b> <code>#{post_id}</code>\n"
            "─────────────────────────\n"
            "✨ <b>برای ساخت پست جدید، نام فیلم یا سریال بعدی را ارسال کنید:</b>"
        )
        
        keyboard = []
        if direct_post_url:
            keyboard.append([InlineKeyboardButton("🌐 مشاهده پست متصل شده در کانال", url=direct_post_url)])
        keyboard.append([
            InlineKeyboardButton("🎬 ایجاد پست جدید", callback_data="search_again"),
            InlineKeyboardButton("⚙️ تنظیمات کانال", callback_data="set_channel")
        ])
        
        await message.reply_text(success_card, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
        
    except Exception as e:
        logging.error(f"Error publishing: {e}")
        fallback_msg = (
            "⚠️ <b>عدم امکان ارسال مستقیم خودکار به کانال!</b>\n\n"
            "ربات نتوانست پیام را مستقیماً به کانال بفرستد (دسترسی ادمین یا مجوز پست را بررسی کنید).\n"
            "👇 <b>خروجی نهایی شما آماده است و در زیر ارسال شد:</b>"
        )
        await message.reply_text(fallback_msg, parse_mode="HTML")
        
        if poster_url:
            await message.reply_photo(photo=poster_url, caption=caption, parse_mode="HTML")
        else:
            await message.reply_text(caption, parse_mode="HTML")

        action_keyboard = [
            [InlineKeyboardButton("🎬 شروع مجدد", callback_data="search_again")],
            [InlineKeyboardButton("⚙️ بررسی کانال", callback_data="set_channel")]
        ]
        await message.reply_text("💡 برای اثر بعدی نام فیلم را ارسال فرمایید:", reply_markup=InlineKeyboardMarkup(action_keyboard))

    clear_session(context.user_data)
    return WAITING_MOVIE


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    clear_session(context.user_data)
    keyboard = [
        [InlineKeyboardButton("🔍 جستجوی اثر جدید", callback_data="search_again")],
        [InlineKeyboardButton("⚙️ تغییر کانال مقصد", callback_data="set_channel")]
    ]
    await update.message.reply_text(
        "❌ <b>عملیات لغو شد.</b>\n\nنام فیلم یا سریال جدید را بنویسید:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )
    return WAITING_MOVIE


async def inline_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer("عملیات لغو شد.")
    clear_session(context.user_data)
    chat_id = query.message.chat_id
    try:
        await query.message.delete()
    except Exception as e:
        logging.warning(f"Failed to delete message in inline_cancel: {e}")

    keyboard = [
        [InlineKeyboardButton("🔍 جستجوی اثر جدید", callback_data="search_again")],
        [InlineKeyboardButton("⚙️ تغییر کانال مقصد", callback_data="set_channel")]
    ]
    await context.bot.send_message(
        chat_id=chat_id,
        text="❌ <b>عملیات لغو شد.</b>\n\nنام فیلم یا سریال جدید را بنویسید:",
        reply_markup=InlineKeyboardMarkup(keyboard),
        parse_mode="HTML"
    )
    return WAITING_MOVIE


async def search_again_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    clear_session(context.user_data)
    
    text = (
        "🔍 <b>جستجوی عنوان سینمایی جدید:</b>\n"
        "─────────────────────────\n"
        "لطفاً نام فیلم یا سریال مورد نظر خود را بنویسید:\n"
        "📥 <i>مثال: Oppenheimer یا Succession</i>"
    )
    keyboard = [
        [InlineKeyboardButton("❌ انصراف", callback_data="cancel")]
    ]
    await query.message.reply_text(text, reply_markup=InlineKeyboardMarkup(keyboard), parse_mode="HTML")
    return WAITING_MOVIE


async def global_error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logging.error(f"Update {update} caused error {context.error}")


async def post_init(application):
    await application.bot.set_my_commands([
        ("start", "🎬 شروع سریع و جستجوی فیلم"),
        ("setchannel", "⚙️ تغییر یا تنظیم کانال خروجی"),
        ("help", "📖 راهنمای کاربری و آموزش"),
        ("cancel", "❌ انصراف و لغو عملیات فعلی")
    ])


def main():
    net_request = HTTPXRequest(
        connect_timeout=30.0,
        read_timeout=30.0
    )

    app = (
        ApplicationBuilder()
        .token(BOT_TOKEN)
        .request(net_request)
        .post_init(post_init)
        .build()
    )

    app.add_error_handler(global_error_handler)

    conv = ConversationHandler(
        entry_points=[
            CommandHandler("start", start),
            CommandHandler("setchannel", set_channel_start),
            CommandHandler("help", help_command),
            CallbackQueryHandler(set_channel_start, pattern=r"^set_channel$"),
            CallbackQueryHandler(help_command, pattern=r"^help$"),
            CallbackQueryHandler(back_to_start_callback, pattern=r"^back_to_start$"),
            CallbackQueryHandler(search_again_callback, pattern=r"^search_again$"),
        ],
        states={
            WAITING_CHANNEL: [
                CallbackQueryHandler(inline_cancel, pattern=r"^cancel$"),
                CallbackQueryHandler(help_command, pattern=r"^help$"),
                CallbackQueryHandler(back_to_start_callback, pattern=r"^back_to_start$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_channel_input)
            ],
            WAITING_MOVIE: [
                CallbackQueryHandler(handle_selection, pattern=r"^sel_"),
                CallbackQueryHandler(search_again_callback, pattern=r"^search_again$"),
                CallbackQueryHandler(set_channel_start, pattern=r"^set_channel$"),
                CallbackQueryHandler(help_command, pattern=r"^help$"),
                CallbackQueryHandler(back_to_start_callback, pattern=r"^back_to_start$"),
                CallbackQueryHandler(inline_cancel, pattern=r"^cancel$"),
                MessageHandler(filters.TEXT & ~filters.COMMAND, handle_search)
            ],
            WAITING_POSTER: [
                CallbackQueryHandler(handle_poster_navigation, pattern=r"^(next_poster|prev_poster)$"),
                CallbackQueryHandler(handle_poster_info, pattern=r"^poster_info$"),
                CallbackQueryHandler(handle_confirm_poster, pattern=r"^confirm_poster$"),
                CallbackQueryHandler(search_again_callback, pattern=r"^search_again$"),
                CallbackQueryHandler(set_channel_start, pattern=r"^set_channel$"),
                CallbackQueryHandler(inline_cancel, pattern=r"^cancel$")
            ],
            WAITING_FORWARD: [
                CallbackQueryHandler(back_to_poster_callback, pattern=r"^back_to_poster$"),
                CallbackQueryHandler(search_again_callback, pattern=r"^search_again$"),
                CallbackQueryHandler(set_channel_start, pattern=r"^set_channel$"),
                CallbackQueryHandler(inline_cancel, pattern=r"^cancel$"),
                MessageHandler(filters.ALL & ~filters.COMMAND, handle_forward)
            ],
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CommandHandler("start", start),
            CommandHandler("help", help_command),
            CommandHandler("setchannel", set_channel_start)
        ],
        allow_reentry=True,
        per_user=True,
    )

    app.add_handler(conv)
    print("🚀 ربات داینامیک، مدرن و پرسرعت MovieBot نسل جدید با موفقیت راه‌اندازی شد...")
    app.run_polling(bootstrap_retries=-1)


if __name__ == "__main__":
    main()