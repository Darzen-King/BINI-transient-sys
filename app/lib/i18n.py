"""
lib/i18n.py — Language detection, translation loading, and t() helper.
Cookie: bini_lang  (values: "zh" | "en", default: "zh")
"""
import json
from pathlib import Path
from fastapi import Request

LOCALE_DIR = Path(__file__).parent.parent / "i18n"
_cache: dict[str, dict] = {}


def get_lang(request: Request) -> str:
    lang = request.cookies.get("bini_lang", "zh")
    return lang if lang in ("zh", "en") else "zh"


def get_translations(lang: str) -> dict:
    if lang not in _cache:
        path = LOCALE_DIR / f"{lang}.json"
        if not path.exists():
            path = LOCALE_DIR / "zh.json"
            lang = "zh"
        _cache[lang] = json.loads(path.read_text(encoding="utf-8"))
    return _cache[lang]


def t(key: str, translations: dict, fallback: str = "") -> str:
    """Return translated string for key, or fallback / key itself."""
    return translations.get(key, fallback or key)
