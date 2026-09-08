import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ANDROID = '{http://schemas.android.com/apk/res/android}'

def test_native_app_has_no_sms_capture_or_cross_app_services():
    manifest = ET.parse(ROOT / 'android/app/src/main/AndroidManifest.xml').getroot()
    permissions = {p.get(ANDROID + 'name') for p in manifest.findall('uses-permission')}
    assert permissions == {'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'}
    assert not manifest.findall('.//receiver')
    assert not manifest.findall('.//service')
    source = ROOT / 'android/app/src/main/java/com/flowbudget/app'
    assert not (source / 'BankSmsReceiver.java').exists()
    plugin = (source / 'BankSmsPlugin.java').read_text()
    assert 'requestPermission' not in plugin
    assert '.remove(' not in plugin and '.clear(' not in plugin

def test_site_denies_capture_and_framing_but_allows_first_party_passkeys():
    config = json.loads((ROOT / 'vercel.json').read_text())
    headers = {h['key']:h['value'] for h in config['headers'][0]['headers']}
    assert headers['X-Frame-Options'] == 'DENY'
    for directive in ['camera=()', 'microphone=()', 'display-capture=()', 'otp-credentials=()', 'publickey-credentials-create=(self)', 'publickey-credentials-get=(self)']:
        assert directive in headers['Permissions-Policy']
