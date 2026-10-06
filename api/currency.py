"""Shared account currency catalog; changing currency is not exchange conversion."""
import json
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP

_data=json.loads((Path(__file__).resolve().parent.parent/'currencies.json').read_text(encoding='utf-8'))
CURRENCY_CODES=frozenset(_data['codes'])

def currency_digits(code):
    return _data['fractionDigits'].get(code,2)

def currency_number(value,code):
    digits=currency_digits(code)
    rounded=Decimal(str(value)).quantize(Decimal(1).scaleb(-digits),rounding=ROUND_HALF_UP)
    return f'{rounded:,.{digits}f}'

def currency_amount(value,code):
    return f'{code} {currency_number(value,code)}'
