package com.flowbudget.app;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

@CapacitorPlugin(name = "BudgetlyReminders")
public class BudgetlyRemindersPlugin extends Plugin {
    static final String PREFS = "budgetly_reminders";
    static final String CHANNEL_ID = "budgetly-reminders";
    static final int ALARM_ID = 39001;

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        Context context = getContext();
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (!enabled) {
            cancel(context);
            prefs(context).edit().clear().apply();
            call.resolve();
            return;
        }

        String body = call.getString("body", "");
        String firstAt = call.getString("firstAt", "");
        JSArray times = call.getArray("times");
        if (body == null || body.trim().isEmpty() || firstAt == null || firstAt.isEmpty() || times == null || times.length() == 0) {
            call.reject("Invalid reminder schedule");
            return;
        }

        long trigger;
        try {
            trigger = parseIso(firstAt);
        } catch (ParseException e) {
            call.reject("Invalid reminder time");
            return;
        }
        ensureChannel(context);
        prefs(context).edit()
                .putBoolean("enabled", true)
                .putString("body", body)
                .putString("times", times.toString())
                .apply();
        schedule(context, Math.max(trigger, System.currentTimeMillis() + 1000));
        call.resolve();
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Transaction reminders", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Budgetly reminders to review your budget activity");
        manager.createNotificationChannel(channel);
    }

    static void schedule(Context context, long triggerAt) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        Intent intent = new Intent(context, BudgetlyReminderReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(context, ALARM_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        manager.cancel(pending);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && manager.canScheduleExactAlarms()) {
            manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pending);
        } else {
            manager.set(AlarmManager.RTC_WAKEUP, triggerAt, pending);
        }
    }

    static void cancel(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        Intent intent = new Intent(context, BudgetlyReminderReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(context, ALARM_ID, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        manager.cancel(pending);
    }

    static SharedPreferences preferences(Context context) {
        return prefs(context);
    }

    private static int immutableFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private static long parseIso(String value) throws ParseException {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        Date date = format.parse(value);
        if (date == null) throw new ParseException(value, 0);
        return date.getTime();
    }
}
