import bcrypt
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

# passlib 1.7.4 probes `bcrypt.__about__.__version__`, which bcrypt 4.x removed.
# It traps the AttributeError and still works, but prints a full traceback on
# first use. Supplying the attribute keeps startup logs readable.
if not hasattr(bcrypt, "__about__"):  # pragma: no cover - shim for passlib
    class _About:
        __version__ = getattr(bcrypt, "__version__", "4.2.1")

    bcrypt.__about__ = _About()  # type: ignore[attr-defined]

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

TokenType = Literal["access", "refresh"]


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def _create_token(subject: str, token_type: TokenType, expires: timedelta) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(
        user_id, "access", timedelta(minutes=settings.access_token_minutes)
    )


def create_refresh_token(user_id: str) -> str:
    settings = get_settings()
    return _create_token(user_id, "refresh", timedelta(days=settings.refresh_token_days))


def decode_token(token: str, expected_type: TokenType) -> str | None:
    """
    Returns the subject (user id) when the token is valid and of the expected
    type, otherwise None.

    The type check matters: without it a long-lived refresh token would be
    accepted as an access token, silently defeating the short access expiry.
    """
    settings = get_settings()
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None

    if payload.get("type") != expected_type:
        return None

    subject = payload.get("sub")
    return subject if isinstance(subject, str) else None
