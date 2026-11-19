package iq.erp.zktcompanion;

import com.google.zxing.BinaryBitmap;
import com.google.zxing.DecodeHintType;
import com.google.zxing.LuminanceSource;
import com.google.zxing.PlanarYUVLuminanceSource;
import com.google.zxing.ReaderException;
import com.google.zxing.common.HybridBinarizer;
import com.google.zxing.qrcode.QRCodeReader;
import java.util.Collections;
import java.util.Map;

final class PairingQrReader {
    private static final Map<DecodeHintType, ?> HINTS = Collections.singletonMap(DecodeHintType.TRY_HARDER, true);

    static String read(byte[] luminance, int width, int height) {
        if (width <= 0 || height <= 0 || width > luminance.length / height) return null;
        LuminanceSource frame = new PlanarYUVLuminanceSource(luminance, width, height, 0, 0, width, height, false);
        int square = Math.min(width, height);
        LuminanceSource focused = frame.crop((width - square) / 2, (height - square) / 2, square, square);
        for (LuminanceSource source : new LuminanceSource[] {focused, frame, focused.invert(), frame.invert()}) {
            try {
                String result = new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(source)), HINTS).getText();
                // The encrypted pairing payload is validated again before opening.
                if (result.startsWith("ZKT1.") && result.length() <= 4096) return result;
            } catch (ReaderException unreadable) { /* Wait for the next frame. */ }
        }
        return null;
    }
}
