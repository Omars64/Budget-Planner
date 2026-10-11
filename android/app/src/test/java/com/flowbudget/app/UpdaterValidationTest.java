package com.flowbudget.app;

import android.content.pm.PackageInfo;
import android.content.pm.Signature;
import java.util.Collections;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class UpdaterValidationTest {
    private final BudgetlyUpdaterPlugin updater = new BudgetlyUpdaterPlugin();
    private static final String RELEASE = "https://github.com/Omars64/Budget-Planner/releases/download/v1.2.3/Budgetly.apk";

    @Test public void acceptsOfficialReleaseAndAssetRedirects() throws Exception {
        assertEquals(RELEASE, updater.allowedUri(RELEASE, true).toString());
        for (String host : new String[]{"github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}) {
            updater.allowedUri("https://" + host + "/asset?token=signed", false);
        }
    }
    @Test public void rejectsUntrustedOrAmbiguousReleaseAddresses() {
        for (String url : new String[]{RELEASE.replace("https:", "http:"), RELEASE.replace("github.com", "github.com.evil.test"),
                RELEASE.replace("github.com", "user@github.com"), RELEASE.replace("github.com", "github.com:443"),
                RELEASE + "?token=1", RELEASE + "#fragment", RELEASE.replace("Omars64", "someone"),
                RELEASE.replace("v1.2.3", "../v1.2.3"), RELEASE.replace("v1.2.3", "v1%2Fextra"),
                RELEASE.replace("Budgetly.apk", "nested/Budgetly.apk"), RELEASE.replace(".apk", ".zip")}) {
            assertThrows(url, Exception.class, () -> updater.allowedUri(url, true));
        }
        assertThrows(Exception.class, () -> updater.allowedUri("https://evil.test/asset", false));
        assertThrows(Exception.class, () -> updater.allowedUri("http://objects.githubusercontent.com/asset", false));
    }
    @Test public void requiresNonemptySigningCertificatesAndComparesSignerSets() throws Exception {
        assertThrows(Exception.class, () -> updater.signers(null));
        PackageInfo info = new PackageInfo();
        assertThrows(Exception.class, () -> updater.signers(info));
        info.signatures = new Signature[0];
        assertThrows(Exception.class, () -> updater.signers(info));
        info.signatures = new Signature[]{new Signature(new byte[]{1, 2, 3})};
        assertEquals(Collections.singleton("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81"), updater.signers(info));
    }
    @Test public void metadataRequiresPositiveBoundedJsonIntegers() {
        assertEquals(Long.valueOf(1), UpdateNumbers.positiveInteger(1, 10));
        assertEquals(Long.valueOf(10), UpdateNumbers.positiveInteger(10L, 10));
        for (Object value : new Object[]{null, "1", 1.0, Float.valueOf(1), true, 0, -1L, 11L, Long.MAX_VALUE}) {
            assertNull(UpdateNumbers.positiveInteger(value, 10));
        }
    }

    private PackageInfo apk(String name, int version, byte signer) {
        PackageInfo info = new PackageInfo();
        info.packageName = name;
        info.versionCode = version;
        info.signatures = new Signature[]{new Signature(new byte[]{signer})};
        return info;
    }

    @Test public void identityRequiresSamePackageExactNewerVersionAndSameSigner() throws Exception {
        PackageInfo installed = apk("com.flowbudget.app", 10, (byte) 1);
        updater.verifyIdentity(installed, apk(installed.packageName, 11, (byte) 1), 11);
        assertThrows(Exception.class, () -> updater.verifyIdentity(installed, null, 11));
        assertThrows(Exception.class, () -> updater.verifyIdentity(installed, apk("other.app", 11, (byte) 1), 11));
        assertThrows(Exception.class, () -> updater.verifyIdentity(installed, apk(installed.packageName, 12, (byte) 1), 11));
        assertThrows(Exception.class, () -> updater.verifyIdentity(installed, apk(installed.packageName, 10, (byte) 1), 10));
        assertThrows(Exception.class, () -> updater.verifyIdentity(installed, apk(installed.packageName, 9, (byte) 1), 9));
        assertThrows(Exception.class, () -> updater.verifyIdentity(installed, apk(installed.packageName, 11, (byte) 2), 11));
        PackageInfo multiple = apk(installed.packageName, 11, (byte) 1);
        multiple.signatures = new Signature[]{multiple.signatures[0], new Signature(new byte[]{2})};
        assertThrows(Exception.class, () -> updater.verifyIdentity(installed, multiple, 11));
    }
}
