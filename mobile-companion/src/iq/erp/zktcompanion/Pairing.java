package iq.erp.zktcompanion;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.crypto.Cipher;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import org.json.JSONObject;

final class Pairing {
    static JSONObject open(String qr, String code) throws Exception {
        String[] parts = qr.split("\\.", -1);
        if (qr.length() > 4096 || parts.length != 4 || !parts[0].equals("ZKT1") || !code.matches("[0-9]{12}")) {
            throw new IllegalArgumentException();
        }
        Base64.Decoder base64 = Base64.getUrlDecoder();
        byte[] salt = base64.decode(parts[1]), iv = base64.decode(parts[2]);
        if (salt.length != 16 || iv.length != 12) throw new IllegalArgumentException();
        PBEKeySpec spec = new PBEKeySpec(code.toCharArray(), salt, 150_000, 256);
        Cipher engine = Cipher.getInstance("AES/GCM/NoPadding");
        try {
            byte[] key = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).getEncoded();
            engine.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new GCMParameterSpec(128, iv));
            java.util.Arrays.fill(key, (byte) 0);
        } finally { spec.clearPassword(); }
        JSONObject result = new JSONObject(new String(engine.doFinal(base64.decode(parts[3])), StandardCharsets.UTF_8));
        long remaining = result.getLong("pair_until") - System.currentTimeMillis();
        URI origin = URI.create(result.getString("server_url"));
        if (remaining <= 0 || remaining > 6 * 60_000 || !"https".equals(origin.getScheme()) || origin.getHost() == null
            || origin.getUserInfo() != null || !origin.getRawPath().isEmpty() || origin.getQuery() != null || origin.getFragment() != null
            || !result.getString("device_id").matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
            || !result.getString("operator_id").matches("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
            || !result.getString("sync_key").matches("zkm_[a-f0-9]{64}") || !isLan(result.getString("device_ip"))
            || result.getString("serial").trim().isEmpty() || result.getString("serial").length() > 64) {
            throw new IllegalArgumentException();
        }
        return result;
    }

    static boolean isLan(String value) {
        if (!value.matches("[0-9]{1,3}(\\.[0-9]{1,3}){3}")) return false;
        String[] pieces = value.split("\\.");
        int a = Integer.parseInt(pieces[0]), b = Integer.parseInt(pieces[1]);
        int c = Integer.parseInt(pieces[2]), d = Integer.parseInt(pieces[3]);
        return b <= 255 && c <= 255 && d > 0 && d < 255 &&
            (a == 10 || (a == 172 && b >= 16 && b <= 31) || (a == 192 && b == 168) || (a == 169 && b == 254));
    }
}
