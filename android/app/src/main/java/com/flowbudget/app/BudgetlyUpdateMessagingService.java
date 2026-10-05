package com.flowbudget.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import androidx.core.app.NotificationCompat;
import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class BudgetlyUpdateMessagingService extends MessagingService {
    @Override public void onMessageReceived(RemoteMessage message) {
        if (!"true".equals(message.getData().get("budgetlyUpdate"))) return;
        android.content.SharedPreferences preferences = getSharedPreferences("budgetly-update-push", 0);
        if (!preferences.getBoolean("enabled", false)) return;
        String version = message.getData().get("version");
        if (version == null || !version.matches("\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}")) return;
        if (version.equals(preferences.getString("last-version", ""))) return;
        try {
            String installed = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            String[] next = version.split("\\."), current = installed.split("\\.");
            boolean newer = false;
            for (int i = 0; i < 3; i++) {
                int left = Integer.parseInt(next[i]), right = Integer.parseInt(current[i]);
                if (left != right) { newer = left > right; break; }
            }
            if (!newer) return;
            NotificationManager manager = (NotificationManager)getSystemService(NOTIFICATION_SERVICE);
            manager.createNotificationChannel(new NotificationChannel("budgetly-updates", "App updates", NotificationManager.IMPORTANCE_DEFAULT));
            Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            PendingIntent action = PendingIntent.getActivity(this, 1500, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            if (!getSharedPreferences("budgetly-update-push", 0).getBoolean("enabled", false)) return;
            manager.notify(1500, new NotificationCompat.Builder(this, "budgetly-updates")
                .setSmallIcon(R.drawable.flowbudget_notification).setContentTitle("Budgetly " + version + " is available")
                .setContentText("Open Budgetly to review and install the update.").setAutoCancel(true).setContentIntent(action).build());
            preferences.edit().putString("last-version", version).apply();
        } catch (Exception ignored) { /* A push must never prevent the app from opening. */ }
    }
}
