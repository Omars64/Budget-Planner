package com.flowbudget.app;

import android.content.Context;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;

final class BankNotificationStore implements AutoCloseable {
    private final SQLiteDatabase db;
    BankNotificationStore(Context context) {
        db = SQLiteDatabase.openOrCreateDatabase(new File(context.getNoBackupFilesDir(), "bank-notification-queue.db"), null);
        db.execSQL("CREATE TABLE IF NOT EXISTS alerts (id TEXT PRIMARY KEY, owner TEXT NOT NULL, hash TEXT UNIQUE NOT NULL, posted INTEGER NOT NULL, payload TEXT NOT NULL)");
        db.delete("alerts", "posted < ?", new String[]{String.valueOf(System.currentTimeMillis() - 30L*86400000)});
    }
    synchronized boolean add(String owner, JSONObject notification) throws Exception {
        try (Cursor count = db.rawQuery("SELECT COUNT(*) FROM alerts WHERE owner=?", new String[]{owner})) {
            count.moveToFirst();
            if (count.getInt(0) >= 1000) return false;
        }
        ContentValues values = new ContentValues();
        values.put("id", notification.getString("id")); values.put("owner", owner);
        values.put("hash", owner + ":" + notification.getString("contentHash"));
        values.put("posted", notification.getLong("postedAt")); values.put("payload", notification.toString());
        try {
            db.insertOrThrow("alerts", null, values);
        } catch (android.database.sqlite.SQLiteConstraintException duplicate) {
            try (Cursor existing = db.rawQuery("SELECT 1 FROM alerts WHERE hash=?", new String[]{values.getAsString("hash")})) {
                if (!existing.moveToFirst()) throw duplicate;
            }
        }
        return true;
    }
    JSONArray pending(String owner) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor cursor = db.rawQuery("SELECT payload FROM alerts WHERE owner=? ORDER BY posted LIMIT 100", new String[]{owner})) {
            while (cursor.moveToNext()) rows.put(new JSONObject(cursor.getString(0)));
        }
        return rows;
    }
    void remove(String owner, JSONArray ids) throws Exception {
        db.beginTransaction();
        try {
            for (int i=0; i<ids.length(); i++) db.delete("alerts", "owner=? AND id=?", new String[]{owner, ids.getString(i)});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
    }
    public void close() { db.close(); }
}
