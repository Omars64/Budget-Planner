package com.flowbudget.app;

import android.view.HapticFeedbackConstants;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BudgetlyFeedback")
public class BudgetlyFeedbackPlugin extends Plugin {
    @PluginMethod public void success(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            getBridge().getWebView().performHapticFeedback(HapticFeedbackConstants.CONFIRM);
            call.resolve();
        });
    }
}
