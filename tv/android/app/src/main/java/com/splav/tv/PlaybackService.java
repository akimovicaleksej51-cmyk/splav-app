package com.splav.tv;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.IBinder;
import android.webkit.WebView;

import java.lang.ref.WeakReference;

/**
 * Служба «играет музыка». Пока она запущена, Android не выгружает Сплав в фоне:
 * можно переключиться на приставку или другое приложение, а музыка продолжит играть.
 * Заодно телевизор показывает карточку «Сейчас играет», а кнопки пульта и системы
 * (пауза, следующий трек) приходят в Сплав, даже когда он не на экране.
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "playback";
    private static final int ID = 1;
    static WeakReference<WebView> web = new WeakReference<>(null);

    private MediaSession session;
    private String coverUrl;
    private Bitmap cover;

    private static PlaybackService instance;

    /** Обновить карточку «Сейчас играет». Служба запускается один раз, пока Сплав на экране,
     *  а дальше обновляется напрямую: из фона Android не даёт запускать её заново */
    static void update(Context ctx, String title, String artist, String cover, boolean playing, long positionMs, long durationMs) {
        Intent i = new Intent(ctx, PlaybackService.class)
            .putExtra("title", title).putExtra("artist", artist).putExtra("cover", cover)
            .putExtra("playing", playing).putExtra("position", positionMs).putExtra("duration", durationMs);
        if (instance != null) { PlaybackService s = instance; new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> s.apply(i)); return; }
        if (!playing) return;
        if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
    }
    static void stop(Context ctx) { ctx.stopService(new Intent(ctx, PlaybackService.class)); }

    @Override
    public void onCreate() {
        super.onCreate();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Сейчас играет", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(ch);
        }
        session = new MediaSession(this, "Splav");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { key("MediaPlay"); }
            @Override public void onPause() { key("MediaPause"); }
            @Override public void onStop() { key("MediaPause"); }
            @Override public void onSkipToNext() { key("MediaTrackNext"); }
            @Override public void onSkipToPrevious() { key("MediaTrackPrevious"); }
            @Override public void onFastForward() { key("MediaFastForward"); }
            @Override public void onRewind() { key("MediaRewind"); }
        });
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        session.setSessionActivity(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE));
        session.setActive(true);
    }

    // команда от системы или пульта → в интерфейс Сплава, как обычная медиакнопка
    private void key(String name) {
        WebView w = web.get();
        if (w != null) w.post(() -> w.evaluateJavascript("document.dispatchEvent(new KeyboardEvent('keydown',{key:'" + name + "',bubbles:true}))", null));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        instance = this;
        apply(intent);
        return START_NOT_STICKY;
    }

    private void apply(Intent intent) {
        String title = intent != null ? intent.getStringExtra("title") : null;
        String artist = intent != null ? intent.getStringExtra("artist") : null;
        String url = intent != null ? intent.getStringExtra("cover") : null;
        boolean playing = intent != null && intent.getBooleanExtra("playing", false);
        long pos = intent != null ? intent.getLongExtra("position", 0) : 0;
        long dur = intent != null ? intent.getLongExtra("duration", 0) : 0;

        if (url != null && !url.equals(coverUrl)) { coverUrl = url; cover = null; loadCover(url, title, artist, dur); }
        session.setMetadata(meta(title, artist, dur));
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, pos, playing ? 1f : 0f)
            .build());

        Notification n = notification(title, artist, playing);
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        else startForeground(ID, n);
    }

    private MediaMetadata meta(String title, String artist, long dur) {
        MediaMetadata.Builder b = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title == null ? "Сплав" : title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist == null ? "" : artist)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, dur);
        if (cover != null) b.putBitmap(MediaMetadata.METADATA_KEY_ART, cover);
        return b.build();
    }

    // обложку грузим отдельно и дорисовываем, когда придёт
    private void loadCover(String url, String title, String artist, long dur) {
        new Thread(() -> {
            try {
                java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
                c.setConnectTimeout(8000); c.setReadTimeout(8000);
                Bitmap b = BitmapFactory.decodeStream(c.getInputStream());
                if (b == null || !url.equals(coverUrl)) return;
                cover = Bitmap.createScaledBitmap(b, 320, 320, true);
                session.setMetadata(meta(title, artist, dur));
            } catch (Exception ignored) {}
        }).start();
    }

    private Notification notification(String title, String artist, boolean playing) {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        b.setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(title == null ? "Сплав" : title)
            .setContentText(artist == null ? "" : artist)
            .setOngoing(playing)
            .setShowWhen(false)
            .setContentIntent(session.getController().getSessionActivity())
            .setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()));
        if (cover != null) b.setLargeIcon(cover);
        return b.build();
    }

    @Override
    public void onDestroy() {
        instance = null;
        session.setActive(false);
        session.release();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
