package com.flowbudget.app;

import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;

@CapacitorPlugin(name="BankNotifications")
public class BankNotificationsPlugin extends Plugin {
    private SharedPreferences prefs() { return getContext().getSharedPreferences("bank_notifications", 0); }
    private String owner(PluginCall call) {
        String value = call.getString("owner", "");
        return value.matches("[0-9]+") ? value : "";
    }
    @PluginMethod public void isNotificationAccessGranted(PluginCall call) {
        String enabled = Settings.Secure.getString(getContext().getContentResolver(), "enabled_notification_listeners");
        ComponentName component = new ComponentName(getContext(), BankNotificationListenerService.class);
        boolean granted = false;
        if (enabled != null) for (String name : enabled.split(":")) if (component.equals(ComponentName.unflattenFromString(name))) granted = true;
        JSObject result = new JSObject(); result.put("granted", granted); call.resolve(result);
    }
    @PluginMethod public void openNotificationAccessSettings(PluginCall call) {
        try { getActivity().startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); call.resolve(); }
        catch (Exception failure) { call.reject("Open Android Settings > Special app access > Notification access."); }
    }
    @PluginMethod public void setAllowedPackages(PluginCall call) {
        String owner = owner(call);
        if (owner.isEmpty()) { call.reject("Sign in before selecting bank apps"); return; }
        try {
            JSArray input = call.getArray("packages", new JSArray());
            Set<String> packages = new HashSet<>();
            if (input.length() > 30) { call.reject("Select no more than 30 apps"); return; }
            for (int i=0; i<input.length(); i++) {
                String name = input.getString(i);
                if (name.equals(getContext().getPackageName()) && !BuildConfig.DEBUG) continue;
                getContext().getPackageManager().getApplicationInfo(name, 0);
                packages.add(name);
            }
            prefs().edit().putString("owner", owner).putStringSet("packages", packages).putBoolean("enabled", !packages.isEmpty()).commit();
            android.service.notification.NotificationListenerService.requestRebind(new ComponentName(getContext(), BankNotificationListenerService.class));
            call.resolve();
        } catch (Exception failure) { call.reject("An app is unavailable. Refresh the installed app list."); }
    }
    @PluginMethod public void getAllowedPackages(PluginCall call) {
        boolean same = owner(call).equals(prefs().getString("owner", ""));
        JSObject result = new JSObject(); result.put("packages", new JSArray(same ? prefs().getStringSet("packages", java.util.Collections.emptySet()) : java.util.Collections.emptySet()));
        result.put("enabled", same && prefs().getBoolean("enabled", false));
        result.put("queueFull", same && prefs().getBoolean("queueFull", false));
        result.put("captureError", same && prefs().getBoolean("captureError", false)); call.resolve(result);
    }
    @PluginMethod public void getInstalledCandidateApps(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_MAIN); intent.addCategory(Intent.CATEGORY_LAUNCHER);
        JSArray apps = new JSArray(); Set<String> seen = new HashSet<>();
        if (BuildConfig.DEBUG) {
            JSObject synthetic = new JSObject(); synthetic.put("packageName", getContext().getPackageName()); synthetic.put("label", "Synthetic Bank (debug only)"); apps.put(synthetic);
        }
        for (ResolveInfo info : getContext().getPackageManager().queryIntentActivities(intent, 0)) {
            String name = info.activityInfo.packageName;
            if (name.equals(getContext().getPackageName()) || !seen.add(name)) continue;
            JSObject row = new JSObject(); row.put("packageName", name); row.put("label", info.loadLabel(getContext().getPackageManager()).toString()); apps.put(row);
        }
        JSObject result = new JSObject(); result.put("apps", apps); call.resolve(result);
    }
    @PluginMethod public void getPendingNotifications(PluginCall call) {
        String owner = owner(call);
        if (owner.isEmpty()) { call.reject("Sign in to read your bank inbox"); return; }
        try (BankNotificationStore store = new BankNotificationStore(getContext())) {
            JSObject result = new JSObject(); result.put("notifications", new JSArray(store.pending(owner).toString())); call.resolve(result);
        } catch (Exception failure) { call.reject("Unable to read queued bank alerts; please retry."); }
    }
    @PluginMethod public void removeNotifications(PluginCall call) {
        String owner = owner(call);
        if (owner.isEmpty()) { call.reject("Sign in to acknowledge bank alerts"); return; }
        try (BankNotificationStore store = new BankNotificationStore(getContext())) {
            store.remove(owner, call.getArray("ids", new JSArray()));
            prefs().edit().putBoolean("queueFull", false).putBoolean("captureError", false).apply(); call.resolve();
        } catch (Exception failure) { call.reject("Unable to acknowledge bank alerts; they remain queued."); }
    }
    @PluginMethod public void suspend(PluginCall call) { prefs().edit().putBoolean("enabled", false).commit(); call.resolve(); }
    @PluginMethod public void bindSession(PluginCall call) {
        String account = owner(call);
        boolean resume = !account.isEmpty() && account.equals(prefs().getString("owner", "")) && !prefs().getStringSet("packages", java.util.Collections.emptySet()).isEmpty();
        prefs().edit().putBoolean("enabled", resume).commit();
        if (resume) android.service.notification.NotificationListenerService.requestRebind(new ComponentName(getContext(), BankNotificationListenerService.class));
        call.resolve();
    }
}
