"""Conservative suggestions, never automatic ledger entries."""
import re
from .currency import CURRENCY_CODES
from datetime import datetime

DIGITS=str.maketrans('\u0660\u0661\u0662\u0663\u0664\u0665\u0666\u0667\u0668\u0669\u066b\u066c','0123456789.,')


def suggest(text,currency='KWD'):
    text=text.translate(DIGITS)
    result={'amount':'','description':'','date':'','warnings':[]}
    if re.search(r'\b(refund|salary|credited|transfer)\b|\u0631\u0627\u062a\u0628|\u062a\u062d\u0648\u064a\u0644|\u0625\u064a\u062f\u0627\u0639',text,re.I):
        result['warnings'].append('This may be income, a refund or transfer. Check the type in Transactions before recording.')
    aliases={'KWD':r'KWD|KD|\u062f\.?\u0643\.?','USD':r'USD|\$','EUR':r'EUR|\u20ac','GBP':r'GBP|\u00a3','INR':r'INR|\u20b9'}
    symbol=aliases.get(currency,re.escape(currency))
    foreign={code.upper() for code in re.findall(r'\b[A-Z]{3}\b',text,re.I)} & CURRENCY_CODES - {currency}
    if foreign:result['warnings'].append('This alert mentions a different currency. Amounts are not exchange-converted; review before recording.')
    amounts=re.findall(rf'(?:{symbol})\s*([\d,]+(?:\.\d{{1,3}})?)',text,re.I) if not foreign else []
    if not amounts and not foreign:amounts=re.findall(rf'([\d,]+(?:\.\d{{1,3}})?)\s*(?:{symbol})',text,re.I)
    if len(amounts)==1:result['amount']=amounts[0].replace(',','')
    elif amounts:result['warnings'].append('Multiple amounts found. Enter the purchase amount, not the balance.')
    merchant=re.search(r'(?:\bat\s+|\u0644\u062f\u0649\s+)([^\n,;]{2,100}?)(?=\s+(?:on|using|card|balance)\b|[\n,;]|$)',text,re.I)
    if merchant:result['description']=merchant.group(1).strip()
    stamp=re.search(r'\b(20\d\d-\d\d-\d\d)[ T](\d\d:\d\d)\b',text)
    if stamp:
        try:result['date']=datetime.fromisoformat(stamp.group(1)+'T'+stamp.group(2)).isoformat(timespec='minutes')
        except ValueError:pass
    if not result['date']:result['warnings'].append('Check the transaction date and time against the original alert.')
    return result
