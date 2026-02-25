"""Azure AD Bearer token validation using JWKS and PyJWT."""

import os
from typing import Any, Optional

import jwt
import requests

from src.shared.constants import (
    AZURE_AD_DISCOVERY_PATH,
    AZURE_AD_ISSUER_BASE,
)

# In-memory cache for PyJWKClient (key: jwks_uri)
_jwks_client_cache: dict[str, jwt.PyJWKClient] = {}


def _get_jwks_uri(tenant_id: str) -> str:
    """Build OpenID discovery URL and return jwks_uri from the document."""
    base = AZURE_AD_ISSUER_BASE.rstrip("/")
    discovery_url = f"{base}/{tenant_id}/v2.0{AZURE_AD_DISCOVERY_PATH}"
    resp = requests.get(discovery_url, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return data["jwks_uri"]


def _get_jwks_client(jwks_uri: str) -> jwt.PyJWKClient:
    """Get or create cached PyJWKClient for the given jwks_uri."""
    if jwks_uri not in _jwks_client_cache:
        _jwks_client_cache[jwks_uri] = jwt.PyJWKClient(jwks_uri)
    return _jwks_client_cache[jwks_uri]


async def validate_token(req) -> Optional[dict[str, Any]]:
    """
    Read Authorization Bearer from the request, fetch JWKS from Azure AD,
    validate with PyJWT (audience, issuer, expiry) and return decoded payload or None.
    """
    auth = req.headers.get("Authorization")
    if not auth or not auth.startswith("Bearer "):
        return None
    token = auth[7:].strip()
    if not token:
        return None

    tenant_id = os.environ.get("AZURE_TENANT_ID")
    client_id = os.environ.get("AZURE_CLIENT_ID")
    if not tenant_id or not client_id:
        return None

    issuer = f"{AZURE_AD_ISSUER_BASE.rstrip('/')}/{tenant_id}/v2.0"
    try:
        jwks_uri = _get_jwks_uri(tenant_id)
        jwks_client = _get_jwks_client(jwks_uri)
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
            issuer=issuer,
            options={"verify_exp": True, "verify_aud": True, "verify_iss": True},
        )
        return payload
    except Exception:
        return None
