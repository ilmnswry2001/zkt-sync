package iq.erp.zktcompanion;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

final class AgentConfiguration {
    static List<JSONObject> readAll(InputStream source) throws Exception {
        if (source == null) throw new IOException("تعذر فتح ملف إعداد الوكيل.");
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] block = new byte[1024];
        for (int count; (count = source.read(block)) != -1; ) {
            if (bytes.size() + count > 2 * 1024 * 1024) throw new IOException("ملف إعداد الوكيل أكبر من الحد المسموح.");
            bytes.write(block, 0, count);
        }
        String content = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        if (content.startsWith("\uFEFF")) content = content.substring(1);
        JSONObject config = new JSONObject(content);
        if (!"zkteco-mobile-agent-bundle-v1".equals(config.optString("format"))) {
            return Collections.singletonList(readDevice(config));
        }
        JSONArray entries = config.getJSONArray("devices");
        if (entries.length() == 0 || entries.length() > 2000) throw new IOException("عدد الأجهزة في ملف الإعداد غير صالح.");
        List<JSONObject> devices = new ArrayList<>(entries.length());
        for (int i = 0; i < entries.length(); i++) devices.add(readDevice(entries.getJSONObject(i)));
        return devices;
    }

    private static JSONObject readDevice(JSONObject config) throws Exception {
        URI url = new URI(config.getString("sync_url"));
        String ip = config.getString("device_ip");
        String serial = config.getString("serial").trim();
        String credential = config.getString("device_key");
        int port = config.optInt("device_port", 4370);
        int password = config.optInt("device_password", 0);
        String mode = config.optString("transport", "auto");
        String zone = config.optString("time_zone", "Asia/Baghdad");
        if (!"zkteco-mobile-agent-v1".equals(config.optString("format")) || !"https".equals(url.getScheme())
            || url.getHost() == null || url.getUserInfo() != null || url.getRawQuery() != null || url.getRawFragment() != null
            || !"/api/public/zk-sync".equals(url.getRawPath()) || !isLan(ip) || serial.isEmpty() || serial.length() > 64
            || !credential.matches("zkm_[a-f0-9]{64}") || !uuid(config.getString("device_id")) || !uuid(config.getString("operator_id"))
            || port < 1 || port > 65535 || password < 0 || !mode.matches("auto|tcp|udp") || !zone.matches("Asia/Baghdad|UTC")) {
            throw new IOException("ملف إعداد الوكيل غير صالح. نزّل ملف الجهاز مجددًا من صفحة النظام.");
        }
        String origin = new URI("https", null, url.getHost(), url.getPort(), null, null, null).toString();
        return new JSONObject().put("server_url", origin).put("device_id", config.getString("device_id"))
            .put("operator_id", config.getString("operator_id")).put("device_ip", ip).put("serial", serial)
            .put("sync_key", credential).put("device_port", port).put("device_password", password)
            .put("transport", mode).put("utc", "UTC".equals(zone));
    }

    private static boolean uuid(String value) { return value.matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"); }

    static boolean isLan(String value) {
        if (!value.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] pieces = value.split("\\.");
        int a = Integer.parseInt(pieces[0]), b = Integer.parseInt(pieces[1]);
        int c = Integer.parseInt(pieces[2]), d = Integer.parseInt(pieces[3]);
        return b <= 255 && c <= 255 && d > 0 && d < 255 &&
            (a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254));
    }
}
