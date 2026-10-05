"""Safe provider diagnostics: never log response bodies, keys or record context."""
import logging
import httpx

logger = logging.getLogger(__name__)
QUOTA_CODES = frozenset({
    'insufficient_quota', 'credit_balance_exhausted', 'organization_spend_limit_exceeded',
    'project_spend_limit_exceeded', 'organization_usage_limit_exceeded',
})
KNOWN_CODES = QUOTA_CODES | {'invalid_api_key', 'model_not_found', 'rate_limit_exceeded',
                            'slow_down', 'ip_not_authorized', 'server_is_overloaded'}
MESSAGES = {
    'quota': 'OpenAI API credits or a spending/usage limit prevent AI requests. Check the OpenAI project billing and limits; retrying will not resolve this.',
    'authentication': 'OpenAI rejected the server API key. Check the Production key in Vercel and redeploy after replacing it.',
    'access': 'The OpenAI project does not permit this request. Check model permissions and project access.',
    'rate_limit': 'OpenAI is temporarily limiting requests. Wait before trying again.',
    'timeout': 'The OpenAI request timed out. Try again shortly.',
    'connection': 'The server could not connect securely to OpenAI. Check server connectivity and certificates.',
    'upstream': 'OpenAI returned a temporary service error. Try again shortly.',
    'request': 'OpenAI rejected the request format. Check the server integration.',
    'response': 'OpenAI returned an unreadable or empty response. Try again or check the server integration.',
}


def provider_failure(error):
    status, code, reason = None, None, 'response'
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        try:
            body = error.response.json()
            details = body.get('error') if isinstance(body, dict) else None
            if isinstance(details, dict):
                for candidate in (details.get('code'), details.get('type')):
                    if isinstance(candidate, str) and candidate in KNOWN_CODES:
                        code = candidate
                        break
        except (ValueError, TypeError):
            pass
        if status == 429:
            reason = 'quota' if code in QUOTA_CODES else 'rate_limit'
        elif status == 401:
            reason = 'authentication'
        elif status == 403 or code == 'model_not_found':
            reason = 'access'
        elif status >= 500:
            reason = 'upstream'
        else:
            reason = 'request'
    elif isinstance(error, httpx.TimeoutException):
        reason = 'timeout'
    elif isinstance(error, httpx.HTTPError):
        reason = 'connection'
    result = {'ok': False, 'reason': reason, 'http_status': status, 'provider_code': code,
              'message': MESSAGES[reason]}
    # Only allowlisted, fixed diagnostics reach production logs.
    logger.warning('budgetly_ai_provider_failure reason=%s http_status=%s provider_code=%s', reason, status, code)
    return result


def user_notice(failure):
    if failure['reason'] in {'quota', 'authentication', 'access', 'request'}:
        return 'AI needs administrator attention. Using built-in guidance for now.'
    return 'AI currently unavailable. Using built-in guidance.'
