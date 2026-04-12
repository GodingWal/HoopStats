"""
Shared database configuration for all Python scripts.
Reads DATABASE_URL from the project .env file so Python processes
don't depend on the parent Node process passing env vars.
"""
import os
import psycopg2
from pathlib import Path

def _find_env_file():
    """Locate the project .env file."""
    # Walk up from this file to find the project root .env
    current = Path(__file__).resolve()
    for parent in current.parents:
        env_path = parent / ".env"
        if env_path.exists():
            return env_path
    # Fallback: known project root
    fallback = Path("/var/www/courtsideedge/.env")
    if fallback.exists():
        return fallback
    return None

def _load_database_url():
    """
    Get DATABASE_URL with this priority:
    1. Already set in environment (e.g. passed by Node spawn)
    2. Read from .env file via python-dotenv
    3. Raise an error with a helpful message
    """
    # Priority 1: environment variable already set
    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    # Priority 2: load from .env file
    try:
        from dotenv import load_dotenv
        env_file = _find_env_file()
        if env_file:
            load_dotenv(env_file, override=False)
            url = os.environ.get("DATABASE_URL")
            if url:
                return url
    except ImportError:
        pass  # python-dotenv not installed, skip

    # Priority 3: fail with helpful message
    raise RuntimeError(
        "DATABASE_URL not found. Ensure /var/www/courtsideedge/.env exists "
        "and contains DATABASE_URL, or pass it via environment."
    )

# Module-level constant - loaded once on import
DATABASE_URL = _load_database_url()

def get_connection():
    """Get a psycopg2 database connection using the shared DATABASE_URL."""
    return psycopg2.connect(DATABASE_URL)

