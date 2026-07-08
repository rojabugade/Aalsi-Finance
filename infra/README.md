# Infra

The dev stack is defined in the root [`docker-compose.yml`](../docker-compose.yml) for
`docker compose up` ergonomics. Environment templates live at the repo root
([`.env.example`](../.env.example)) and per-client (`web/.env.example`,
`backend` reads the root `.env`).

Services:

| Service  | Image                     | Port(s)      | Purpose                          |
|----------|---------------------------|--------------|----------------------------------|
| postgres | `pgvector/pgvector:pg16`  | 5432         | Relational store + pgvector      |
| redis    | `redis:7-alpine`          | 6379         | Cache + Celery broker/result     |
| minio    | `minio/minio`             | 9000 / 9001  | S3-compatible object storage     |
| api      | `./backend`               | 8000         | FastAPI                          |
| worker   | `./backend`               | —            | Celery worker                    |
| beat     | `./backend`               | —            | Celery Beat scheduler            |
| web      | `./web`                   | 3000         | Next.js PWA                      |

Production hardening (TLS, secrets manager/KMS, multi-stage web build, orchestration)
is deliberately out of scope for this self-hosted personal tool.
