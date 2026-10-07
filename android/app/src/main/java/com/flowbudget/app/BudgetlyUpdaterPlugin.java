package com.flowbudget.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "BudgetlyUpdater")
public class BudgetlyUpdaterPlugin extends Plugin {
    private static final long MAX_BYTES = 268435456L;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private volatile File verifiedApk;
    private volatile String verifiedHash;
    private volatile long verifiedVersion;

    @PluginMethod
    public void setPushAlerts(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getContext().getSharedPreferences("budgetly-update-push", 0).edit().putBoolean("enabled", enabled)
            .putBoolean("scheduled", Boolean.TRUE.equals(call.getBoolean("scheduled", false))).commit();
        if (!enabled) ((android.app.NotificationManager)getContext().getSystemService(android.content.Context.NOTIFICATION_SERVICE)).cancel(1500);
        call.resolve();
    }

    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo current = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("version", current.versionName);
            result.put("versionCode", versionCode(current));
            result.put("pushConfigured", !com.google.firebase.FirebaseApp.getApps(getContext()).isEmpty());
            call.resolve(result);
        } catch (Exception error) { call.reject("Could not read the installed app version."); }
    }

    private URI allowedUri(String value, boolean first) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost();
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null) {
            throw new Exception("Update download must use an official HTTPS address.");
        }
        if (first) {
            String prefix = "/Omars64/Budget-Planner/releases/download/";
            String path = uri.getRawPath();
            if (!"github.com".equals(host) || uri.getQuery() != null || !path.startsWith(prefix) ||
                    !path.endsWith(".apk") || path.substring(prefix.length()).split("/", -1).length != 2 ||
                    path.contains("%2f") || path.contains("%2F") || path.contains("..")) {
                throw new Exception("The update is not from Budgetly's official release repository.");
            }
        } else if (!Arrays.asList("github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com").contains(host)) {
            throw new Exception("Unexpected update download redirect.");
        }
        return uri;
    }

    private HttpURLConnection connect(String value) throws Exception {
        URI uri = allowedUri(value, true);
        for (int redirects = 0; redirects <= 5; redirects++) {
            HttpURLConnection connection = (HttpURLConnection) uri.toURL().openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("User-Agent", "Budgetly-Android-Updater");
            connection.setRequestProperty("Accept-Encoding", "identity");
            int status = connection.getResponseCode();
            if (status == 200) return connection;
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location");
                connection.disconnect();
                if (location == null) throw new Exception("Missing update redirect address.");
                uri = allowedUri(uri.resolve(location).toString(), false);
            } else {
                connection.disconnect();
                throw new Exception("Download unavailable. Check your connection and retry.");
            }
        }
        throw new Exception("Too many update download redirects.");
    }

    private String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    private long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private int signingFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private Set<String> signers(PackageInfo info) throws Exception {
        if (info == null) throw new Exception("APK signing information is missing.");
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null) throw new Exception("APK signing information is missing.");
        Set<String> result = new HashSet<>();
        for (Signature signature : signatures) result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        if (result.isEmpty()) throw new Exception("APK has no signing certificate.");
        return result;
    }

    private void verifyIdentity(File apk, long version) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), signingFlags());
        PackageInfo candidate = manager.getPackageArchiveInfo(apk.getAbsolutePath(), signingFlags());
        if (candidate == null || !installed.packageName.equals(candidate.packageName) ||
                versionCode(candidate) != version || versionCode(candidate) <= versionCode(installed) ||
                !signers(installed).equals(signers(candidate))) {
            throw new Exception("This APK does not match Budgetly's signing identity or update version. It will not be installed.");
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (!downloading.compareAndSet(false, true)) { call.reject("An update is already downloading."); return; }
        String url = call.getString("url", "");
        String expectedHash = call.getString("sha256", "");
        Long expectedSize = UpdateNumbers.positiveInteger(call.getData().opt("size"), MAX_BYTES);
        Long expectedVersion = UpdateNumbers.positiveInteger(call.getData().opt("versionCode"), 2100000000L);
        if (!expectedHash.matches("[a-f0-9]{64}") || expectedSize == null || expectedSize <= 0 || expectedSize > MAX_BYTES ||
                expectedVersion == null || expectedVersion <= 0 || !getContext().getPackageName().equals(call.getString("packageId"))) {
            downloading.set(false); call.reject("Invalid update information."); return;
        }
        worker.execute(() -> {
            File apk = null;
            HttpURLConnection connection = null;
            verifiedApk = null;
            try {
                File directory = new File(getContext().getCacheDir(), "updates");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Could not prepare update storage.");
                File old = new File(directory, "Budgetly-update.apk");
                if (old.exists() && !old.delete()) throw new Exception("Could not replace the previous download.");
                apk = old;
                connection = connect(url);
                long contentLength = connection.getContentLengthLong();
                if (contentLength > MAX_BYTES || (contentLength >= 0 && contentLength != expectedSize)) throw new Exception("APK download size does not match the release.");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long total = 0;
                int lastPercent = -1;
                long deadline = System.currentTimeMillis() + 600000;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (Thread.currentThread().isInterrupted() || System.currentTimeMillis() > deadline) throw new Exception("Download timed out. Please retry.");
                        if (total > MAX_BYTES || total > expectedSize) throw new Exception("APK download exceeds its declared size.");
                        output.write(buffer, 0, count); digest.update(buffer, 0, count);
                        int percent = (int) (total * 100 / expectedSize);
                        if (percent != lastPercent) {
                            lastPercent = percent;
                            JSObject progress = new JSObject(); progress.put("percent", percent);
                            notifyListeners("downloadProgress", progress);
                        }
                    }
                }
                if (total != expectedSize || !expectedHash.equals(hex(digest.digest()))) throw new Exception("APK verification failed. Download again; this file will not be installed.");
                verifyIdentity(apk, expectedVersion);
                verifiedHash = expectedHash; verifiedVersion = expectedVersion; verifiedApk = apk;
                call.resolve();
            } catch (Exception error) {
                if (apk != null) apk.delete();
                call.reject(error.getMessage() == null ? "Update download failed." : error.getMessage());
            } finally {
                if (connection != null) connection.disconnect();
                downloading.set(false);
            }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        worker.execute(() -> {
            try {
                File apk = verifiedApk;
                if (apk == null || !apk.isFile()) throw new Exception("Download and verify the update first.");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                try (InputStream input = new java.io.FileInputStream(apk)) {
                    byte[] buffer = new byte[65536]; int count;
                    while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
                }
                if (!verifiedHash.equals(hex(digest.digest()))) throw new Exception("Downloaded APK changed. Please download it again.");
                verifyIdentity(apk, verifiedVersion);
                getActivity().runOnUiThread(() -> {
                    try {
                        JSObject result = new JSObject();
                        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
                            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                            getActivity().startActivity(settings);
                            result.put("permissionRequired", true);
                        } else {
                            Uri content = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                            Intent installer = new Intent(Intent.ACTION_VIEW);
                            installer.setDataAndType(content, "application/vnd.android.package-archive");
                            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            getActivity().startActivity(installer);
                            result.put("permissionRequired", false);
                        }
                        call.resolve(result);
                    } catch (Exception error) { call.reject("Android could not open the update installer."); }
                });
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }

    @Override
    protected void handleOnDestroy() {
        worker.shutdownNow();
        super.handleOnDestroy();
    }
}
