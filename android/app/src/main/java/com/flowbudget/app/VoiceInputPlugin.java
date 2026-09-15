package com.flowbudget.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

@CapacitorPlugin(
    name = "VoiceInput",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class VoiceInputPlugin extends Plugin {
    private static final int DURATION_MS = 15000;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private PluginCall pendingCall;
    private boolean stopping;
    private String partialText = "";
    private final StringBuilder segments = new StringBuilder();
    private final Runnable deadline = this::stopListening;
    private final Runnable finishDeadline = () -> finish(null, false);
    private final Runnable startDeadline = () -> finish("The microphone did not start. Please try again.", false);

    @PluginMethod
    public void listen(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pendingCall != null) { call.reject("Voice input is already listening."); return; }
            if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
                call.reject("Voice input is not available on this device.");
                return;
            }
            pendingCall = call;
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            } else begin(call);
        });
    }

    @PermissionCallback
    public void microphonePermissionCallback(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pendingCall != call) return;
            if (getPermissionState("microphone") != PermissionState.GRANTED) {
                finish("Microphone permission was denied. Allow it in Android Settings.", false);
            } else begin(call);
        });
    }

    private void begin(PluginCall call) {
        if (pendingCall != call) return;
        stopping = false;
        partialText = "";
        segments.setLength(0);
        try {
            final SpeechRecognizer engine = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer = engine;
            engine.setRecognitionListener(new RecognitionListener() {
                private boolean current() { return pendingCall == call && recognizer == engine; }
                @Override public void onReadyForSpeech(Bundle params) {
                    if (!current() || stopping) return;
                    handler.removeCallbacks(startDeadline);
                    handler.removeCallbacks(deadline);
                    handler.postDelayed(deadline, DURATION_MS);
                    progress("listening");
                }
                @Override public void onResults(Bundle results) {
                    if (!current()) return;
                    String text = firstMatch(results);
                    if (!text.isEmpty()) partialText = text;
                    finish(null, false);
                }
                @Override public void onSegmentResults(Bundle results) {
                    if (!current()) return;
                    String text = firstMatch(results);
                    if (!text.isEmpty()) segments.append(segments.length() == 0 ? "" : " ").append(text);
                    partialText = "";
                    progress(null);
                }
                @Override public void onEndOfSegmentedSession() { if (current()) finish(null, false); }
                @Override public void onPartialResults(Bundle results) {
                    if (!current()) return;
                    partialText = firstMatch(results);
                    progress(null);
                }
                @Override public void onError(int error) {
                    if (!current()) return;
                    if (stopping || error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) finish(null, false);
                    else finish(errorMessage(error), false);
                }
                @Override public void onBeginningOfSpeech() {}
                @Override public void onRmsChanged(float value) {}
                @Override public void onBufferReceived(byte[] buffer) {}
                @Override public void onEndOfSpeech() {}
                @Override public void onEvent(int event, Bundle params) {}
            });
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "en-US"));
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            // Supported services can return multiple segments without reopening the microphone.
            if (Build.VERSION.SDK_INT >= 33) {
                intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS);
                intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, DURATION_MS);
            }
            handler.postDelayed(startDeadline, DURATION_MS);
            engine.startListening(intent);
        } catch (Exception error) {
            finish("Voice input could not be started. Please try again.", false);
        }
    }

    private String transcript() {
        return (segments.toString() + " " + partialText).trim();
    }

    private void progress(String state) {
        if (pendingCall == null) return;
        JSObject result = new JSObject();
        result.put("sessionId", pendingCall.getString("sessionId", ""));
        result.put("text", transcript());
        if (state != null) result.put("state", state);
        notifyListeners("voiceProgress", result);
    }

    private boolean matches(PluginCall call) {
        return pendingCall != null && pendingCall.getString("sessionId", "").equals(call.getString("sessionId", ""));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (matches(call)) stopListening();
            call.resolve();
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (matches(call)) finish(null, true);
            call.resolve();
        });
    }

    private void stopListening() {
        if (pendingCall == null || stopping) return;
        stopping = true;
        handler.removeCallbacks(deadline);
        handler.removeCallbacks(startDeadline);
        progress("finishing");
        if (recognizer == null) { finish(null, false); return; }
        handler.postDelayed(finishDeadline, 1000);
        try { recognizer.stopListening(); } catch (Exception error) { finish(null, false); }
    }

    private String firstMatch(Bundle results) {
        ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
    }

    private void finish(String error, boolean cancelled) {
        PluginCall call = pendingCall;
        String text = cancelled ? "" : transcript();
        pendingCall = null;
        handler.removeCallbacks(deadline);
        handler.removeCallbacks(finishDeadline);
        handler.removeCallbacks(startDeadline);
        SpeechRecognizer engine = recognizer;
        recognizer = null;
        if (engine != null) { engine.cancel(); engine.destroy(); }
        stopping = false;
        partialText = "";
        segments.setLength(0);
        if (call == null) return;
        if (error != null && text.isEmpty() && !cancelled) call.reject(error);
        else {
            JSObject result = new JSObject();
            result.put("text", text);
            call.resolve(result);
        }
    }

    private String errorMessage(int error) {
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return "Microphone permission was denied. Allow it in Android Settings.";
        if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) return "Voice input lost its connection. Please try again.";
        return "Voice input could not be completed. Please try again.";
    }

    @Override protected void handleOnPause() {
        getActivity().runOnUiThread(() -> { if (recognizer != null) finish(null, false); });
        super.handleOnPause();
    }

    @Override protected void handleOnDestroy() {
        handler.post(() -> finish(null, true));
        super.handleOnDestroy();
    }
}
