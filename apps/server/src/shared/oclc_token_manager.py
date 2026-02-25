import os
import logging
from typing import Dict, Any, Optional
import uuid
from datetime import datetime, timedelta

import requests
from requests.auth import HTTPBasicAuth

from .constants import (
    OCLC_OAUTH_URL, OCLC_OAUTH_SCOPE, ERROR_MESSAGES
)

class OCLCTokenManager:
    """
    Token manager that handles OCLC access tokens with caching and retry mechanism.
    Implements token caching, usage tracking, and quota management.
    """
    def __init__(self):
        self.wskey = os.environ.get('OCLC_WSKEY')
        self.secret = os.environ.get('OCLC_SECRET')
        self._correlation_id = str(uuid.uuid4())
        self._current_token: Optional[Dict[str, Any]] = None
        self._token_expiry: Optional[datetime] = None
        self._max_retries = 3
        self._retry_delay = 1  # seconds

        if not self.wskey or not self.secret:
            raise ValueError(ERROR_MESSAGES['MISSING_CREDENTIALS'])

    def get_shared_token(self) -> str:
        """Get a valid access token, reusing existing token if possible"""
        try:
            # Check if we have a valid token
            if self._is_token_valid():
                return self._current_token['access_token']

            # Try to get a new token with retries
            for attempt in range(self._max_retries):
                try:
                    token_data = self._request_new_token()
                    self._current_token = token_data
                    # Set expiry time (subtract 5 minutes as buffer)
                    self._token_expiry = datetime.now() + timedelta(seconds=token_data.get('expires_in', 3600) - 300)
                    return token_data['access_token']
                except requests.exceptions.RequestException as e:
                    if attempt == self._max_retries - 1:
                        raise
                    logging.warning(f"[{self._correlation_id}] Token request failed (attempt {attempt + 1}/{self._max_retries}): {str(e)}")
                    import time
                    time.sleep(self._retry_delay * (attempt + 1))  # Exponential backoff

        except Exception as e:
            logging.error(f"[{self._correlation_id}] Failed to get token: {str(e)}")
            raise

    def _is_token_valid(self) -> bool:
        """Check if current token is valid and not expired"""
        if not self._current_token or not self._token_expiry:
            return False
        return datetime.now() < self._token_expiry

    def _request_new_token(self) -> Dict[str, Any]:
        """Request a new token from OCLC"""
        data = {
            'grant_type': 'client_credentials',
            'scope': OCLC_OAUTH_SCOPE
        }
        response = requests.post(
            OCLC_OAUTH_URL,
            data=data,
            auth=HTTPBasicAuth(self.wskey, self.secret)
        )
        response.raise_for_status()
        return response.json()

    def can_make_request(self) -> bool:
        """Check if we can make a new request based on token validity"""
        return self._is_token_valid()
