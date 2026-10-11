package com.flowbudget.app;

import android.content.Context;
import java.io.File;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import static org.junit.Assert.*;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, manifest = Config.NONE)
public class BankNotificationStoreTest {
    private Context context;
    @Before public void setup() {
        context = RuntimeEnvironment.getApplication();
        android.database.sqlite.SQLiteDatabase.deleteDatabase(new File(context.getNoBackupFilesDir(), "bank-notification-queue.db"));
    }
    private JSONObject row(String id, String hash, long posted) throws Exception {
        return new JSONObject().put("id", id).put("contentHash", hash).put("postedAt", posted);
    }
    @Test public void persistsOrdersAndAcknowledgesOnlyTheRequestedOwner() throws Exception {
        long now = System.currentTimeMillis();
        try (BankNotificationStore store = new BankNotificationStore(context)) {
            assertTrue(store.add("1", row("later", "a", now)));
            assertTrue(store.add("1", row("earlier", "b", now - 1000)));
            assertTrue(store.add("2", row("other", "a", now)));
            assertTrue(store.add("1", row("duplicate", "a", now)));
            assertEquals("earlier", store.pending("1").getJSONObject(0).getString("id"));
            store.remove("2", new JSONArray().put("earlier"));
            assertEquals(2, store.pending("1").length());
            store.remove("1", new JSONArray().put("earlier"));
        }
        try (BankNotificationStore store = new BankNotificationStore(context)) {
            assertEquals("later", store.pending("1").getJSONObject(0).getString("id"));
            assertEquals(1, store.pending("2").length());
        }
    }
    @Test public void limitsBatchAndCapacityPerOwner() throws Exception {
        try (BankNotificationStore store = new BankNotificationStore(context)) {
            for (int i = 0; i < 1000; i++) assertTrue(store.add("1", row("id" + i, "h" + i, System.currentTimeMillis())));
            assertEquals(100, store.pending("1").length());
            assertFalse(store.add("1", row("overflow", "overflow", System.currentTimeMillis())));
            assertTrue(store.add("2", row("other", "h0", System.currentTimeMillis())));
        }
    }
    @Test public void prunesExpiredAlertsOnReopenAndRollsBackInvalidAcknowledgement() throws Exception {
        try (BankNotificationStore store = new BankNotificationStore(context)) {
            store.add("1", row("old", "old", System.currentTimeMillis() - 31L * 86400000));
            store.add("1", row("new", "new", System.currentTimeMillis()));
            JSONArray interruptedIds = new JSONArray() {
                @Override public String getString(int index) throws org.json.JSONException {
                    if (index == 1) throw new org.json.JSONException("Injected acknowledgement read failure");
                    return super.getString(index);
                }
            };
            interruptedIds.put("new").put("old");
            assertThrows(org.json.JSONException.class, () -> store.remove("1", interruptedIds));
            assertEquals(2, store.pending("1").length());
        }
        try (BankNotificationStore store = new BankNotificationStore(context)) {
            assertEquals("new", store.pending("1").getJSONObject(0).getString("id"));
        }
    }
}
