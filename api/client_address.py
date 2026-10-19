"""Trust platform-provided forwarding only inside the Vercel runtime."""
import ipaddress
import os


def client_address(request):
    if os.getenv('VERCEL') == '1':
        value = request.headers.get('x-vercel-forwarded-for') or request.headers.get('x-forwarded-for', '')
        # Multiple hops are not an authoritative single client address.
        try:
            address = ipaddress.ip_address(value.strip())
            return str(address.ipv4_mapped or address) if isinstance(address, ipaddress.IPv6Address) else str(address)
        except ValueError:
            pass
    host = request.client.host if request.client else 'unknown'
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        return 'unknown'
