# Operations

Running this in production. Read the secrets section before your first deploy —
one of these keys is unrecoverable if lost.

## Secrets that must be set

The Coolify compose refuses to start without these, deliberately:

| Variable | Why it must be set |
|---|---|
| `POSTGRES_PASSWORD` | Database access |
| `JWT_SECRET` | Signs access tokens. The dev default is public in this repo, and anyone holding it can forge a token for any user. |
| `STORAGE_ENCRYPTION_KEY` | Encrypts document bytes at rest. **See below.** |
| `S3_SECRET_KEY` | Object storage access |
| `SMTP_HOST`, `EMAIL_FROM` | Password reset and email verification. Without them a locked-out user has no route back into their account. |

Generate the two cryptographic values with:

```bash
python3 -c "import secrets,base64; print('JWT_SECRET=', secrets.token_urlsafe(48), sep=''); print('STORAGE_ENCRYPTION_KEY=', base64.b64encode(secrets.token_bytes(32)).decode(), sep='')"
```

### STORAGE_ENCRYPTION_KEY is unrecoverable

Every uploaded receipt, statement and paystub is stored AES-256-GCM encrypted.
The key is **not** in the database and **not** in any backup produced by
`scripts/backup.sh`. If you lose it:

- every stored document becomes permanently undecryptable,
- restoring a database backup does not help, because the ciphertext is intact and
  the key is what's missing,
- there is no recovery path. The documents are gone.

Store it in a password manager or a secrets store **before** the first deploy, in
at least two places, and never rotate it in place — rotating makes previously
stored documents unreadable. Rotation requires decrypt-with-old, re-encrypt-with-new
across every object, which is not currently automated.

Transaction and balance records survive a lost key; only the source documents do not.

## Health checks

- `GET /health` — liveness. Static, touches nothing. Use it for restart policies:
  a probe that fails during a database blip would have your orchestrator restart
  healthy API containers mid-incident.
- `GET /health/ready` — readiness. Checks Postgres, Redis and object storage, each
  bounded by a 3s timeout. Returns `503` and names the failing dependency. Use it
  for load-balancer membership and deploy gates. This is what the compose
  healthcheck watches.

## Backups

The `backup` service dumps Postgres (`pg_dump -Fc`) and mirrors the MinIO bucket
once every `BACKUP_INTERVAL_SECONDS` (default 24h), keeping
`BACKUP_RETENTION_DAYS` (default 14) of each in the `backups` volume.

**The `backups` volume is on the same host as the data it protects.** Point it at
off-host storage, or have Coolify snapshot it, or it will not survive a disk or
host failure — which is the failure it exists for.

### Restore

```bash
docker compose -f docker-compose.coolify.yml stop api worker beat
```

Database:

```bash
docker compose -f docker-compose.coolify.yml exec -T postgres pg_restore --clean --if-exists -U finance -d finance < /backups/postgres-<STAMP>.dump
```

Documents (needs the original `STORAGE_ENCRYPTION_KEY` to be readable):

```bash
tar -xzf /backups/minio-<STAMP>.tar.gz -C /tmp && mc mirror --overwrite /tmp/minio-latest local/documents
```

Then restart the services. **Test this on a scratch environment before you need
it** — an untested backup is a hypothesis, not a backup.

## Error tracking

Set `SENTRY_DSN` to enable it; blank disables it entirely. Events are scrubbed
before they leave the process: request bodies, cookies, headers, query strings and
user identity are all dropped (`app/observability.py`). `send_default_pii` is off.
Keep it that way — an unscrubbed exception from this app would carry someone's
financial data.

`SENTRY_TRACES_SAMPLE_RATE` defaults to 0. Raise it deliberately; it samples
performance spans, not just errors.

## Rate limiting behind a proxy

`TRUSTED_PROXY_COUNT` is the number of reverse proxies in front of the app. The
limiter only honours that many rightmost `X-Forwarded-For` hops; anything beyond
is attacker-controlled and ignored.

- `0` (code default) — no trusted proxy. The limiter keys on the socket peer, so
  **behind Coolify every request appears to come from the proxy** and one abusive
  client throttles everyone.
- `1` — correct for the Coolify compose, which sets it for you.

## AI spend

`LLM_DAILY_COST_LIMIT_USD` and `LLM_MONTHLY_COST_LIMIT_USD` cap per-user spend on
a rolling window, measured against `llm_usage_log.cost_est`. `0` disables a cap.

Uncapped is a reasonable default for a single-user self-hosted install. **If signup
is open to the public, set both.** Otherwise one account can drive unbounded spend
on your API key through analyst chat and vision OCR.

## Plaid

`PLAID_ENVIRONMENT` defaults to `Sandbox` in code so a misconfigured deploy can
never touch real bank accounts. Set it to `Production` only once you have Plaid
production approval — which requires a published privacy policy and terms of
service.

Note that `/webhooks/plaid` is currently an unauthenticated no-op that only echoes
the event type. Before wiring it to do real work it **must** verify the
`Plaid-Verification` JWT against Plaid's webhook verification key.
