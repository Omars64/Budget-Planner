import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ANDROID = '{http://schemas.android.com/apk/res/android}'

def test_native_app_has_no_sms_capture_and_only_explicit_notification_access():
    manifest = ET.parse(ROOT / 'android/app/src/main/AndroidManifest.xml').getroot()
    permissions = {p.get(ANDROID + 'name') for p in manifest.findall('uses-permission')}
    assert {'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS'} <= permissions
    assert not permissions & {
        'android.permission.READ_SMS', 'android.permission.RECEIVE_SMS',
        'android.permission.SEND_SMS', 'android.permission.READ_CALL_LOG',
        'android.permission.WRITE_CALL_LOG',
    }
    receivers = manifest.findall('.//receiver')
    assert [receiver.get(ANDROID + 'name') for receiver in receivers] == ['.BudgetlyReminderReceiver']
    services = [service for service in manifest.findall('.//service') if service.get('{http://schemas.android.com/tools}node') != 'remove']
    assert {service.get(ANDROID + 'name') for service in services} == {'.BudgetlyUpdateMessagingService', '.BankNotificationListenerService'}
    listener = next(service for service in services if service.get(ANDROID + 'name') == '.BankNotificationListenerService')
    assert listener.get(ANDROID + 'exported') == 'true'
    assert listener.get(ANDROID + 'permission') == 'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE'
    assert listener.find('intent-filter/action').get(ANDROID + 'name') == 'android.service.notification.NotificationListenerService'
    assert all(service.get(ANDROID + 'exported') == 'false' for service in services if service is not listener)
    assert manifest.find('application').get(ANDROID + 'allowBackup') == 'false'
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
