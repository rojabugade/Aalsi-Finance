"""M2 — Auth & Household.

Argon2 password hashing, JWT access tokens, rotating hashed refresh tokens with
reuse detection, TOTP MFA, and the `current_user` dependency + `scoped_query`
helper every downstream module relies on for strict per-household data isolation.

Multi-user household sharing (invites/join/member management) was removed; each
account is a single-user private workspace keyed by `household_id`.
"""
