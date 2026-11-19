package iq.erp.zktcompanion;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.Comparator;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class LocalStore {
    private final File folder;
    private SecretKey key;

    LocalStore(Context context) { folder = context.getNoBackupFilesDir(); }

    JSONObject configuration() throws Exception {
        File target = new File(folder, "pairing");
        return target.exists() || new File(folder, "pairing.bak").exists() ? read(target) : null;
    }

    void configure(JSONObject settings) throws Exception { write(new File(folder, "pairing"), settings); }

    File[] pending() {
        File[] files = folder.listFiles((dir, name) -> name.startsWith("batch-") && name.endsWith(".enc"));
        if (files == null) return new File[0];
        Arrays.sort(files, Comparator.comparing(File::getName));
        return files;
    }

    void enqueue(JSONObject configuration, String body, String batchId, int count) throws Exception {
        long used = 0;
        for (File file : pending()) used += file.length();
        if (used + body.length() * 4L > 64L * 1024 * 1024) throw new IOException("امتلأت قائمة الحركات المحفوظة. أرسل الحركات المحفوظة ثم أعد السحب.");
        JSONObject item = new JSONObject().put("configuration", configuration).put("body", body).put("count", count);
        write(new File(folder, "batch-" + System.currentTimeMillis() + "-" + batchId + ".enc"), item);
    }

    JSONObject read(File source) throws Exception {
        byte[] sealed = new AtomicFile(source).readFully();
        if (sealed.length < 28) throw new IOException("تعذر قراءة الحركات المحفوظة.");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, sealed, 0, 12));
        cipher.updateAAD(source.getName().getBytes(StandardCharsets.UTF_8));
        return new JSONObject(new String(cipher.doFinal(sealed, 12, sealed.length - 12), StandardCharsets.UTF_8));
    }

    private void write(File destination, JSONObject plaintext) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        cipher.updateAAD(destination.getName().getBytes(StandardCharsets.UTF_8));
        byte[] sealed = cipher.doFinal(plaintext.toString().getBytes(StandardCharsets.UTF_8));
        AtomicFile file = new AtomicFile(destination);
        FileOutputStream stream = file.startWrite();
        try {
            stream.write(cipher.getIV());
            stream.write(sealed);
            file.finishWrite(stream);
        } catch (IOException error) {
            file.failWrite(stream);
            throw error;
        }
    }

    private synchronized SecretKey key() throws Exception {
        if (key != null) return key;
        String name = "zkt-companion-local-storage";
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        key = (SecretKey) store.getKey(name, null);
        if (key == null) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
            key = generator.generateKey();
        }
        return key;
    }
}
