"""Best-effort cost estimation for the usage log.

Prices are USD per 1K tokens and only need to be roughly right — `cost_est` is a
budgeting signal, not billing. Unknown models return None (logged as NULL) rather
than guessing. Local models (LM Studio / Ollama) are free, hence 0.0.
"""

from __future__ import annotations

from decimal import Decimal

# model -> (input_per_1k, output_per_1k) in USD. Output ignored for embeddings.
_PRICES: dict[str, tuple[float, float]] = {
    "gpt-4o-mini": (0.00015, 0.00060),
    "gpt-4o": (0.00250, 0.01000),
    "gpt-4.1-mini": (0.00040, 0.00160),
    "gpt-4.1": (0.00200, 0.00800),
    "text-embedding-3-small": (0.00002, 0.0),
    "text-embedding-3-large": (0.00013, 0.0),
}


def estimate_cost(
    model: str,
    tokens_in: int | None,
    tokens_out: int | None,
) -> Decimal | None:
    """Return an estimated USD cost, or None when the model price is unknown."""
    price = _PRICES.get(model)
    if price is None:
        return None
    in_rate, out_rate = price
    cost = Decimal(0)
    if tokens_in:
        cost += Decimal(str(in_rate)) * Decimal(tokens_in) / Decimal(1000)
    if tokens_out:
        cost += Decimal(str(out_rate)) * Decimal(tokens_out) / Decimal(1000)
    # Match llm_usage_log.cost_est NUMERIC(18, 6).
    return cost.quantize(Decimal("0.000001"))
