package iq.erp.zktcompanion;

import android.net.Network;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONObject;

final class SyncClient {
    static void send(Network internet, JSONObject pairing, String body, int count) throws Exception {
        String timestamp = Long.toString(System.currentTimeMillis());
        String secret = pairing.getString("sync_key");
        URL url = new URL(pairing.getString("server_url") + "/api/public/zk-sync");
        HttpsURLConnection request = (HttpsURLConnection) internet.openConnection(url);
        try {
            request.setConnectTimeout(12000);
            request.setReadTimeout(30000);
            request.setInstanceFollowRedirects(false);
            request.setRequestMethod("POST");
            request.setRequestProperty("Content-Type", "application/json");
            request.setRequestProperty("X-Device-Key", secret);
            request.setRequestProperty("X-Timestamp", timestamp);
            request.setRequestProperty("X-Signature", signature(secret, timestamp, body));
            request.setDoOutput(true);
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            request.setFixedLengthStreamingMode(bytes.length);
            try (java.io.OutputStream stream = request.getOutputStream()) { stream.write(bytes); }
            int status = request.getResponseCode();
            if (status == 401) throw new IOException("انتهى تصريح الهاتف أو أُلغي. أعد ربط الجهاز وتحقق من ضبط ساعة الهاتف.");
            if (status == 409) throw new IOException("تعارضت هوية الدفعة. راجع ربط الجهاز بالمشرف الذي بدأ السحب.");
            if (status != 200) throw new IOException("تعذر رفع الدفعة. الحركات محفوظة في الهاتف. (" + status + ")");
            JSONObject result;
            try (java.io.InputStream input = request.getInputStream()) {
                ByteArrayOutputStream response = new ByteArrayOutputStream();
                byte[] block = new byte[1024];
                for (int n; (n = input.read(block)) != -1; ) {
                    if (response.size() + n > 8192) throw new IOException("استجابة المزامنة غير صالحة.");
                    response.write(block, 0, n);
                }
                result = new JSONObject(new String(response.toByteArray(), StandardCharsets.UTF_8));
            }
            if (result.getInt("inserted") + result.getInt("duplicates") + result.getInt("unmatched") != count) {
                throw new IOException("لم يؤكد النظام استلام الدفعة بأكملها. الحركات محفوظة في الهاتف.");
            }
        } finally { request.disconnect(); }
    }

    static String signature(String secret, String timestamp, String body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        char[] alphabet = "0123456789abcdef".toCharArray();
        byte[] hash = mac.doFinal((timestamp + "." + body).getBytes(StandardCharsets.UTF_8));
        StringBuilder text = new StringBuilder(hash.length * 2);
        for (byte value : hash) text.append(alphabet[(value & 255) >>> 4]).append(alphabet[value & 15]);
        return text.toString();
    }
}
