"""
routers/lang.py — Language switch endpoint.
POST /set-lang   body: lang=zh|en
Sets Cookie bini_lang and redirects back to Referer.
"""
from fastapi import APIRouter, Form, Request
from fastapi.responses import RedirectResponse

router = APIRouter()


@router.post("/set-lang")
async def set_lang(request: Request, lang: str = Form("zh")):
    referer = request.headers.get("referer", "/")
    lang = lang if lang in ("zh", "en") else "zh"
    response = RedirectResponse(url=referer, status_code=303)
    response.set_cookie(key="bini_lang", value=lang, max_age=60 * 60 * 24 * 365)
    return response
