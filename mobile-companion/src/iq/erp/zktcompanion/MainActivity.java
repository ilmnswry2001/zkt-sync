package iq.erp.zktcompanion;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.File;
import java.io.IOException;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.time.ZoneId;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@SuppressWarnings("deprecation")
public final class MainActivity extends Activity {
    private static final int SCAN = 101, CAMERA = 102;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ConnectivityManager connectivity;
    private LocalStore store;
    private JSONObject settings;
    private LinearLayout layout;
    private TextView pairingState, networkState, counts, feedback;
    private EditText address, port, password;
    private CheckBox utc;
    private Button pair, pull, retry;
    private ProgressBar progress;
    private boolean busy;
    private final ConnectivityManager.NetworkCallback networkCallback = new ConnectivityManager.NetworkCallback() {
        @Override public void onAvailable(Network network) { updateNetwork(); }
        @Override public void onLost(Network network) { updateNetwork(); }
        @Override public void onCapabilitiesChanged(Network network, NetworkCapabilities capabilities) { updateNetwork(); }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        connectivity = getSystemService(ConnectivityManager.class);
        store = new LocalStore(this);
        ScrollView scroll = new ScrollView(this);
        layout = new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);
        layout.setPadding(dp(20), dp(20), dp(20), dp(24));
        scroll.addView(layout);
        scroll.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        setContentView(scroll);
        TextView title = addText("سحب البصمة بالهاتف", 26);
        title.setTextColor(Color.rgb(23, 60, 51));
        pairingState = addText("امسح رمز الربط من نظام إدارة الحضور.", 15);
        pair = button("مسح رمز الربط QR", this::scan);
        address = field("عنوان الجهاز", "192.168.1.201", InputType.TYPE_CLASS_PHONE);
        port = field("منفذ الاتصال", "4370", InputType.TYPE_CLASS_NUMBER);
        password = field("مفتاح الاتصال بالجهاز (اختياري)", "", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        utc = new CheckBox(this);
        utc.setText("ساعة الجهاز مضبوطة على UTC (الافتراضي توقيت بغداد)");
        layout.addView(utc);
        networkState = addText("", 15);
        pull = button("فحص الاتصال وسحب الحركات الآن", this::startPull);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setVisibility(View.GONE);
        layout.addView(progress, new LinearLayout.LayoutParams(-1, dp(8)));
        counts = addText("تم السحب 0  ·  تم الرفع 0", 16);
        feedback = addText("", 15);
        feedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        retry = button("إعادة إرسال الحركات المحفوظة", this::startRetry);
        try {
            settings = store.configuration();
            showConfiguration();
        } catch (Exception error) {
            feedback.setText("تعذر قراءة إعدادات الربط المحفوظة. أعد ربط التطبيق.");
        }
        controls(false);
        updateNetwork();
        connectivity.registerNetworkCallback(new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build(), networkCallback);
    }

    private void startPull() {
        String ip = address.getText().toString().trim();
        String portText = port.getText().toString().trim();
        String passwordText = password.getText().toString().trim();
        int devicePort, devicePassword;
        try {
            devicePort = Integer.parseInt(portText);
            devicePassword = passwordText.isEmpty() ? 0 : Integer.parseInt(passwordText);
            if (!Pairing.isLan(ip) || devicePort < 1 || devicePort > 65535 || devicePassword < 0) throw new IllegalArgumentException();
        } catch (IllegalArgumentException error) {
            feedback.setText("أدخل عنوان IPv4 محليًا ومنفذًا صالحًا ومفتاح اتصال رقميًا.");
            return;
        }
        boolean utcSelected = utc.isChecked();
        JSONObject active = settings;
        runWork("جارٍ الاتصال بجهاز البصمة…", () -> {
            active.put("device_ip", ip).put("device_port", devicePort).put("device_password", devicePassword).put("utc", utcSelected);
            store.configure(active);
            int[] pulled = {0};
            try (ZkReader reader = connect(ip, devicePort, devicePassword, active.getString("serial"))) {
                postFeedback("تم الاتصال بالجهاز. جارٍ قراءة الحركات…");
                reader.readAttendance(ZoneId.of(utcSelected ? "UTC" : "Asia/Baghdad"), logs -> {
                    String id = UUID.randomUUID().toString();
                    String body = new JSONObject().put("device_id", active.getString("device_id"))
                        .put("pulled_at", java.time.Instant.now().toString())
                        .put("batch_id", id).put("serial", active.getString("serial")).put("logs", logs).toString();
                    store.enqueue(active, body, id, logs.length());
                    pulled[0] += logs.length();
                    postCounts(pulled[0], 0, 0);
                });
            }
            upload(pulled[0]);
        });
    }

