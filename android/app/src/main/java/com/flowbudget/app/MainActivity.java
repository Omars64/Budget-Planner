package com.flowbudget.app;

import com.getcapacitor.BridgeActivity;
import androidx.activity.OnBackPressedCallback;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle state) {
        registerPlugin(BankSmsPlugin.class);
        registerPlugin(PasskeysPlugin.class);
        registerPlugin(BudgetlyRemindersPlugin.class);
        registerPlugin(VoiceInputPlugin.class);
        registerPlugin(BudgetlyFeedbackPlugin.class);
        super.onCreate(state);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                getBridge().getWebView().evaluateJavascript(
                    "!window.dispatchEvent(new Event('budgetly:back',{cancelable:true}))",
                    handled -> {
                        if ("true".equals(handled)) return;
                        if (getBridge().getWebView().canGoBack()) getBridge().getWebView().goBack();
                        else moveTaskToBack(true);
                    });
            }
        });
    }
}
