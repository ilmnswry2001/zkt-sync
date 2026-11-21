package iq.erp.zktcompanion;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

final class AgentDevices {
    private final Map<String, JSONObject> devices;
    private final String selected;

    private AgentDevices(Map<String, JSONObject> devices, String selected) {
        this.devices = devices;
        this.selected = selected;
    }

    static AgentDevices empty() { return new AgentDevices(new LinkedHashMap<>(), ""); }

    static AgentDevices read(JSONObject stored, JSONObject legacy) throws Exception {
        Map<String, JSONObject> devices = new LinkedHashMap<>();
        String selected = "";
        if (stored != null) {
            JSONArray entries = stored.getJSONArray("devices");
            for (int i = 0; i < entries.length(); i++) {
                JSONObject device = entries.getJSONObject(i);
                devices.put(key(device), device);
            }
            selected = stored.optString("selected");
        } else if (legacy != null) {
            selected = key(legacy);
            devices.put(selected, legacy);
        }
        if (!devices.containsKey(selected) && !devices.isEmpty()) selected = devices.keySet().iterator().next();
        return new AgentDevices(devices, selected);
    }

    static String key(JSONObject device) {
        return device.optString("server_url") + "\n" + device.optString("device_id");
    }

    AgentDevices withDevices(List<JSONObject> imported) {
        Map<String, JSONObject> next = new LinkedHashMap<>(devices);
        String current = selected;
        for (JSONObject device : imported) {
            current = key(device);
            next.put(current, device);
        }
        return new AgentDevices(next, current);
    }

    AgentDevices select(JSONObject device) { return new AgentDevices(devices, key(device)); }
    JSONObject selected() { return devices.get(selected); }
    List<JSONObject> all() { return new ArrayList<>(devices.values()); }

    JSONObject credentialFor(JSONObject original) {
        JSONObject latest = devices.get(key(original));
        return latest != null && latest.optString("operator_id").equals(original.optString("operator_id")) ? latest : original;
    }

    interface DeviceRead { void read(JSONObject device) throws Exception; }

    int pullAll(DeviceRead reader, java.util.function.BiConsumer<JSONObject, Exception> onFailure) {
        int succeeded = 0;
        for (JSONObject device : devices.values()) {
            try {
                reader.read(device);
                succeeded++;
            } catch (Exception failure) { onFailure.accept(device, failure); }
        }
        return succeeded;
    }

    JSONObject stored() throws Exception {
        return new JSONObject().put("devices", new JSONArray(devices.values())).put("selected", selected);
    }
}
