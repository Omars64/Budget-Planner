package com.flowbudget.app;

import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import com.google.firebase.messaging.RemoteMessage;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class UpdatePushTest {
    private BudgetlyUpdateMessagingService service;
    private SharedPreferences prefs;
    private NotificationManager manager;
    @Before public void setup() {
        service = Robolectric.buildService(BudgetlyUpdateMessagingService.class).create().get();
        prefs = service.getSharedPreferences("budgetly-update-push", 0);
        prefs.edit().clear().putBoolean("enabled", true).commit();
        manager = (NotificationManager) service.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.cancelAll();
        PackageInfo installed = new PackageInfo();
        installed.packageName = service.getPackageName();
        installed.versionName = "1.2.3";
        Shadows.shadowOf(service.getPackageManager()).installPackage(installed);
    }
    private RemoteMessage update(String version, boolean test) {
        return new RemoteMessage.Builder("device").addData(test ? "budgetlyUpdateTest" : "budgetlyUpdate", "true")
            .addData("version", version).build();
    }
    @Test public void postsNewerVersionOnceAndRecordsDelivery() {
        service.onMessageReceived(update("1.10.0", false));
        assertNotNull(Shadows.shadowOf(manager).getNotification(1500));
        assertEquals("1.10.0", prefs.getString("last-version", ""));
        manager.cancelAll();
        service.onMessageReceived(update("1.10.0", false));
        assertEquals(0, Shadows.shadowOf(manager).size());
    }
    @Test public void ignoresDisabledMalformedEqualAndOlderUpdates() {
        for (String version : new String[]{"1.2.3", "1.2.2", "0.99.99", "invalid", "1.2.3.4"}) {
            service.onMessageReceived(update(version, false));
        }
        prefs.edit().putBoolean("enabled", false).commit();
        service.onMessageReceived(update("2.0.0", false));
        assertEquals(0, Shadows.shadowOf(manager).size());
        assertFalse(prefs.contains("last-version"));
    }
    @Test public void testPushBypassesVersionComparisonWithoutRecordingDelivery() {
        service.onMessageReceived(update("1.0.0", true));
        assertNotNull(Shadows.shadowOf(manager).getNotification(1501));
        assertFalse(prefs.contains("last-version"));
    }
    @Test public void scheduledPushRequiresSeparateConsentAndValidEvent() {
        RemoteMessage valid = new RemoteMessage.Builder("device").addData("budgetlyScheduled", "true")
            .addData("event", "123").addData("body", "Entry recorded").build();
        service.onMessageReceived(valid);
        assertEquals(0, Shadows.shadowOf(manager).size());
        prefs.edit().putBoolean("scheduled", true).putBoolean("enabled", false).commit();
        service.onMessageReceived(new RemoteMessage.Builder("device").addData("budgetlyScheduled", "true")
            .addData("event", "invalid").build());
        assertEquals(0, Shadows.shadowOf(manager).size());
        service.onMessageReceived(valid);
        assertEquals(1, Shadows.shadowOf(manager).size());
    }
}
