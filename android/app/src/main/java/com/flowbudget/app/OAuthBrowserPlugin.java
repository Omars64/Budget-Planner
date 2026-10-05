package com.flowbudget.app;

import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OAuthBrowser")
public class OAuthBrowserPlugin extends Plugin {
    @PluginMethod
    public void open(PluginCall call) {
        String value = call.getString("url", "");
        Uri uri = Uri.parse(value);
        if (!"https".equals(uri.getScheme()) || !"accounts.google.com".equals(uri.getHost())
                || uri.getUserInfo() != null || uri.getPort() != -1) {
            call.reject("Invalid Google sign-in URL");
            return;
        }
        try {
            getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri)
                    .addCategory(Intent.CATEGORY_BROWSABLE));
            call.resolve(new JSObject());
        } catch (Exception error) {
            call.reject("Install or enable a browser to continue with Google");
        }
    }
}
