package iq.erp.zktcompanion;

import android.app.Activity;
import android.content.Intent;
import android.graphics.ImageFormat;
import android.hardware.Camera;
import android.os.Bundle;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import com.google.zxing.BinaryBitmap;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@SuppressWarnings("deprecation")
public final class ScannerActivity extends Activity implements SurfaceHolder.Callback {
    private final ExecutorService decoder = Executors.newSingleThreadExecutor();
    private Camera camera;

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        layout.setFitsSystemWindows(true);
        TextView heading = new TextView(this);
        heading.setText("وجّه الكاميرا نحو رمز الربط في النظام");
        heading.setTextSize(18);
        heading.setPadding(24, 24, 24, 24);
        layout.addView(heading);
        SurfaceView surface = new SurfaceView(this);
        layout.addView(surface, new LinearLayout.LayoutParams(-1, 0, 1));
        surface.getHolder().addCallback(this);
        setContentView(layout);
    }

    @Override public void surfaceCreated(SurfaceHolder holder) {
        try {
            camera = Camera.open();
            Camera.Parameters settings = camera.getParameters();
            settings.setPreviewFormat(ImageFormat.NV21);
            if (settings.getSupportedFocusModes().contains(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE))
                settings.setFocusMode(Camera.Parameters.FOCUS_MODE_CONTINUOUS_PICTURE);
            camera.setParameters(settings);
            camera.setDisplayOrientation(90);
            camera.setPreviewDisplay(holder);
            camera.startPreview();
            scanNext();
        } catch (Exception failure) {
            Toast.makeText(this, "تعذر تشغيل الكاميرا.", Toast.LENGTH_LONG).show();
            finish();
        }
    }

    private void scanNext() {
        if (camera == null || isFinishing()) return;
        camera.setOneShotPreviewCallback((frame, source) -> {
            Camera.Size size = source.getParameters().getPreviewSize();
            decoder.execute(() -> {
                try {
                    PlanarYUVLuminanceSource image = new PlanarYUVLuminanceSource(frame, size.width, size.height,
                        0, 0, size.width, size.height, false);
                    String text = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(image))).getText();
                    runOnUiThread(() -> {
                        if (isFinishing() || isDestroyed()) return;
                        setResult(RESULT_OK, new Intent().putExtra("qr", text));
                        finish();
                    });
                } catch (ReaderException missing) { runOnUiThread(this::scanNext); }
            });
        });
    }

    @Override public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {}
    @Override public void surfaceDestroyed(SurfaceHolder holder) { release(); }
    @Override protected void onDestroy() { release(); decoder.shutdownNow(); super.onDestroy(); }

    private void release() {
        if (camera != null) {
            camera.setPreviewCallback(null);
            camera.stopPreview();
            camera.release();
            camera = null;
        }
    }
}
