package com.splav.tv;

import android.os.Bundle;
import android.view.KeyEvent;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SplavNativePlugin.class);
        super.onCreate(savedInstanceState);
    }

    // медиакнопки пульта (играть, пауза, следующий…) передаём в интерфейс ровно один раз
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String key = SplavNativePlugin.mediaKeyName(event.getKeyCode());
        if (key != null && bridge != null && bridge.getWebView() != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN && event.getRepeatCount() == 0) {
                bridge.getWebView().evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',bubbles:true}))", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
