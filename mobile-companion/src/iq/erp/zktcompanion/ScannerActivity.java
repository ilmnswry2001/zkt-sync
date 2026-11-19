package iq.erp.zktcompanion;

import android.app.Activity;
import android.content.Intent;
import android.graphics.ImageFormat;
import android.hardware.Camera;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Button;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public final class ScannerActivity extends Activity implements SurfaceHolder.Callback {
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private Camera camera;
    private boolean decoding;
    private boolean finished;
    private long lastFrame;
    private SurfaceView surface;
    private TextView guidance;
    private Button flash;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        layout.setFitsSystemWindows(true);
        TextView heading = new TextView(this);
        heading.setText("وجّه الكاميرا إلى رمز الربط في شاشة النظام");
        heading.setTextSize(18);
        heading.setPadding(24, 24, 24, 24);
        layout.addView(heading);
        surface = new SurfaceView(this);
        surface.setOnClickListener(view -> focus());
        layout.addView(surface, new LinearLayout.LayoutParams(-1, 0, 1));
        guidance = new TextView(this);
        guidance.setText("ضع الرمز كاملًا في منتصف الصورة. اضغط على المعاينة لضبط التركيز.");
        guidance.setPadding(24, 18, 24, 12);
        layout.addView(guidance);
        flash = new Button(this);
        flash.setText("تشغيل الإضاءة");
        flash.setVisibility(View.GONE);
        flash.setOnClickListener(view -> toggleFlash());
        layout.addView(flash);
        Button manual = new Button(this);
        manual.setText("إدخال رمز الربط يدويًا");
        manual.setOnClickListener(view -> {
            setResult(RESULT_OK, new Intent().putExtra("manual", true));
            finish();
        });
        layout.addView(manual);
        surface.getHolder().addCallback(this);
        setContentView(layout);
    }

    @Override public void surfaceCreated(SurfaceHolder holder) {
        try {
            Camera.CameraInfo cameraInfo = new Camera.CameraInfo();
            int id = 0;
            for (int index = 0; index < Camera.getNumberOfCameras(); index++) {
                Camera.getCameraInfo(index, cameraInfo);
                if (cameraInfo.facing == Camera.CameraInfo.CAMERA_FACING_BACK) { id = index; break; }
            }
            Camera.getCameraInfo(id, cameraInfo);
            camera = Camera.open(id);
            Camera.Parameters settings = camera.getParameters();
            List<Integer> formats = settings.getSupportedPreviewFormats();
            if (formats != null && formats.contains(ImageFormat.NV21)) settings.setPreviewFormat(ImageFormat.NV21);
            List<Camera.Size> sizes = settings.getSupportedPreviewSizes();
            Camera.Size best = null;
            if (sizes != null) for (Camera.Size size : sizes) {
                if (size.width <= 1920 && size.height <= 1080 && (best == null || size.width * size.height > best.width * best.height)) best = size;
            }
            if (best != null) settings.setPreviewSize(best.width, best.height);
            List<String> modes = settings.getSupportedFocusModes();
            if (modes != null && modes.contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE)) {
                settings.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            } else if (modes != null && modes.contains(Camera.Parameters.FOCUS_MODE_AUTO)) {
                settings.setFocusMode(Camera.Parameters.FOCUS_MODE_AUTO);
            }
            camera.setParameters(settings);
            settings = camera.getParameters();
            Camera.Size size = settings.getPreviewSize();
            int rotation = getWindowManager().getDefaultDisplay().getRotation();
            int degrees = rotation == Surface.ROTATION_90 ? 90 : rotation == Surface.ROTATION_180 ? 180 : rotation == Surface.ROTATION_270 ? 270 : 0;
            int orientation = cameraInfo.facing == Camera.CameraInfo.CAMERA_FACING_FRONT
                ? (360 - (cameraInfo.orientation + degrees) % 360) % 360
                : (cameraInfo.orientation - degrees + 360) % 360;
            camera.setDisplayOrientation(orientation);
            camera.setPreviewDisplay(holder);
            List<String> lighting = settings.getSupportedFlashModes();
            flash.setVisibility(lighting != null && lighting.contains(Camera.Parameters.FLASH_MODE_TORCH) ? View.VISIBLE : View.GONE);
            if (settings.getPreviewFormat() != ImageFormat.NV21 && settings.getPreviewFormat() != ImageFormat.YV12) {
                throw new IllegalStateException("Unsupported preview format");
            }
            final int format = settings.getPreviewFormat();
            int lumaStride = format == ImageFormat.YV12 ? (size.width + 15) & ~15 : size.width;
            int bufferSize = format == ImageFormat.YV12
                ? lumaStride * size.height + (((lumaStride / 2 + 15) & ~15) * size.height)
                : size.width * size.height * ImageFormat.getBitsPerPixel(format) / 8;
            camera.setPreviewCallbackWithBuffer((frame, source) -> {
                try { onFrame(frame, source, size, lumaStride); }
                finally { if (frame != null && source == camera) source.addCallbackBuffer(frame); }
            });
            camera.addCallbackBuffer(new byte[bufferSize]);
            camera.startPreview();
            focus();
            Camera opened = camera;
            surface.postDelayed(() -> {
                if (camera == opened && !finished) guidance.setText("قرّب الهاتف حتى يملأ الرمز منتصف الصورة وقلّل انعكاس الشاشة. إذا تعذّر المسح استخدم الإدخال اليدوي.");
            }, 7000);
        } catch (Exception failure) {
            release();
            guidance.setText("تعذر تشغيل قارئ الكاميرا. استخدم إدخال رمز الربط يدويًا.");
        }
    }

    private void onFrame(byte[] frame, Camera source, Camera.Size size, int rowStride) {
        long now = SystemClock.elapsedRealtime();
        if (camera != source || finished || isFinishing() || decoding || now - lastFrame < 120 || frame == null) return;
        if (frame.length < rowStride * size.height) return;
        lastFrame = now;
        byte[] luma;
        if (rowStride == size.width) luma = Arrays.copyOf(frame, size.width * size.height);
        else {
            luma = new byte[size.width * size.height];
            for (int row = 0; row < size.height; row++) {
                System.arraycopy(frame, row * rowStride, luma, row * size.width, size.width);
            }
        }
        decoding = true;
        decoder.execute(() -> {
            String text = decodeFrame(luma, size);
            runOnUiThread(() -> {
                decoding = false;
                if (text == null || camera != source || finished || isFinishing() || isDestroyed()) return;
                finished = true;
                setResult(RESULT_OK, new Intent().putExtra("qr", text));
                finish();
            });
        });
    }

    private String decodeFrame(byte[] luma, Camera.Size size) {
        try { return PairingQrReader.read(luma, size.width, size.height); }
        catch (RuntimeException rejectedFrame) { return null; }
    }

    private void focus() {
        if (camera == null) return;
        try {
            String mode = camera.getParameters().getFocusMode();
            if (Camera.Parameters.FOCUS_MODE_AUTO.equals(mode)) {
                camera.cancelAutoFocus();
                camera.autoFocus((success, source) -> {});
            } else if (Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE.equals(mode)) camera.cancelAutoFocus();
        } catch (RuntimeException unavailable) { /* Keep scanning. */ }
    }

    private void toggleFlash() {
        if (camera == null) return;
        try {
            Camera.Parameters settings = camera.getParameters();
            boolean enabled = Camera.Parameters.FLASH_MODE_TORCH.equals(settings.getFlashMode());
            settings.setFlashMode(enabled ? Camera.Parameters.FLASH_MODE_OFF : Camera.Parameters.FLASH_MODE_TORCH);
            camera.setParameters(settings);
            flash.setText(enabled ? "تشغيل الإضاءة" : "إطفاء الإضاءة");
        } catch (RuntimeException unavailable) { flash.setVisibility(View.GONE); }
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}
    @Override public void surfaceDestroyed(SurfaceHolder holder) { release(); }
    @Override protected void onDestroy() { release(); decoder.shutdownNow(); super.onDestroy(); }

    private void release() {
        if (camera != null) {
            Camera opened = camera;
            camera = null;
            try { opened.setPreviewCallback(null); opened.stopPreview(); }
            catch (RuntimeException stopped) { /* Surface already closed. */ }
            finally { opened.release(); }
        }
    }
}
