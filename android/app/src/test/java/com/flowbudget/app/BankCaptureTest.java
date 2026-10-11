package com.flowbudget.app;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.StatusBarNotification;
import java.util.ArrayDeque;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.AbstractExecutorService;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class BankCaptureTest {
    private Context context;
    private SharedPreferences prefs;
    private ManualExecutor worker;
    private BankNotificationListenerService service;

    private static class CaptureService extends BankNotificationListenerService {
        CaptureService(ManualExecutor executor, Context context) {
            super(executor);
            attachBaseContext(context);
        }
    }

    private static class ManualExecutor extends AbstractExecutorService {
        final ArrayDeque<Runnable> tasks = new ArrayDeque<>();
        boolean stopped;
        public void execute(Runnable task) { tasks.add(task); }
        public void shutdown() { stopped = true; }
        public List<Runnable> shutdownNow() { shutdown(); return Collections.emptyList(); }
        public boolean isShutdown() { return stopped; }
        public boolean isTerminated() { return stopped && tasks.isEmpty(); }
        public boolean awaitTermination(long timeout, TimeUnit unit) { return isTerminated(); }
        void drain() { while (!tasks.isEmpty()) tasks.remove().run(); }
    }

    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        java.io.File database = new java.io.File(context.getNoBackupFilesDir(), "bank-notification-queue.db");
        android.database.sqlite.SQLiteDatabase.deleteDatabase(database);
        prefs = context.getSharedPreferences("bank_notifications", 0);
        prefs.edit().clear().putBoolean("enabled", true).putString("owner", "1")
            .putStringSet("packages", Collections.singleton("bank.app")).commit();
        worker = new ManualExecutor();
        service = new CaptureService(worker, context);
    }

    private StatusBarNotification alert(String source, String text, int flags) {
        Notification notification = new Notification();
        notification.flags = flags;
        notification.extras = new Bundle();
        notification.extras.putCharSequence(Notification.EXTRA_TITLE, "Payment");
        notification.extras.putCharSequence(Notification.EXTRA_TEXT, text);
        return new StatusBarNotification(source, source, 1, null, 1, 1, 0, notification,
            android.os.Process.myUserHandle(), System.currentTimeMillis());
    }

    private JSONArray pending(String owner) throws Exception {
        try (BankNotificationStore store = new BankNotificationStore(context)) { return store.pending(owner); }
    }

    @Test public void capturesRedactedPayloadAndDeduplicatesRepeatedNotification() throws Exception {
        StatusBarNotification alert = alert("bank.app", "Paid KWD 12 using 4111 1111 1111 1111", 0);
        service.onNotificationPosted(alert);
        service.onNotificationPosted(alert);
        worker.drain();
        JSONArray rows = pending("1");
        assertEquals(1, rows.length());
        JSONObject row = rows.getJSONObject(0);
        assertEquals("Paid KWD 12 using [redacted]", row.getString("text"));
        assertEquals("", row.getString("bigText"));
        assertEquals("bank.app", row.getString("appLabel"));
        assertTrue(row.getString("contentHash").matches("[a-f0-9]{64}"));
        assertEquals(0, pending("2").length());
        assertFalse(prefs.getBoolean("captureError", false));
    }

    @Test public void rejectsSecurityMessagesAndOversizedContentBeforeDispatch() {
        for (String text : new String[]{"OTP 123456 payment KWD 10", "Your password changed",
                "\u0631\u0645\u0632 \u0627\u0644\u062a\u062d\u0642\u0642 123456", String.join("", Collections.nCopies(8001, "x"))}) {
            service.onNotificationPosted(alert("bank.app", text, 0));
        }
        assertTrue(worker.tasks.isEmpty());
    }

    @Test public void rejectsUnapprovedSourcesSummariesAndDisabledCapture() {
        service.onNotificationPosted(alert("other.app", "Paid 10", 0));
        service.onNotificationPosted(alert("bank.app", "Paid 10", Notification.FLAG_GROUP_SUMMARY));
        prefs.edit().putBoolean("enabled", false).commit();
        service.onNotificationPosted(alert("bank.app", "Paid 10", 0));
        assertTrue(worker.tasks.isEmpty());
    }

    @Test public void rechecksAllConsentFieldsAfterDispatch() throws Exception {
        for (int change = 0; change < 3; change++) {
            setup();
            service.onNotificationPosted(alert("bank.app", "Paid 10", 0));
            assertEquals(1, worker.tasks.size());
            if (change == 0) prefs.edit().putBoolean("enabled", false).commit();
            if (change == 1) prefs.edit().putString("owner", "2").commit();
            if (change == 2) prefs.edit().putStringSet("packages", Collections.emptySet()).commit();
            worker.drain();
            assertEquals(0, pending("1").length());
            assertEquals(0, pending("2").length());
        }
    }
}
