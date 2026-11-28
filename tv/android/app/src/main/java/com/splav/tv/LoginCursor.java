package com.splav.tv;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.webkit.WebView;

/**
 * Курсор для страниц входа: страницы Яндекса, Звука и SoundCloud сделаны под мышь и палец,
 * поэтому стрелки пульта двигают указатель, а «ОК» нажимает там, где он стоит — как в браузерах для ТВ.
 * Упёрлись в край — страница прокручивается.
 */
public class LoginCursor extends View {
    private final WebView web;
    private final float density;
    private float x = -1, y = -1;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG), stroke = new Paint(Paint.ANTI_ALIAS_FLAG), glow = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path arrow = new Path();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean pressed = false;

    public LoginCursor(Context ctx, WebView web) {
        super(ctx);
        this.web = web;
        density = ctx.getResources().getDisplayMetrics().density;
        fill.setColor(Color.WHITE);
        stroke.setColor(Color.parseColor("#B51D30"));
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeWidth(2.2f * density);
        stroke.setStrokeJoin(Paint.Join.ROUND);
        glow.setColor(Color.argb(70, 0, 0, 0));
        setClickable(false);
        setFocusable(false);
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        if (x < 0) { x = w / 2f; y = h / 2f; }
    }

    @Override
    protected void onDraw(Canvas c) {
        float s = density * (pressed ? 0.85f : 1f);
        arrow.reset();
        arrow.moveTo(x, y);
        arrow.lineTo(x, y + 22 * s);
        arrow.lineTo(x + 6 * s, y + 17 * s);
        arrow.lineTo(x + 10 * s, y + 26 * s);
        arrow.lineTo(x + 14 * s, y + 24 * s);
        arrow.lineTo(x + 10 * s, y + 15.5f * s);
        arrow.lineTo(x + 17 * s, y + 15.5f * s);
        arrow.close();
        c.drawCircle(x + 4 * s, y + 8 * s, 18 * s, glow);
        c.drawPath(arrow, fill);
        c.drawPath(arrow, stroke);
    }

    /** Обработать клавишу пульта. true — клавишу забрали себе */
    public boolean onKey(int code, KeyEvent ev) {
        boolean down = ev.getAction() == KeyEvent.ACTION_DOWN;
        switch (code) {
            case KeyEvent.KEYCODE_DPAD_LEFT: case KeyEvent.KEYCODE_DPAD_RIGHT:
            case KeyEvent.KEYCODE_DPAD_UP: case KeyEvent.KEYCODE_DPAD_DOWN:
                if (down) move(code, ev.getRepeatCount());
                return true;
            case KeyEvent.KEYCODE_DPAD_CENTER: case KeyEvent.KEYCODE_ENTER: case KeyEvent.KEYCODE_NUMPAD_ENTER: case KeyEvent.KEYCODE_BUTTON_A:
                if (down && ev.getRepeatCount() == 0) { pressed = true; invalidate(); }
                if (!down) { pressed = false; invalidate(); tap(); }
                return true;
        }
        return false;
    }

    private void move(int code, int repeat) {
        // чем дольше держите стрелку, тем быстрее едет курсор
        float step = density * Math.min(10 + repeat * 4, 44);
        float dx = 0, dy = 0;
        if (code == KeyEvent.KEYCODE_DPAD_LEFT) dx = -step;
        if (code == KeyEvent.KEYCODE_DPAD_RIGHT) dx = step;
        if (code == KeyEvent.KEYCODE_DPAD_UP) dy = -step;
        if (code == KeyEvent.KEYCODE_DPAD_DOWN) dy = step;
        float margin = 6 * density;
        float nx = x + dx, ny = y + dy;
        // у края — прокручиваем страницу
        if (ny < margin) { scrollPage(0, -(int) (getHeight() * 0.25f)); ny = margin; }
        if (ny > getHeight() - margin) { scrollPage(0, (int) (getHeight() * 0.25f)); ny = getHeight() - margin; }
        if (nx < margin) { scrollPage(-(int) (getWidth() * 0.2f), 0); nx = margin; }
        if (nx > getWidth() - margin) { scrollPage((int) (getWidth() * 0.2f), 0); nx = getWidth() - margin; }
        x = nx; y = ny;
        invalidate();
    }

    // прокрутка как пальцем: работает и для страницы, и для прокручиваемых блоков внутри неё
    private void scrollPage(int dx, int dy) {
        if (busy) return;
        busy = true;
        final float sx = getWidth() / 2f, sy = getHeight() / 2f;
        final long t0 = SystemClock.uptimeMillis();
        send(MotionEvent.ACTION_DOWN, t0, t0, sx, sy);
        final int steps = 6;
        for (int i = 1; i <= steps; i++) {
            final int k = i;
            ui.postDelayed(() -> {
                long t = SystemClock.uptimeMillis();
                send(MotionEvent.ACTION_MOVE, t0, t, sx - dx * k / (float) steps, sy - dy * k / (float) steps);
                if (k == steps) { send(MotionEvent.ACTION_UP, t0, t, sx - dx, sy - dy); busy = false; }
            }, i * 16L);
        }
    }
    private boolean busy = false;

    private void tap() {
        long t = SystemClock.uptimeMillis();
        send(MotionEvent.ACTION_DOWN, t, t, x, y);
        send(MotionEvent.ACTION_UP, t, t + 60, x, y);
    }

    private void send(int action, long downTime, long time, float px, float py) {
        MotionEvent e = MotionEvent.obtain(downTime, time, action, px, py, 0);
        e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        web.dispatchTouchEvent(e);
        e.recycle();
    }
}
