package com.flowbudget.app;

import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Bundle;

/** Debug-only synthetic bank. No real bank account or personal notification needed. */
public class FakeBankNotificationActivity extends Activity {
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("fake-bank", "Synthetic bank alerts", NotificationManager.IMPORTANCE_DEFAULT));
        Notification notification = new Notification.Builder(this, "fake-bank")
            .setSmallIcon(com.flowbudget.app.R.drawable.flowbudget_notification).setContentTitle("Synthetic Bank")
            .setContentText("Your card ending 4821 was used for KWD 6.750 at TALABAT.").build();
        manager.notify(4821, notification);
        finish();
    }
}
