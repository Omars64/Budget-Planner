package com.flowbudget.app;

import android.content.SharedPreferences;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="BankSms")
public class BankSmsPlugin extends Plugin {
    private SharedPreferences prefs() { return getContext().getSharedPreferences("bank_sms", 0); }
    @Override public void load() {
        // Retain existing queued alerts; upgrades must not resume SMS capture.
        prefs().edit().putBoolean("enabled", false).apply();
    }
    @PluginMethod public void configure(PluginCall call) {
        prefs().edit().putBoolean("enabled", false).apply();
        if (call.getBoolean("enabled", false)) { call.reject("SMS capture is unavailable in this version. Add bank alerts manually."); return; }
        call.resolve();
    }
    @PluginMethod public void status(PluginCall call) {
        JSObject result = new JSObject();
        boolean owner = prefs().getString("owner", "").equals(call.getString("owner", ""));
        result.put("enabled", false);
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
        synchronized (BankSmsPlugin.class) {
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