    private ZkReader connect(String ip, int devicePort, int devicePassword, String serial) throws IOException {
        Network wifi = network(false);
        InetSocketAddress endpoint = new InetSocketAddress(ip, devicePort);
        Socket socket = wifi == null ? new Socket() : wifi.getSocketFactory().createSocket();
        try {
            socket.connect(endpoint, 3500);
            ZkReader reader = new ZkReader(socket);
            reader.start(devicePassword, serial);
            return reader;
        } catch (IOException failure) {
            socket.close();
            if (failure instanceof ZkReader.DeviceException) throw failure;
        }
        DatagramSocket datagram = new DatagramSocket();
        try {
            if (wifi != null) wifi.bindSocket(datagram);
            ZkReader reader = new ZkReader(datagram, endpoint);
            reader.start(devicePassword, serial);
            return reader;
        } catch (IOException failure) { datagram.close(); throw failure; }
    }

    private void startRetry() { runWork("جارٍ رفع الحركات المحفوظة…", () -> upload(0)); }

    private void upload(int pulled) throws Exception {
        File[] pending = store.pending();
        if (pending.length == 0) {
            postFeedback("لا توجد حركات محفوظة للإرسال.");
            return;
        }
        Network internet = network(true);
        if (internet == null) {
            postFeedback("الحركات محفوظة في الهاتف. أعد الإرسال عند توفر الإنترنت.");
            return;
        }
        postFeedback("جارٍ رفع الحركات إلى نظام إدارة الحضور…");
        int uploaded = 0;
        Exception firstFailure = null;
        for (int index = 0; index < pending.length; index++) {
            if (Thread.currentThread().isInterrupted()) return;
            File file = pending[index];
            try {
                JSONObject item = store.read(file);
                JSONObject original = item.getJSONObject("configuration");
                JSONObject active = settings;
                if (active != null && active.getString("device_id").equals(original.getString("device_id"))
                    && active.getString("server_url").equals(original.getString("server_url"))
                    && active.getString("operator_id").equals(original.getString("operator_id"))) original = active;
                int count = item.getInt("count");
                SyncClient.send(internet, original, item.getString("body"), count);
                if (!file.delete()) throw new IOException("استلم النظام الدفعة؛ تعذر حذف النسخة المؤقتة من الهاتف.");
                uploaded += count;
            } catch (Exception failure) {
                if (firstFailure == null) firstFailure = failure;
                if (network(true) == null) break;
            }
            postCounts(pulled, uploaded, (index + 1) * 100 / pending.length);
        }
        if (firstFailure != null) throw firstFailure;
        postFeedback("أكّد النظام استلام " + uploaded + " حركة.");
    }

    private interface Work { void execute() throws Exception; }
    private void runWork(String message, Work work) {
        if (busy) return;
        controls(true);
        postFeedback(message);
        postCounts(0, 0, 0);
        worker.execute(() -> {
            try { work.execute(); }
            catch (Exception failure) {
                String detail = failure.getMessage();
                boolean arabic = detail != null && detail.matches("(?s).*[\\u0600-\\u06FF].*");
                postFeedback(arabic ? detail : "تعذر إكمال الاتصال. تحقق من الشبكة والإعدادات ثم أعد المحاولة.");
            } finally { runOnUiThread(() -> { if (!isDestroyed()) controls(false); }); }
        });
    }

    private Network network(boolean internet) {
        Network active = connectivity.getActiveNetwork();
        if (matches(active, internet)) return active;
        for (Network network : connectivity.getAllNetworks()) if (matches(network, internet)) return network;
        return null;
    }

