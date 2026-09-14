package com.flowbudget.app;

import android.Manifest;
import android.content.Intent;
import android.os.Bundle;
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
    permissions = {
        @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
    }
)
public class VoiceInputPlugin extends Plugin {
    private SpeechRecognizer recognizer;
    private PluginCall pendingCall;

    @PluginMethod
    public void listen(PluginCall call) {
        if (pendingCall != null) {
            call.reject("Voice input is already listening.");
            return;
        }
        if (!SpeechRecognizer.isRecognitionAvailable(getContext())) {
            call.reject("Voice input is not available on this device.");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "microphonePermissionCallback");
            return;
        }
        begin(call);
    }

    @PermissionCallback
    public void microphonePermissionCallback(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone permission was denied. Allow it in Android Settings to use voice input.");
            return;
        }
        begin(call);
    }

    private void begin(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (pendingCall != null) {
                call.reject("Voice input is already listening.");
                return;
            }
            try {
                pendingCall = call;
                recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
                recognizer.setRecognitionListener(new RecognitionListener() {
                    @Override public void onResults(Bundle results) {
                        ArrayList<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                        String text = matches == null || matches.isEmpty() ? "" : matches.get(0).trim();
                        if (text.isEmpty()) finishFailure("No speech was detected. Try again.");
                        else finishSuccess(text);
                    }
                    @Override public void onError(int error) { finishFailure(errorMessage(error)); }
                    @Override public void onReadyForSpeech(Bundle params) {}
                    @Override public void onBeginningOfSpeech() {}
                    @Override public void onRmsChanged(float rmsdB) {}
                    @Override public void onBufferReceived(byte[] buffer) {}
                    @Override public void onEndOfSpeech() {}
                    @Override public void onPartialResults(Bundle partialResults) {}
                    @Override public void onEvent(int eventType, Bundle params) {}
                });
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, call.getString("language", "en-US"));
                intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
                recognizer.startListening(intent);
            } catch (Exception error) {
                finishFailure("Voice input could not be started. Try again.");
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (recognizer != null) recognizer.cancel();
            call.resolve();
        });
    }

    private void finishSuccess(String text) {
        PluginCall call = pendingCall;
        clearRecognizer();
        if (call != null) {
            JSObject result = new JSObject();
            result.put("text", text);
            call.resolve(result);
        }
    }

    private void finishFailure(String message) {
        PluginCall call = pendingCall;
        clearRecognizer();
        if (call != null) call.reject(message);
    }

    private void clearRecognizer() {
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        pendingCall = null;
    }

    private String errorMessage(int error) {
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return "Microphone permission was denied. Allow it in Android Settings to use voice input.";
        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) return "No speech was detected. Try again and speak after the microphone opens.";
        if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT) return "Voice input is unavailable right now. Check your connection and try again.";
        if (error == SpeechRecognizer.ERROR_CLIENT) return "Voice input cancelled.";
        return "Voice input could not be completed. Try again.";
    }

    @Override
    protected void handleOnDestroy() {
        clearRecognizer();
        super.handleOnDestroy();
    }
}
