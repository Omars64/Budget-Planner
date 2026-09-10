package com.flowbudget.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle state) {
        registerPlugin(BankSmsPlugin.class);
        registerPlugin(PasskeysPlugin.class);
        super.onCreate(state);
    }
}
