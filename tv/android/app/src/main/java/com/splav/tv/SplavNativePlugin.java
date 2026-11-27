package com.splav.tv;

import android.app.Dialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Map;

/**
 * Нативная часть Сплава для телевизора. Те же методы, что у SplavNative на iPhone:
 * окно входа в сервисы (Яндекс, Звук, SoundCloud), его куки и скрипты, открытие ссылок.
 * Ядро (src/main.js) работает с окном входа так же, как с окном Electron на Маке.
 */
@CapacitorPlugin(name = "SplavNative")
public class SplavNativePlugin extends Plugin {
    // настольный Chrome: на нём у Яндекса есть вход по QR-коду, а страницы удобно смотреть на телевизоре
    private static final String DESKTOP_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
    private static final String[] SERVICE_URLS = { "https://soundcloud.com", "https://zvuk.com", "https://yandex.ru", "https://passport.yandex.ru", "https://oauth.yandex.ru" };

    private Dialog dialog;
    private WebView web;
    private String lastUrl;
    private final Map<String, PluginCall> pending = new HashMap<>();
    private int evalSeq = 0;

    @PluginMethod
    public void openLogin(PluginCall call) {
        String url = call.getString("url");
        String title = call.getString("title", "Вход");
        if (url == null) { call.reject("Нет адреса"); return; }
        getActivity().runOnUiThread(() -> {
            closeDialog(false);
            Dialog d = new Dialog(getActivity(), android.R.style.Theme_Black_NoTitleBar_Fullscreen);
            d.requestWindowFeature(Window.FEATURE_NO_TITLE);

            LinearLayout box = new LinearLayout(getActivity());
            box.setOrientation(LinearLayout.VERTICAL);
            box.setBackgroundColor(Color.parseColor("#060608"));

            // шапка: название и подсказка, как закрыть
            LinearLayout head = new LinearLayout(getActivity());
            head.setOrientation(LinearLayout.HORIZONTAL);
            head.setGravity(Gravity.CENTER_VERTICAL);
            int padX = dp(48), padY = dp(14);
            head.setPadding(padX, padY, padX, padY);
            TextView t = new TextView(getActivity());
            t.setText(title);
            t.setTextColor(Color.parseColor("#ECEBEE"));
            t.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
            t.setTypeface(Typeface.DEFAULT_BOLD);
            head.addView(t, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
            TextView hint = new TextView(getActivity());
            hint.setText("Кнопка «Назад» на пульте закрывает окно");
            hint.setTextColor(Color.parseColor("#8A8894"));
            hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            head.addView(hint);
            box.addView(head);

            WebView w = new WebView(getActivity());
            WebSettings s = w.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setUserAgentString(DESKTOP_UA);
            s.setLoadWithOverviewMode(true);
            s.setUseWideViewPort(true);
            s.setSupportMultipleWindows(false);   // окна-всплывашки (вход через Google, Apple) открываются здесь же
            s.setJavaScriptCanOpenWindowsAutomatically(true);
            CookieManager.getInstance().setAcceptCookie(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(w, true);
            w.addJavascriptInterface(new EvalBridge(), "SplavLoginBridge");
            w.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { nav(req.getUrl().toString()); return false; }
                @Override public void onPageStarted(WebView view, String u, android.graphics.Bitmap icon) { nav(u); }
                @Override public void onPageFinished(WebView view, String u) { nav(u); }
                @Override public void doUpdateVisitedHistory(WebView view, String u, boolean reload) { nav(u); }
            });
            box.addView(w, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

            d.setContentView(box);
            d.setOnKeyListener((di, code, ev) -> {
                if (code == KeyEvent.KEYCODE_BACK && ev.getAction() == KeyEvent.ACTION_UP) {
                    if (w.canGoBack()) w.goBack(); else closeDialog(true);
                    return true;
                }
                return code == KeyEvent.KEYCODE_BACK;
            });
            d.setOnDismissListener(di -> finish());
            Window win = d.getWindow();
            if (win != null) win.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT);
            dialog = d; web = w; lastUrl = url;
            d.show();
            w.loadUrl(url);
            w.requestFocus();
            call.resolve();
        });
    }

    private void nav(String url) {
        if (url == null) return;
        lastUrl = url;
        JSObject o = new JSObject(); o.put("url", url);
        notifyListeners("loginNav", o);
    }