    private boolean matches(Network network, boolean internet) {
        if (network == null) return false;
        NetworkCapabilities type = connectivity.getNetworkCapabilities(network);
        return type != null && (internet ? type.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            : type.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) || type.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET));
    }

    private void updateNetwork() {
        runOnUiThread(() -> {
            if (isDestroyed()) return;
            networkState.setText((network(false) == null ? "شبكة الجهاز: تحقق من الواي فاي أو نقطة الاتصال" : "شبكة محلية متاحة؛ اختبر اتصال الجهاز")
                + "\n" + (network(true) == null ? "الإنترنت: غير متاح" : "الإنترنت: متصل"));
        });
    }
    private void postFeedback(String value) { runOnUiThread(() -> { if (!isDestroyed()) feedback.setText(value); }); }
    private void postCounts(int pulled, int uploaded, int percent) {
        runOnUiThread(() -> {
            if (isDestroyed()) return;
            counts.setText("تم السحب " + pulled + "  ·  تم الرفع " + uploaded);
            progress.setIndeterminate(percent == 0);
            if (percent > 0) progress.setProgress(percent);
        });
    }

    private void controls(boolean active) {
        busy = active;
        pair.setEnabled(!active);
        pull.setEnabled(!active && settings != null);
        retry.setEnabled(!active && store.pending().length > 0);
        progress.setVisibility(active ? View.VISIBLE : View.GONE);
    }

    private void scan() {
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA);
        } else { startActivityForResult(new Intent(this, ScannerActivity.class), SCAN); }
    }

    @Override public void onRequestPermissionsResult(int id, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(id, permissions, grants);
        if (id == CAMERA && grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) scan();
        else if (id == CAMERA) feedback.setText("فَعّل إذن الكاميرا لمسح رمز الربط.");
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != SCAN || result != RESULT_OK || data == null) return;
        String qr = data.getStringExtra("qr");
        if (qr == null) return;
        EditText code = new EditText(this);
        code.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        code.setHint("12 رقمًا");
        code.setFilters(new android.text.InputFilter[] {new android.text.InputFilter.LengthFilter(12)});
        new AlertDialog.Builder(this).setTitle("أدخل رمز الفتح الظاهر في النظام").setView(code)
            .setNegativeButton("إلغاء", null).setPositiveButton("فتح", (dialog, which) -> unlock(qr, code.getText().toString())).show();
    }

    private void unlock(String qr, String code) {
        worker.execute(() -> {
            try {
                JSONObject scanned = Pairing.open(qr, code);
                String origin = scanned.getString("server_url"), serial = scanned.getString("serial");
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    new AlertDialog.Builder(this).setTitle("تأكيد ربط الجهاز")
                        .setMessage("تحقق من عنوان نظامك قبل إرسال الحركات.\n" + origin + "\nالجهاز " + serial)
                        .setNegativeButton("إلغاء", null).setPositiveButton("ربط", (dialog, which) -> {
                            try { store.configure(scanned); settings = scanned; showConfiguration(); controls(false); }
                            catch (Exception failure) { feedback.setText("تعذر حفظ الربط على الهاتف."); }
                        }).show();
                });
            } catch (Exception failure) { postFeedback("تعذر فتح رمز الربط. تحقق من رمز الفتح ومدة صلاحيته."); }
        });
    }

    private void showConfiguration() throws Exception {
        if (settings == null) return;
        pairingState.setText("الجهاز المرتبط " + settings.getString("serial") + "\n" + settings.getString("server_url"));
        address.setText(settings.getString("device_ip"));
        port.setText(Integer.toString(settings.optInt("device_port", 4370)));
        int devicePass = settings.optInt("device_password", 0);
        password.setText(devicePass == 0 ? "" : Integer.toString(devicePass));
        utc.setChecked(settings.optBoolean("utc", false));
    }

    private TextView addText(String value, int size) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setPadding(0, dp(6), 0, dp(7));
        layout.addView(text);
        return text;
    }
    private EditText field(String label, String value, int kind) {
        TextView caption = addText(label, 15);
        EditText input = new EditText(this);
        input.setId(View.generateViewId());
        caption.setLabelFor(input.getId());
        input.setSingleLine();
        input.setInputType(kind);
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        input.setText(value);
        layout.addView(input, new LinearLayout.LayoutParams(-1, -2));
        return input;
    }
    private Button button(String label, Runnable handler) {
        Button button = new Button(this);
        button.setText(label);
        button.setMinHeight(dp(52));
        button.setOnClickListener(view -> handler.run());
        layout.addView(button, new LinearLayout.LayoutParams(-1, -2));
        return button;
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onDestroy() {
        connectivity.unregisterNetworkCallback(networkCallback);
        worker.shutdown();
        super.onDestroy();
    }
}
