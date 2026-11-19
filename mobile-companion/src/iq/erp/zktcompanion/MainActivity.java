package iq.erp.zktcompanion;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.ArrayAdapter;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.Spinner;
import android.widget.TextView;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
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
    private static final int IMPORT_SETTINGS = 101;
    private static final String[] TRANSPORTS = {"auto", "tcp", "udp"};
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ConnectivityManager connectivity;
    private LocalStore store;
    private JSONObject settings;
    private LinearLayout layout;
    private TextView configurationState, networkState, counts, feedback;
    private EditText address, port, password;
    private CheckBox utc;
    private Spinner transport;
    private Button importSettings, testConnection, pull, retry;
    private ProgressBar progress;
    private boolean busy;
    private boolean foreground;
    private Network observedInternet;
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
        TextView title = addText("وكيل البصمة الميداني", 26);
        title.setTextColor(Color.rgb(23, 60, 51));
        configurationState = addText("نزّل ملف إعداد الوكيل من النظام ثم استورده هنا.", 15);
        importSettings = button("استيراد ملف إعداد الجهاز", this::chooseConfiguration);
        address = field("عنوان الجهاز", "192.168.1.201", InputType.TYPE_CLASS_PHONE);
        port = field("منفذ الاتصال", "4370", InputType.TYPE_CLASS_NUMBER);
        password = field("مفتاح الاتصال بالجهاز (اختياري)", "", InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        TextView transportLabel = addText("وسيلة الاتصال بالجهاز", 15);
        transport = new Spinner(this);
        transport.setId(View.generateViewId());
        transportLabel.setLabelFor(transport.getId());
        transport.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, new String[] {"تلقائي (TCP ثم UDP)", "TCP", "UDP"}));
        layout.addView(transport);
        utc = new CheckBox(this);
        utc.setText("ساعة الجهاز مضبوطة على UTC (الافتراضي توقيت بغداد)");
        layout.addView(utc);
        networkState = addText("", 15);
        testConnection = button("اختبار اتصال الجهاز", () -> startSync(true));
        pull = button("سحب الحركات الآن", () -> startSync(false));
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
            feedback.setText("تعذر قراءة الإعدادات المحفوظة. استورد ملف الجهاز مجددًا.");
        }
        controls(false);
        updateNetwork();
        connectivity.registerNetworkCallback(new NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN).build(), networkCallback);
    }

    private void startSync(boolean testOnly) {
        JSONObject active = settings;
        if (active == null) {
            new AlertDialog.Builder(this).setTitle("استورد ملف إعداد الجهاز أولًا")
                .setMessage("نزّل ملف إعداد الوكيل من صفحة «سحب البصمة بالهاتف» في النظام.")
                .setPositiveButton("استيراد الملف", (dialog, option) -> chooseConfiguration())
                .setNegativeButton("إغلاق", null).show();
            return;
        }
        String ip = address.getText().toString().trim();
        String portText = port.getText().toString().trim();
        String passwordText = password.getText().toString().trim();
        int devicePort, devicePassword;
        try {
            devicePort = Integer.parseInt(portText);
            devicePassword = passwordText.isEmpty() ? 0 : Integer.parseInt(passwordText);
            if (!AgentConfiguration.isLan(ip) || devicePort < 1 || devicePort > 65535 || devicePassword < 0) throw new IllegalArgumentException();
        } catch (IllegalArgumentException error) {
            feedback.setText("أدخل عنوان IPv4 محليًا ومنفذًا صالحًا ومفتاح اتصال رقميًا.");
            return;
        }
        boolean utcSelected = utc.isChecked();
        String mode = TRANSPORTS[transport.getSelectedItemPosition()];
        runWork("جارٍ الاتصال بجهاز البصمة…", () -> {
            active.put("device_ip", ip).put("device_port", devicePort).put("device_password", devicePassword).put("utc", utcSelected).put("transport", mode);
            store.configure(active);
            int[] pulled = {0};
            ZoneId zone = ZoneId.of(utcSelected ? "UTC" : "Asia/Baghdad");
            String serial = active.getString("serial");
            ZkReader.Records save = logs -> {
                    String id = UUID.randomUUID().toString();
                    String body = new JSONObject().put("device_id", active.getString("device_id"))
                        .put("pulled_at", java.time.Instant.now().toString())
                        .put("batch_id", id).put("serial", active.getString("serial")).put("logs", logs).toString();
                    store.enqueue(active, body, id, logs.length());
                    pulled[0] += logs.length();
                    postCounts(pulled[0], 0, 0);
            };
            String first = "udp".equals(mode) ? "UDP" : "TCP";
            try {
                readDevice(ip, devicePort, devicePassword, serial, first, testOnly, zone, save);
            } catch (IOException failure) {
                if (!"auto".equals(mode) || pulled[0] > 0 || failure instanceof ZkReader.DeviceIdentityException) throw failure;
                readDevice(ip, devicePort, devicePassword, serial, "UDP", testOnly, zone, save);
            }
            if (!testOnly) {
                if (pulled[0] == 0 && store.pending().length == 0) postFeedback("نجح الاتصال، ولم يرجع الجهاز أي حركات حضور.");
                else upload(pulled[0]);
            }
        });
    }

    private void readDevice(String ip, int port, int password, String serial, String protocol, boolean testOnly,
                            ZoneId zone, ZkReader.Records destination) throws Exception {
        postFeedback("جارٍ الاتصال عبر " + protocol + " بـ " + ip + ":" + port + "…");
        try (ZkReader reader = connect(ip, port, protocol)) {
            reader.start(password, serial);
            if (testOnly) {
                postFeedback("نجح الاتصال عبر " + protocol + " وتطابق رقم الجهاز " + serial + ".");
                return;
            }
            postFeedback("نجح الاتصال عبر " + protocol + ". جارٍ قراءة الحركات…");
            reader.readAttendance(zone, destination);
        } catch (java.net.SocketTimeoutException | java.net.ConnectException | java.net.NoRouteToHostException failure) {
            throw new IOException("تعذر الوصول إلى " + ip + ":" + port + " عبر " + protocol + ". تحقق من شبكة الهاتف وعنوان الجهاز والمنفذ.", failure);
        } catch (ZkReader.DeviceException failure) {
            throw new IOException(failure.getMessage() + " (" + protocol + ")", failure);
        }
    }

    private ZkReader connect(String ip, int devicePort, String protocol) throws IOException {
        Network wifi = network(false);
        InetSocketAddress endpoint = new InetSocketAddress(ip, devicePort);
        if ("TCP".equals(protocol)) {
            Socket socket = wifi == null ? new Socket() : wifi.getSocketFactory().createSocket();
            try {
                socket.connect(endpoint, 5000);
                return new ZkReader(socket);
            } catch (IOException failure) { socket.close(); throw failure; }
        }
        DatagramSocket datagram = new DatagramSocket();
        try {
            if (wifi != null) wifi.bindSocket(datagram);
            return new ZkReader(datagram, endpoint);
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
            Network internet = network(true);
            boolean cameOnline = internet != null && !internet.equals(observedInternet);
            observedInternet = internet;
            networkState.setText((network(false) == null ? "شبكة الجهاز: تحقق من الواي فاي أو نقطة الاتصال" : "شبكة محلية متاحة؛ اختبر اتصال الجهاز")
                + "\n" + (internet == null ? "الإنترنت: غير متاح" : "الإنترنت: متصل"));
            if (foreground && cameOnline && !busy && store.pending().length > 0) startRetry();
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
        importSettings.setEnabled(!active);
        testConnection.setEnabled(!active);
        pull.setEnabled(!active);
        retry.setEnabled(!active && store.pending().length > 0);
        progress.setVisibility(active ? View.VISIBLE : View.GONE);
    }

    private void chooseConfiguration() {
        Intent select = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        try { startActivityForResult(select, IMPORT_SETTINGS); }
        catch (android.content.ActivityNotFoundException failure) { feedback.setText("تعذر فتح مدير الملفات في الهاتف."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != IMPORT_SETTINGS || result != RESULT_OK || data == null || data.getData() == null) return;
        worker.execute(() -> {
            try (InputStream source = getContentResolver().openInputStream(data.getData())) {
                JSONObject imported = AgentConfiguration.read(source);
                String origin = imported.getString("server_url"), serial = imported.getString("serial");
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    new AlertDialog.Builder(this).setTitle("تأكيد إعداد الوكيل")
                        .setMessage("تحقق من عنوان نظامك قبل إرسال الحركات.\n" + origin + "\nالجهاز " + serial)
                        .setNegativeButton("إلغاء", null).setPositiveButton("حفظ الإعداد", (dialog, which) -> {
                            try {
                                store.configure(imported);
                                settings = imported;
                                showConfiguration();
                                controls(false);
                                feedback.setText("تم حفظ الإعداد. اتصل بشبكة الجهاز واضغط «اختبار اتصال الجهاز».");
                            }
                            catch (Exception failure) { feedback.setText("تعذر حفظ إعداد الوكيل على الهاتف."); }
                        }).show();
                });
            } catch (Exception failure) { postFeedback("تعذر استيراد الملف. اختر ملف إعداد الوكيل الذي نزّلته من النظام."); }
        });
    }

    private void showConfiguration() throws Exception {
        if (settings == null) return;
        configurationState.setText("الجهاز الحالي " + settings.getString("serial") + "\n" + settings.getString("server_url"));
        address.setText(settings.getString("device_ip"));
        port.setText(Integer.toString(settings.optInt("device_port", 4370)));
        int devicePass = settings.optInt("device_password", 0);
        password.setText(devicePass == 0 ? "" : Integer.toString(devicePass));
        utc.setChecked(settings.optBoolean("utc", false));
        transport.setSelection("tcp".equals(settings.optString("transport")) ? 1 : "udp".equals(settings.optString("transport")) ? 2 : 0);
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
    @Override protected void onStart() { super.onStart(); foreground = true; observedInternet = null; updateNetwork(); }
    @Override protected void onStop() { foreground = false; super.onStop(); }
    @Override protected void onDestroy() {
        connectivity.unregisterNetworkCallback(networkCallback);
        worker.shutdown();
        super.onDestroy();
    }
}
