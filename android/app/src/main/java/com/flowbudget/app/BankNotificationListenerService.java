package com.flowbudget.app;

import android.app.Notification;
import android.os.Bundle;
import android.content.SharedPreferences;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

public class BankNotificationListenerService extends NotificationListenerService {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private static final Pattern SECURITY = Pattern.compile("\\b(otp|one[- ]time|verification code|authentication code|security code|password|passcode|login attempt|do not share|pin)\\b|رمز\\s*(التحقق|التفعيل)|كلمة\\s*المرور", Pattern.CASE_INSENSITIVE);
    private static String safe(CharSequence value) {
        if (value == null) return "";
        return value.toString().replaceAll("(?<!\\p{Nd})(?:\\p{Nd}[ -]?){12,19}(?!\\p{Nd})", "[redacted]");
    }
    @Override public void onNotificationPosted(StatusBarNotification sbn) {
        SharedPreferences prefs = getSharedPreferences("bank_notifications", MODE_PRIVATE);
        String owner = prefs.getString("owner", "");
        String source = sbn.getPackageName();
        if (!prefs.getBoolean("enabled", false) || owner.isEmpty() || !prefs.getStringSet("packages", java.util.Collections.emptySet()).contains(source)) return;
        if ((sbn.getNotification().flags & Notification.FLAG_GROUP_SUMMARY) != 0) return;
        Bundle extras = sbn.getNotification().extras;
        if (extras == null) return;
        CharSequence title = extras.getCharSequence(Notification.EXTRA_TITLE);
        CharSequence text = extras.getCharSequence(Notification.EXTRA_TEXT);
        CharSequence big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        CharSequence sub = extras.getCharSequence(Notification.EXTRA_SUB_TEXT);
        String content = String.valueOf(title) + " " + text + " " + big + " " + sub;
        // Drop security alerts before persistence, including mixed OTP/payment text.
        if (SECURITY.matcher(content).find() || content.length() > 8000) return;
        final String capturedTitle = safe(title), capturedText = safe(text), capturedBig = safe(big), capturedSub = safe(sub);
        final long postedAt = sbn.getPostTime();
        final String notificationKey = sbn.getKey();
        worker.execute(() -> {
            try {
                // Recheck consent after asynchronous dispatch or sign-out.
                if (!prefs.getBoolean("enabled", false) || !owner.equals(prefs.getString("owner", "")) || !prefs.getStringSet("packages", java.util.Collections.emptySet()).contains(source)) return;
                String input = source + "|" + postedAt + "|" + capturedTitle + "|" + capturedText + "|" + capturedBig;
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(input.getBytes(StandardCharsets.UTF_8));
                StringBuilder hash = new StringBuilder();
                for (byte value : digest) hash.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
                JSONObject row = new JSONObject();
                row.put("id", UUID.randomUUID().toString()); row.put("contentHash", hash.toString());
                row.put("packageName", source); row.put("postedAt", postedAt); row.put("notificationKey", notificationKey);
                row.put("title", capturedTitle); row.put("text", capturedText); row.put("bigText", capturedBig); row.put("subText", capturedSub);
                try { row.put("appLabel", getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(source, 0)).toString()); }
                catch (Exception unavailable) { row.put("appLabel", source); }
                try (BankNotificationStore store = new BankNotificationStore(this)) {
                    if (!store.add(owner, row)) prefs.edit().putBoolean("queueFull", true).apply();
                }
            } catch (Exception failure) { prefs.edit().putBoolean("captureError", true).apply(); }
        });
    }
    @Override public void onDestroy() { worker.shutdown(); super.onDestroy(); }
}
