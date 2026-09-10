package com.flowbudget.app;

import android.app.KeyguardManager;
import android.os.Build;
import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.*;
import androidx.credentials.exceptions.CreateCredentialException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativePasskeys")
public class PasskeysPlugin extends Plugin {
    private static final String RP_ID = "budget-planner-ecru-seven.vercel.app";
    private CancellationSignal pending;
    private PluginCall pendingCall;
    private String pendingId;

    @PluginMethod public void status(PluginCall call) {
        KeyguardManager lock = getContext().getSystemService(KeyguardManager.class);
        JSObject result = new JSObject();
        result.put("supported", Build.VERSION.SDK_INT >= 28);
        result.put("screenLock", lock != null && lock.isDeviceSecure());
        call.resolve(result);
    }

    private boolean begin(PluginCall call, boolean creating) {
        if (pending != null) { call.reject("A passkey request is already open."); return false; }
        if (Build.VERSION.SDK_INT < 28) { call.reject("Passkeys require Android 9 or newer. Use your password."); return false; }
        KeyguardManager lock = getContext().getSystemService(KeyguardManager.class);
        if (lock == null || !lock.isDeviceSecure()) {
            call.reject("Set a screen lock in Android Settings > Security, then add your fingerprint or face if available.");
            return false;
        }
        JSObject options = call.getObject("options");
        String id = call.getString("requestId");
        String rp = options == null ? "" : creating ? options.optJSONObject("rp") == null ? "" : options.optJSONObject("rp").optString("id") : options.optString("rpId");
        if (!RP_ID.equals(rp) || id == null || options.toString().length() > 262144) {
            call.reject("Invalid FlowBudget passkey request."); return false;
        }
        pending = new CancellationSignal();
        pendingCall = call;
        pendingId = id;
        return true;
    }

    private boolean finish(PluginCall call) {
        if (pendingCall != call) return false;
        pending = null;
        pendingCall = null;
        pendingId = null;
        return true;
    }

    private void fail(PluginCall call, String type) {
        if (!finish(call)) return;
        String message = "Passkey request failed. Check your password manager and the app update, or sign in with your password.";
        if (type.contains("CANCELLATION") || type.contains("CANCELED")) message = "Passkey request cancelled. You can retry or use your password.";
        else if (type.contains("NO_CREDENTIAL")) message = "No matching passkey is available. Sign in with your password, then register a passkey in Settings > Biometric sign-in.";
        else if (type.contains("PROVIDER_CONFIGURATION") || type.contains("UNSUPPORTED")) message = "Enable a passkey provider in Android Settings > Passwords, passkeys & accounts, and update Google Play services.";
        call.reject(message, type);
    }

    private void resolveCredential(PluginCall call, String json) {
        if (!finish(call)) return;
        try { JSObject result = new JSObject(); result.put("credential", new JSObject(json)); call.resolve(result); }
        catch (Exception error) { call.reject("Invalid response from the passkey provider."); }
    }

    @PluginMethod public void create(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!begin(call, true)) return;
            try {
                CredentialManager.create(getActivity()).createCredentialAsync(getActivity(),
                    new CreatePublicKeyCredentialRequest(call.getObject("options").toString()), pending,
                    ContextCompat.getMainExecutor(getContext()),
                    new CredentialManagerCallback<CreateCredentialResponse, CreateCredentialException>() {
                        @Override public void onResult(CreateCredentialResponse response) {
                            if (response instanceof CreatePublicKeyCredentialResponse) resolveCredential(call, ((CreatePublicKeyCredentialResponse) response).getRegistrationResponseJson());
                            else fail(call, "UNEXPECTED_CREDENTIAL");
                        }
                        @Override public void onError(CreateCredentialException error) { fail(call, error.getType()); }
                    });
            } catch (Exception error) { fail(call, "INVALID_REQUEST"); }
        });
    }

    @PluginMethod public void get(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!begin(call, false)) return;
            try {
                GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(new GetPublicKeyCredentialOption(call.getObject("options").toString())).build();
                CredentialManager.create(getActivity()).getCredentialAsync(getActivity(), request, pending,
                    ContextCompat.getMainExecutor(getContext()),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override public void onResult(GetCredentialResponse response) {
                            if (response.getCredential() instanceof PublicKeyCredential) resolveCredential(call, ((PublicKeyCredential) response.getCredential()).getAuthenticationResponseJson());
                            else fail(call, "UNEXPECTED_CREDENTIAL");
                        }
                        @Override public void onError(GetCredentialException error) { fail(call, error.getType()); }
                    });
            } catch (Exception error) { fail(call, "INVALID_REQUEST"); }
        });
    }

    @PluginMethod public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pending != null && pendingId.equals(call.getString("requestId"))) cancelPending();
            call.resolve();
        });
    }

    private void cancelPending() {
        CancellationSignal signal = pending;
        PluginCall call = pendingCall;
        if (call != null) fail(call, "CANCELLATION");
        if (signal != null) signal.cancel();
    }

    @Override protected void handleOnDestroy() { cancelPending(); }
}
