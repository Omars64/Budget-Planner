package com.flowbudget.app;

import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@CapacitorPlugin(name = "BudgetlyLauncherIcon")
public class BudgetlyLauncherIconPlugin extends Plugin {
    private static final int FLAGS = PackageManager.DONT_KILL_APP;
    // Only the activity's main thread reads or writes these fields.
    private boolean stopped;
    private String pendingPalette;

    @PluginMethod
    public void setPalette(PluginCall call) {
        String selected = call.getString("palette", "");
        if (!Arrays.asList(getContext().getResources().getStringArray(R.array.budgetly_launcher_palettes)).contains(selected)) {
            call.reject("Unknown Budgetly palette.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            pendingPalette = selected;
            if (stopped) applyPendingPalette();
            call.resolve();
        });
    }

    @Override protected void handleOnStart() {
        stopped = false;
    }

    @Override protected void handleOnStop() {
        if (getActivity().isChangingConfigurations()) return;
        stopped = true;
        applyPendingPalette();
    }

    private void applyPendingPalette() {
        if (pendingPalette == null) return;
        try {
            applyPalette(getContext().getPackageManager(), getContext().getPackageName(), pendingPalette,
                    getContext().getResources().getStringArray(R.array.budgetly_launcher_palettes));
            pendingPalette = null;
        } catch (RuntimeException error) {
            // Keep the pending palette for the next time Budgetly is backgrounded.
        }
    }

    private static void applyPalette(PackageManager manager, String packageName, String selected, String[] palettes) {
        List<ComponentName> changed = new ArrayList<>();
        for (String palette : palettes) {
            ComponentName alias = new ComponentName(packageName, aliasClass(palette));
            int state = manager.getComponentEnabledSetting(alias);
            boolean enabled = state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    || ("navy".equals(palette) && state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT);
            boolean shouldEnable = palette.equals(selected);
            if (enabled == shouldEnable) continue;
            // On older Android versions, enable the replacement before disabling the old icon.
            if (shouldEnable) changed.add(0, alias);
            else changed.add(alias);
        }
        String target = aliasClass(selected);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
            for (ComponentName alias : changed) {
                settings.add(new PackageManager.ComponentEnabledSetting(alias, enabledState(alias, target), FLAGS));
            }
            if (!settings.isEmpty()) manager.setComponentEnabledSettings(settings);
        } else {
            for (ComponentName alias : changed) manager.setComponentEnabledSetting(alias, enabledState(alias, target), FLAGS);
        }
    }

    private static String aliasClass(String palette) {
        return MainActivity.class.getPackage().getName() + ".Launcher"
                + Character.toUpperCase(palette.charAt(0)) + palette.substring(1);
    }

    private static int enabledState(ComponentName alias, String target) {
        return alias.getClassName().equals(target)
                ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
    }
}
