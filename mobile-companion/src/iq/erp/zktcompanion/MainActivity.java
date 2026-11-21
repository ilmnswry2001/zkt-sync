package iq.erp.zktcompanion;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.ClipData;
import android.net.Uri;
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
import android.widget.AdapterView;
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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.IntConsumer;
import org.json.JSONObject;

@SuppressWarnings("deprecation")
public final class MainActivity extends Activity {
    private static final int IMPORT_SETTINGS = 101;
    private static final String[] TRANSPORTS = {"auto", "tcp", "udp"};
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private ConnectivityManager connectivity;
    private LocalStore store;
    private volatile AgentDevices configurations = AgentDevices.empty();
    private LinearLayout layout;
    private TextView configurationState, networkState, counts, feedback;
    private EditText address, port, password;
    private CheckBox utc;
    private Spinner transport, devicePicker;
    private Button importSettings, testConnection, pull, pullAll, retry;
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
        importSettings = button("استيراد ملفات إعداد الأجهزة", this::chooseConfiguration);
        TextView deviceLabel = addText("أجهزة البصمة المحفوظة", 15);
        devicePicker = new Spinner(this);
        devicePicker.setId(View.generateViewId());
        deviceLabel.setLabelFor(devicePicker.getId());
        layout.addView(devicePicker);
        devicePicker.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener() {
            @Override public void onItemSelected(AdapterView<?> parent, View view, int index, long id) {
                List<JSONObject> devices = configurations.all();
                if (busy || parent.getSelectedItemPosition() != index || index >= devices.size()
                    || devices.get(index) == configurations.selected()) return;
                try {
                    AgentDevices selected = configurations.select(devices.get(index));
                    store.configure(selected);
                    configurations = selected;
                    showConfiguration();
                    feedback.setText("");
                } catch (Exception failure) {
                    refreshDevicePicker();
                    feedback.setText("تعذر تغيير الجهاز المحدد.");
                }
            }
            @Override public void onNothingSelected(AdapterView<?> parent) {}
        });
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
        pullAll = button("سحب الحركات من كل الأجهزة", this::startSyncAll);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setVisibility(View.GONE);
        layout.addView(progress, new LinearLayout.LayoutParams(-1, dp(8)));
        counts = addText("تم السحب 0  ·  تم الرفع 0", 16);
        feedback = addText("", 15);
        feedback.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        retry = button("إعادة إرسال الحركات المحفوظة", this::startRetry);
        try {
            configurations = store.configurations();
            refreshDevicePicker();
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
        if (busy) return;
        JSONObject active = configurations.selected();
        if (active == null) {
            new AlertDialog.Builder(this).setTitle("استورد ملف إعداد الجهاز أولًا")
                .setMessage("نزّل ملف إعداد الوكيل من صفحة «سحب البصمة بالهاتف» في النظام.")
                .setPositiveButton("استيراد الملف", (dialog, option) -> chooseConfiguration())
                .setNegativeButton("إغلاق", null).show();
            return;
        }
        try {
            JSONObject edited = selectedConfigurationWithEdits(active);
            runWork("جارٍ الاتصال بجهاز البصمة…", () -> {
                saveCurrentConfiguration(edited);
                int[] pulled = {0};
                readConfiguredDevice(edited, testOnly, count -> {
                    pulled[0] += count;
                    postCounts(pulled[0], 0, 0);
                });
                if (!testOnly) {
                    if (pulled[0] == 0 && store.pending().length == 0) postFeedback("نجح الاتصال، ولم يرجع الجهاز أي حركات حضور.");
                    else upload(pulled[0]);
                }
            });
        } catch (Exception error) {
            feedback.setText(failureMessage(error));
        }
    }

    private JSONObject selectedConfigurationWithEdits(JSONObject active) throws Exception {
        String ip = address.getText().toString().trim();
        String portText = port.getText().toString().trim();
        String passwordText = password.getText().toString().trim();
        int devicePort, devicePassword;
        try {
            devicePort = Integer.parseInt(portText);
            devicePassword = passwordText.isEmpty() ? 0 : Integer.parseInt(passwordText);
            if (!AgentConfiguration.isLan(ip) || devicePort < 1 || devicePort > 65535 || devicePassword < 0) throw new IllegalArgumentException();
        } catch (IllegalArgumentException error) {
            throw new IOException("أدخل عنوان IPv4 محليًا ومنفذًا صالحًا ومفتاح اتصال رقميًا.", error);
        }
        return new JSONObject(active.toString()).put("device_ip", ip).put("device_port", devicePort)
            .put("device_password", devicePassword).put("utc", utc.isChecked())
            .put("transport", TRANSPORTS[transport.getSelectedItemPosition()]);
    }

    private void saveCurrentConfiguration(JSONObject edited) throws Exception {
        AgentDevices updated = configurations.withDevices(Collections.singletonList(edited));
        store.configure(updated);
        configurations = updated;
    }

    private void readConfiguredDevice(JSONObject active, boolean testOnly, IntConsumer onSaved) throws Exception {
        String ip = active.getString("device_ip"), serial = active.getString("serial");
        int port = active.optInt("device_port", 4370), password = active.optInt("device_password", 0);
        ZoneId zone = ZoneId.of(active.optBoolean("utc", false) ? "UTC" : "Asia/Baghdad");
        String mode = active.optString("transport", "auto");
        boolean[] saved = {false};
        ZkReader.Records save = logs -> {
            String id = UUID.randomUUID().toString();
            String body = new JSONObject().put("device_id", active.getString("device_id"))
                .put("pulled_at", java.time.Instant.now().toString())
                .put("batch_id", id).put("serial", serial).put("logs", logs).toString();
            store.enqueue(active, body, id, logs.length());
            saved[0] = true;
            onSaved.accept(logs.length());
        };
        try {
            readDevice(ip, port, password, serial, "udp".equals(mode) ? "UDP" : "TCP", testOnly, zone, save);
        } catch (IOException failure) {
            if (!"auto".equals(mode) || saved[0] || failure instanceof ZkReader.DeviceIdentityException) throw failure;
            readDevice(ip, port, password, serial, "UDP", testOnly, zone, save);
        }
    }

    private void startSyncAll() {
        if (busy || configurations.selected() == null) return;
        try {
            JSONObject edited = selectedConfigurationWithEdits(configurations.selected());
            runWork("جارٍ سحب الحركات من الأجهزة المحفوظة…", () -> {
                saveCurrentConfiguration(edited);
                AgentDevices devices = configurations;
                int[] pulled = {0};
                List<String> failures = new ArrayList<>();
                int succeeded = devices.pullAll(device -> readConfiguredDevice(device, false, count -> {
                    pulled[0] += count;
                    postCounts(pulled[0], 0, 0);
                }), (device, failure) -> failures.add(device.optString("serial") + " · " + failureMessage(failure)));
                String summary = "تمت قراءة " + succeeded + " من " + devices.all().size() + " أجهزة."
                    + (failures.isEmpty() ? "" : "\n" + String.join("\n", failures));
                upload(pulled[0], summary + "\n");
            });
        } catch (Exception failure) { feedback.setText(failureMessage(failure)); }
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

    private void upload(int pulled) throws Exception { upload(pulled, ""); }

    private void upload(int pulled, String summary) throws Exception {
        File[] pending = store.pending();
        if (pending.length == 0) {
            postFeedback(summary + "لا توجد حركات محفوظة للإرسال.");
            return;
        }
        Network internet = network(true);
        if (internet == null) {
            postFeedback(summary + "الحركات محفوظة في الهاتف. أعد الإرسال عند توفر الإنترنت.");
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
                JSONObject credential = configurations.credentialFor(item.getJSONObject("configuration"));
                int count = item.getInt("count");
                SyncClient.send(internet, credential, item.getString("body"), count);
                if (!file.delete()) throw new IOException("استلم النظام الدفعة؛ تعذر حذف النسخة المؤقتة من الهاتف.");
                uploaded += count;
            } catch (Exception failure) {
                if (firstFailure == null) firstFailure = failure;
                if (network(true) == null) break;
            }
            postCounts(pulled, uploaded, (index + 1) * 100 / pending.length);
        }
        if (firstFailure != null) throw new IOException(summary + failureMessage(firstFailure), firstFailure);
        postFeedback(summary + "أكّد النظام استلام " + uploaded + " حركة.");
    }

    private interface Work { void execute() throws Exception; }
    private void runWork(String message, Work work) {
        if (busy) return;
        controls(true);
        postFeedback(message);
        postCounts(0, 0, 0);
        worker.execute(() -> {
            try { work.execute(); }
            catch (Exception failure) { postFeedback(failureMessage(failure)); }
            finally { runOnUiThread(() -> { if (!isDestroyed()) controls(false); }); }
        });
    }

    private static String failureMessage(Exception failure) {
        String detail = failure.getMessage();
        return detail != null && detail.matches("(?s).*[\\u0600-\\u06FF].*")
            ? detail : "تعذر إكمال الاتصال. تحقق من الشبكة والإعدادات ثم أعد المحاولة.";
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
        pullAll.setEnabled(!active && configurations.selected() != null);
        devicePicker.setEnabled(!active && configurations.selected() != null);
        address.setEnabled(!active);
        port.setEnabled(!active);
        password.setEnabled(!active);
        transport.setEnabled(!active);
        utc.setEnabled(!active);
        retry.setEnabled(!active && store.pending().length > 0);
        progress.setVisibility(active ? View.VISIBLE : View.GONE);
    }

    private void chooseConfiguration() {
        Intent select = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        try { startActivityForResult(select, IMPORT_SETTINGS); }
        catch (android.content.ActivityNotFoundException failure) { feedback.setText("تعذر فتح مدير الملفات في الهاتف."); }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != IMPORT_SETTINGS || result != RESULT_OK || data == null) return;
        List<Uri> files = new ArrayList<>();
        ClipData selected = data.getClipData();
        if (selected == null && data.getData() != null) files.add(data.getData());
        if (selected != null) for (int i = 0; i < selected.getItemCount(); i++) files.add(selected.getItemAt(i).getUri());
        if (files.isEmpty()) return;
        worker.execute(() -> {
            try {
                List<JSONObject> imported = new ArrayList<>();
                List<String> names = new ArrayList<>();
                for (Uri file : files) {
                    try (InputStream source = getContentResolver().openInputStream(file)) {
                        imported.addAll(AgentConfiguration.readAll(source));
                    }
                }
                for (JSONObject device : imported) names.add(device.getString("server_url"));
                String origins = String.join("\n", new java.util.LinkedHashSet<>(names));
                runOnUiThread(() -> {
                    if (isDestroyed()) return;
                    new AlertDialog.Builder(this).setTitle("تأكيد إعداد الوكيل")
                        .setMessage("تحقق من عنوان النظام قبل إرسال الحركات.\n" + origins + "\nعدد إعدادات الأجهزة: " + imported.size())
                        .setNegativeButton("إلغاء", null).setPositiveButton("حفظ الإعداد", (dialog, which) -> {
                            if (busy) {
                                feedback.setText("انتظر انتهاء المزامنة ثم استورد الملفات مجددًا.");
                                return;
                            }
                            try {
                                AgentDevices updated = configurations.importDevices(imported);
                                store.configure(updated);
                                configurations = updated;
                                refreshDevicePicker();
                                showConfiguration();
                                controls(false);
                                feedback.setText("تم حفظ الإعدادات. يمكنك سحب جهاز محدد أو كل الأجهزة المحفوظة.");
                            }
                            catch (Exception failure) { feedback.setText("تعذر حفظ إعداد الوكيل على الهاتف."); }
                        }).show();
                });
            } catch (Exception failure) { postFeedback("تعذر استيراد الملف. اختر ملف إعداد الوكيل الذي نزّلته من النظام."); }
        });
    }

    private void refreshDevicePicker() {
        List<String> labels = new ArrayList<>();
        int selectedIndex = 0;
        for (JSONObject device : configurations.all()) {
            if (device == configurations.selected()) selectedIndex = labels.size();
            labels.add(device.optString("serial") + " · " + device.optString("device_ip"));
        }
        devicePicker.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item, labels));
        if (!labels.isEmpty()) devicePicker.setSelection(selectedIndex);
    }

    private void showConfiguration() throws Exception {
        JSONObject settings = configurations.selected();
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
