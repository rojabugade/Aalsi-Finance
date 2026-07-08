"""M2 — Auth & Household.

Argon2 password hashing, JWT access tokens, rotating hashed refresh tokens with
reuse detection, TOTP MFA, signed household invite tokens, and the `current_user`
dependency + `scoped_query` helper every downstream module relies on for strict
per-household data isolation.
"""
