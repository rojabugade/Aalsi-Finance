"""Application version metadata.

`commit` is resolved at runtime from the GIT_COMMIT env var (injected at build time)
falling back to "unknown" for local runs.
"""

import os

VERSION = "0.1.0"
COMMIT = os.getenv("GIT_COMMIT", "unknown")
