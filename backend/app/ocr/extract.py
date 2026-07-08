"""Step 3 of the pipeline: structured extraction via the M3 LLM gateway (M5).

Given a document type and the gathered text (and optionally the page image), pick the
matching Pydantic schema and ask the LLM to fill it. Prefer the vision path when an
image is available and the provider supports vision; otherwise fall back to a
text-only chat over the OCR'd text (the spec's required degrade path). The gateway
handles JSON-schema validation + one repair; we just return the validated dict.
"""

from __future__ import annotations

import structlog
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.llm.client import LLMClient
from app.ocr.schemas import SCHEMA_FOR_TYPE
from app.ocr.text import PageText

log = structlog.get_logger()

_PROMPTS = {
    "receipt": (
        "You are extracting a purchase receipt. Identify the merchant, date, currency, "
        "subtotal, tax, total, and every line item (name, amount, quantity if shown). "
        "Set `confidence` (0..1) to how sure you are overall, and a per-line confidence. "
        "Do not invent items that are not present."
    ),
    "invoice": (
        "You are extracting an invoice. Identify the merchant/vendor, date, currency, "
        "subtotal, tax, total, and every line item. Set `confidence` (0..1)."
    ),
    "statement": (
        "You are extracting a bank/card statement. Return the account hint and every "
        "transaction row (date, description, amount, running balance if shown). "
        "Statements have NO line items — never fabricate them. Set `confidence` (0..1)."
    ),
    "paystub": (
        "You are extracting a payslip/paystub. Identify the employer, pay period start "
        "and end, gross pay, each deduction (name, amount), and net pay. Set `confidence`."
    ),
    "loan": (
        "You are extracting a loan or debt document (statement, agreement, payoff letter). "
        "Identify the loan name/lender, type (home | auto | education | personal | credit_card | other), "
        "outstanding principal balance, interest rate (as a percentage number, e.g. 6.5 for 6.5%), "
        "minimum or EMI monthly payment, start/disbursal date, and monthly due day (1-31). "
        "Set `confidence` (0..1)."
    ),
}


async def extract_structured(
    llm: LLMClient,
    doc_type: str,
    page: PageText,
    *,
    settings: Settings,
    session: AsyncSession | None = None,
    document_id=None,
) -> tuple[dict, bool]:
    """Return (validated extraction dict, vision_used). Raises if the type is unsupported."""
    schema = SCHEMA_FOR_TYPE.get(doc_type)
    if schema is None:
        raise ValueError(f"no extraction schema for doc_type={doc_type!r}")

    prompt = _PROMPTS[doc_type]
    use_vision = bool(page.image_bytes) and settings.llm_supports_vision

    if use_vision:
        full_prompt = prompt
        if page.text.strip():
            full_prompt += f"\n\nOCR text (may help, may be imperfect):\n{page.text}"
        data = await llm.vision(
            full_prompt,
            image_bytes=page.image_bytes,
            mime_type="image/jpeg",
            json_schema=schema,
            purpose="ocr-extract",
            session=session,
        )
        return data, True

    # Text-only fallback (provider lacks vision, or only embedded PDF text available).
    messages = [
        {"role": "system", "content": prompt},
        {"role": "user", "content": f"Document text:\n\n{page.text}"},
    ]
    data = await llm.chat(
        messages,
        json_schema=schema,
        purpose="ocr-extract",
        session=session,
    )
    return data, False
