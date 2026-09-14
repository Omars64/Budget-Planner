package com.flowbudget.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.os.Build;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;

import java.util.Calendar;
import java.util.TimeZone;

public class BudgetlyReminderReceiver extends BroadcastReceiver {
    private static final int NOTIFICATION_ID = 39002;
    private static final TimeZone KUWAIT = TimeZone.getTimeZone("Asia/Kuwait");

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = BudgetlyRemindersPlugin.preferences(context);
        if (!prefs.getBoolean("enabled", false)) return;

        String action = intent == null ? null : intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            long next = nextTrigger(prefs.getString("times", "[]"), System.currentTimeMillis());
            if (next > 0) BudgetlyRemindersPlugin.schedule(context, next);
            return;
        }

        BudgetlyRemindersPlugin.ensureChannel(context);
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent content = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            content = PendingIntent.getActivity(context, NOTIFICATION_ID, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, BudgetlyRemindersPlugin.CHANNEL_ID)
                .setSmallIcon(com.flowbudget.app.R.drawable.flowbudget_notification)
                .setLargeIcon(BitmapFactory.decodeResource(context.getResources(), com.flowbudget.app.R.drawable.flowbudget_logo))
                .setColor(Color.rgb(10, 65, 115))
                .setContentTitle("Budgetly")
                .setContentText(prefs.getString("body", "Take a moment to review your budget activity."))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setDefaults(Notification.DEFAULT_ALL);
        if (content != null) builder.setContentIntent(content);
        manager.notify(NOTIFICATION_ID, builder.build());

        long next = nextTrigger(prefs.getString("times", "[]"), System.currentTimeMillis());
        if (next > 0) BudgetlyRemindersPlugin.schedule(context, next);
    }

    private static long nextTrigger(String encodedTimes, long now) {
        try {
            JSONArray times = new JSONArray(encodedTimes);
            Calendar current = Calendar.getInstance(KUWAIT);
            current.setTimeInMillis(now);
            long result = Long.MAX_VALUE;
            for (int i = 0; i < times.length(); i++) {
                String[] parts = times.getString(i).split(":");
                int hour = Integer.parseInt(parts[0]);
                int minute = Integer.parseInt(parts[1]);
                Calendar candidate = (Calendar) current.clone();
                candidate.set(Calendar.HOUR_OF_DAY, hour);
                candidate.set(Calendar.MINUTE, minute);
                candidate.set(Calendar.SECOND, 0);
                candidate.set(Calendar.MILLISECOND, 0);
                if (candidate.getTimeInMillis() <= now) candidate.add(Calendar.DAY_OF_YEAR, 1);
                result = Math.min(result, candidate.getTimeInMillis());
            }
            return result == Long.MAX_VALUE ? 0 : result;
        } catch (Exception ignored) {
            return 0;
        }
    }

    private static int immutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    }
}
