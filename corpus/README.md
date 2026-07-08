# Financial Guidance Corpus (M10)

Curated, versioned, **citable** source documents for the multi-country financial
guidance & investment-education RAG module (M10).

Each document is tagged with:

- `country` (e.g. `US`, `IN`)
- `topic` (e.g. `remittance`, `fbar`, `dtaa`, `investment-education`)
- `source_type` — `govt` | `community` | `other`
- `effective_date`
- `source_url`

These docs are chunked, embedded, and stored in the `guidance_doc` table (pgvector).
**Never hardcode rates/limits as fact in application code** — they live here, dated and
cited, and must be refreshable. Answers always show their sources so the user can verify.

Populated in M10. Empty in M0.