    private void finish() {
        if (web != null) { web.stopLoading(); web.destroy(); }
        web = null; dialog = null;
        for (PluginCall c : pending.values()) { JSObject o = new JSObject(); o.put("value", "null"); c.resolve(o); }
        pending.clear();
        notifyListeners("loginClosed", new JSObject());
    }

    private void closeDialog(boolean notify) {
        if (dialog == null) return;
        Dialog d = dialog;
        if (!notify) d.setOnDismissListener(null);
        d.dismiss();
        if (!notify) { if (web != null) web.destroy(); web = null; dialog = null; }
    }

    @PluginMethod
    public void closeLogin(PluginCall call) {
        getActivity().runOnUiThread(() -> { closeDialog(true); call.resolve(); });
    }

    @PluginMethod
    public void loginCookies(PluginCall call) {
        String name = call.getString("name");
        CookieManager cm = CookieManager.getInstance();
        JSArray list = new JSArray();
        java.util.LinkedHashSet<String> urls = new java.util.LinkedHashSet<>();
        if (lastUrl != null) { Uri u = Uri.parse(lastUrl); if (u.getHost() != null) urls.add(u.getScheme() + "://" + u.getHost()); }
        for (String s : SERVICE_URLS) urls.add(s);
        java.util.HashSet<String> seen = new java.util.HashSet<>();
        for (String u : urls) {
            String all = cm.getCookie(u);
            if (all == null) continue;
            for (String part : all.split(";")) {
                int eq = part.indexOf('=');
                if (eq <= 0) continue;
                String n = part.substring(0, eq).trim(), v = part.substring(eq + 1).trim();
                if ((name == null || name.equals(n)) && seen.add(n + "=" + v)) {
                    JSObject c = new JSObject(); c.put("name", n); c.put("value", v); c.put("domain", Uri.parse(u).getHost());
                    list.put(c);
                }
            }
        }
        JSObject res = new JSObject(); res.put("cookies", list);
        call.resolve(res);
    }

    /** Выполнить код на странице входа; как на iPhone, ждём промис и возвращаем JSON-строку */
    @PluginMethod
    public void loginEval(PluginCall call) {
        String code = call.getString("code");
        if (code == null) { call.reject("Нет кода"); return; }
        getActivity().runOnUiThread(() -> {
            if (web == null) { JSObject o = new JSObject(); o.put("value", "null"); call.resolve(o); return; }
            String id = String.valueOf(++evalSeq);
            pending.put(id, call);
            String js = "(function(){try{Promise.resolve((" + code + ")).then(function(v){SplavLoginBridge.done('" + id + "',JSON.stringify(v===undefined?null:v))},function(){SplavLoginBridge.done('" + id + "','null')})}catch(e){SplavLoginBridge.done('" + id + "','null')}})()";
            web.evaluateJavascript(js, null);
        });
    }

    private class EvalBridge {
        @JavascriptInterface
        public void done(String id, String value) {
            PluginCall c = pending.remove(id);
            if (c == null) return;
            JSObject o = new JSObject(); o.put("value", value == null ? "null" : value);
            c.resolve(o);
        }
    }

    /** Выход из сервиса: забываем куки и данные страниц входа */
    @PluginMethod
    public void clearLogin(PluginCall call) {
        CookieManager.getInstance().removeAllCookies(ok -> {
            CookieManager.getInstance().flush();
            getActivity().runOnUiThread(() -> {
                for (String s : SERVICE_URLS) WebStorage.getInstance().deleteOrigin(s);
                call.resolve();
            });
        });
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url");
        if (url == null) { call.reject("Нет адреса"); return; }
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(i);
            call.resolve();
        } catch (Exception e) { call.reject("На телевизоре нет приложения, чтобы открыть ссылку"); }
    }

    /** На iPhone настраивает экран блокировки; на телевизоре медиакнопки ловит MainActivity */
    @PluginMethod
    public void remoteCommands(PluginCall call) { call.resolve(); }

    private int dp(int v) { return Math.round(v * getContext().getResources().getDisplayMetrics().density); }

    // для MainActivity: передать нажатие медиакнопки в интерфейс
    static String mediaKeyName(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE: case KeyEvent.KEYCODE_HEADSETHOOK: return "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "MediaPlay";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "MediaPause";
            case KeyEvent.KEYCODE_MEDIA_STOP: return "MediaStop";
            case KeyEvent.KEYCODE_MEDIA_NEXT: return "MediaTrackNext";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: return "MediaTrackPrevious";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "MediaFastForward";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "MediaRewind";
            default: return null;
        }
    }
}
