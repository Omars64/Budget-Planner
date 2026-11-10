package com.flowbudget.app;

import com.getcapacitor.BridgeActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.browser.auth.AuthTabIntent;
import android.content.Intent;
import android.net.Uri;

public class MainActivity extends BridgeActivity {
    private final ActivityResultLauncher<Intent> googleAuthLauncher =
            AuthTabIntent.registerActivityResultLauncher(this, result -> {
                if (getBridge() != null) {
                    boolean canceled = result.resultCode != AuthTabIntent.RESULT_OK;
                    getBridge().triggerWindowJSEvent("budgetly:oauth-return",
                            "{\"detail\":{\"canceled\":" + canceled + "}}");
                }
            });

    public void openGoogleAuthTab(Uri uri) {
        new AuthTabIntent.Builder().build().launch(googleAuthLauncher, uri,
                "budget-planner-ecru-seven.vercel.app", "/api/auth/google/return");
    }

    @Override public void onCreate(android.os.Bundle state) {
        registerPlugin(BankSmsPlugin.class);
        registerPlugin(BankNotificationsPlugin.class);
        registerPlugin(PasskeysPlugin.class);
        registerPlugin(BudgetlyRemindersPlugin.class);
        registerPlugin(VoiceInputPlugin.class);
        registerPlugin(BudgetlyFeedbackPlugin.class);
        registerPlugin(OAuthBrowserPlugin.class);
        registerPlugin(BudgetlyUpdaterPlugin.class);
        registerPlugin(BudgetlyLauncherIconPlugin.class);
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
