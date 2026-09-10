"""Public identity of the Android release, never a private signing key."""
import base64

ANDROID_RP_ID = 'budget-planner-ecru-seven.vercel.app'
ANDROID_PACKAGE = 'com.flowbudget.app'
ANDROID_CERT_SHA256 = '8C:C5:1F:67:27:AC:1B:15:DF:DF:13:A9:93:E9:0B:95:86:97:EA:B5:1F:64:EF:AD:DF:24:58:10:3A:9F:E5:94'
ANDROID_ORIGIN = 'android:apk-key-hash:' + base64.urlsafe_b64encode(bytes.fromhex(ANDROID_CERT_SHA256.replace(':', ''))).decode().rstrip('=')

def asset_links():
    return [{'relation': ['delegate_permission/common.get_login_creds'], 'target': {
        'namespace': 'android_app', 'package_name': ANDROID_PACKAGE,
        'sha256_cert_fingerprints': [ANDROID_CERT_SHA256],
    }}]
