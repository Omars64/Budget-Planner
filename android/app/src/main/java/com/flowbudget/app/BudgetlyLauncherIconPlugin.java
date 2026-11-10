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
    private static final String[] PALETTES = {"navy", "aubergine", "burgundy", "pine", "graphite"};
    private static final String[] ALIASES = {"LauncherNavy", "LauncherAubergine", "LauncherBurgundy", "LauncherPine", "LauncherGraphite"};
    private static final int FLAGS = PackageManager.DONT_KILL_APP;
    // Only the activity's main thread reads or writes these fields.
    private boolean stopped;
    private int pendingPalette = -1;

    @PluginMethod
    public void setPalette(PluginCall call) {
        int selected = Arrays.asList(PALETTES).indexOf(call.getString("palette", ""));
        if (selected < 0) {
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
        if (pendingPalette < 0) return;
        try {
            applyPalette(getContext().getPackageManager(), getContext().getPackageName(), pendingPalette);
            pendingPalette = -1;
        } catch (RuntimeException error) {
            // Keep the pending palette for the next time Budgetly is backgrounded.
        }
    }

    private static void applyPalette(PackageManager manager, String packageName, int selected) {
        List<ComponentName> changed = new ArrayList<>();
        for (int index = 0; index < ALIASES.length; index++) {
            ComponentName alias = new ComponentName(packageName, MainActivity.class.getPackage().getName() + "." + ALIASES[index]);
            int state = manager.getComponentEnabledSetting(alias);
            boolean enabled = state == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                    || (index == 0 && state == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT);
            if (enabled == (index == selected)) continue;
            // On older Android versions, enable the replacement before disabling the old icon.
            if (index == selected) changed.add(0, alias);
            else changed.add(alias);
        }
        String target = MainActivity.class.getPackage().getName() + "." + ALIASES[selected];
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

    private static int enabledState(ComponentName alias, String target) {
        return alias.getClassName().equals(target)
                ? PackageManager.COMPONENT_ENABLED_STATE_ENABLED : PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
    }
}
