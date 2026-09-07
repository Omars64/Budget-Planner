package com.flowbudget.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.provider.Telephony;
import android.telephony.SmsMessage;
import org.json.JSONArray;
import org.json.JSONObject;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public class BankSmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) return;
        SharedPreferences prefs = context.getSharedPreferences("bank_sms", 0);
        if (!prefs.getBoolean("enabled", false)) return;
        try {
            SmsMessage[] parts = Telephony.Sms.Intents.getMessagesFromIntent(intent);
            if (parts.length == 0) return;
            String sender = parts[0].getOriginatingAddress();
            StringBuilder text = new StringBuilder();
            for (SmsMessage part : parts) text.append(part.getMessageBody());
            String message = text.toString();
            if (message.length()>2000 || message.toLowerCase(Locale.ROOT).matches("(?s).*(otp|password|verification|one.time|login|security code|رمز|كلمة المرور).*")) return;
            JSONArray rules = new JSONArray(prefs.getString("rules", "[]"));
            String bank = null;
            for(int i=0;i<rules.length();i++) {
                JSONObject rule = rules.getJSONObject(i);
                if(rule.getString("sender").equalsIgnoreCase(sender)) { bank=rule.getString("bank"); break; }
            }
            if(bank == null || !message.toLowerCase(Locale.ROOT).matches("(?s).*(kwd|kd|د.ك).*")) return;
            String source = sender+":"+parts[0].getTimestampMillis()+":"+message;
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(source.getBytes(StandardCharsets.UTF_8));
            StringBuilder ref = new StringBuilder();
            for(byte b:digest) ref.append(String.format("%02x",b));
            synchronized(BankSmsReceiver.class) {
                String key="queue_"+prefs.getString("owner", "");
                JSONArray queue=new JSONArray(prefs.getString(key,"[]"));
                for(int i=0;i<queue.length();i++) if(queue.getJSONObject(i).getString("reference").equals(ref.toString())) return;
                queue.put(new JSONObject().put("bank",bank).put("message",message).put("reference",ref.toString()));
                prefs.edit().putString(key,queue.toString()).commit();
            }
        } catch(Exception e) { android.util.Log.e("FlowBudget", "Bank alert capture failed"); }
    }
}
