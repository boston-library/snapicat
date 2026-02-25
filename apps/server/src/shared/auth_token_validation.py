from azure.functions import HttpRequest
import logging
import os
import json
from functools import lru_cache
import jwt.algorithms
import requests
import jwt
from jwt.algorithms import RSAAlgorithm
import uuid
from typing import Optional, Dict, Any

from .constants import (
    AZURE_AD_ISSUER_BASE, AZURE_AD_DISCOVERY_PATH
)

class TokenValidationError(Exception):
    """Custom exception for token validation errors"""
    pass

@lru_cache(maxsize=1)
def get_jwks() -> Optional[Dict[str, Any]]:
    """Fetch JWKS from Azure AD and cache it"""
    tenant_id = os.environ.get("AZURE_TENANT_ID")
    if not tenant_id:
        raise TokenValidationError("AZURE_TENANT_ID environment variable not set")

    jwks_uri = f"{AZURE_AD_ISSUER_BASE}/{tenant_id}{AZURE_AD_DISCOVERY_PATH}"
    correlation_id = str(uuid.uuid4())

    try:
        response = requests.get(jwks_uri, timeout=10)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        logging.error(f"[{correlation_id}] Failed to fetch JWKS: {str(e)}")
        raise TokenValidationError(f"Failed to fetch JWKS: {str(e)}")
    except Exception as e:
        logging.error(f"[{correlation_id}] Unexpected error fetching JWKS: {str(e)}")
        raise TokenValidationError(f"Unexpected error fetching JWKS: {str(e)}")

def get_rsa_public_key(token: str) -> Optional[jwt.algorithms.RSAAlgorithm]:
    """Get RSA key from JWKS based on token header"""
    correlation_id = str(uuid.uuid4())
    try:
        jwks = get_jwks()
        if not jwks or 'keys' not in jwks:
            logging.error(f"[{correlation_id}] JWKS is empty or does not contain keys")
            raise TokenValidationError("Invalid JWKS response")

        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get('kid')
        if not kid:
            logging.error(f"[{correlation_id}] Token header missing 'kid'")
            raise TokenValidationError("Invalid token header")

        # Find the key with matching kid
        for key in jwks['keys']:
            if key['kid'] == kid:
                return RSAAlgorithm.from_jwk(json.dumps(key))

        logging.error(f"[{correlation_id}] No matching key found for kid: {kid}")
        raise TokenValidationError("No matching key found")
    except Exception as e:
        logging.error(f"[{correlation_id}] Error extracting RSA public key: {str(e)}")
        raise TokenValidationError(f"Error extracting RSA public key: {str(e)}")

async def validate_token(req: HttpRequest) -> Optional[Dict[str, Any]]:
    """Validate JWT token from request header"""
    correlation_id = str(uuid.uuid4())
    logging.info(f"[{correlation_id}] Validating token")

    tenant_id = os.environ.get("AZURE_TENANT_ID")
    client_id = os.environ.get("AZURE_CLIENT_ID")

    if not tenant_id or not client_id:
        logging.error(f"[{correlation_id}] Missing required Azure AD environment variables")
        return None

    # Check for the presence of the 'Authorization' header (case-insensitive)
    auth_header = None
    for header_name, header_value in req.headers.items():
        if header_name.lower() == 'authorization':
            auth_header = header_value
            break

    if not auth_header or not auth_header.startswith('Bearer '):
        logging.warning(f"[{correlation_id}] Missing or invalid Authorization header")
        return None

    # Extract the token from the header
    token = auth_header.split(' ')[1]

    try:
        # Get the RSA public key from JWKS
        rsa_public_key = get_rsa_public_key(token)
        if not rsa_public_key:
            logging.error(f"[{correlation_id}] Failed to get RSA public key")
            return None

        # Decode and verify the JWT token
        decoded_token = jwt.decode(
            token,
            rsa_public_key,
            algorithms=['RS256'],
            audience=client_id,
            issuer=f"{AZURE_AD_ISSUER_BASE}/{tenant_id}/v2.0",
            options={
                'verify_aud': True,
                'verify_iss': True,
                'verify_exp': True,
                'verify_nbf': True
            }
        )

        logging.info(f"[{correlation_id}] Token validated successfully")
        return decoded_token

    except jwt.ExpiredSignatureError:
        logging.warning(f"[{correlation_id}] Token has expired")
        return None
    except jwt.InvalidTokenError as e:
        logging.error(f"[{correlation_id}] Invalid token: {str(e)}")
        return None
    except Exception as e:
        logging.error(f"[{correlation_id}] Unexpected error during token validation: {str(e)}")
        return None
