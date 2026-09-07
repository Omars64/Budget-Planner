package com.flowbudget.app;

import android.Manifest;
import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(name="BankSms", permissions={@Permission(alias="sms", strings={Manifest.permission.RECEIVE_SMS})})
public class BankSmsPlugin extends Plugin {
    private SharedPreferences prefs() { return getContext().getSharedPreferences("bank_sms", 0); }
    @PluginMethod public void configure(PluginCall call) {
        if (call.getBoolean("enabled", false) && getPermissionState("sms") != PermissionState.GRANTED) {
            requestPermissionForAlias("sms", call, "permissionResult"); return;
        }
        save(call);
    }
    @PermissionCallback private void permissionResult(PluginCall call) {
        if (getPermissionState("sms") != PermissionState.GRANTED) { call.reject("SMS permission was denied"); return; }
        save(call);
    }
    private void save(PluginCall call) {
        String owner = call.getString("owner", "");
        boolean enabled = call.getBoolean("enabled", false);
        if (enabled && owner.isEmpty()) { call.reject("Sign in first"); return; }
        String rules = call.getArray("rules", new JSArray()).toString();
        prefs().edit().putString("owner", owner).putBoolean("enabled", enabled).putString("rules", rules).apply();
        call.resolve();
    }
    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject();
        boolean owner = prefs().getString("owner", "").equals(call.getString("owner", ""));
        result.put("enabled", owner && prefs().getBoolean("enabled", false));
        try { result.put("rules", new JSArray(owner ? prefs().getString("rules", "[]") : "[]")); }
        catch (Exception e) { call.reject("Unable to read sender settings"); return; }
        call.resolve(result);
    }
    @PluginMethod public void pending(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("messages", new JSArray(prefs().getString("queue_"+call.getString("owner", ""), "[]")));
            call.resolve(result);
        } catch (Exception e) { call.reject("Unable to read bank messages"); }
    }
    @PluginMethod public void acknowledge(PluginCall call) {
        synchronized (BankSmsReceiver.class) {
            try {
                String key = "queue_"+call.getString("owner", "");
                JSArray rows = new JSArray(prefs().getString(key, "[]"));
                JSArray keep = new JSArray();
                for (int i=0;i<rows.length();i++) {
                    if (!rows.getJSONObject(i).getString("reference").equals(call.getString("reference"))) keep.put(rows.getJSONObject(i));
                }
                prefs().edit().putString(key, keep.toString()).commit();
                call.resolve();
            } catch (Exception e) { call.reject("Unable to acknowledge message"); }
        }
    }
}
