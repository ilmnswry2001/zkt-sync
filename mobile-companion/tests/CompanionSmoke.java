package iq.erp.zktcompanion;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.time.ZoneId;
import java.util.Arrays;
import java.util.concurrent.FutureTask;
import org.json.JSONArray;
import org.json.JSONObject;

public final class CompanionSmoke {
    public static void main(String[] args) throws Exception {
        JSONObject fixture = new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])), java.nio.charset.StandardCharsets.UTF_8));
        verifyConfiguration(fixture);
        verifyTcp();
        verifyUdp();
        System.out.println("Agent file import, HMAC, TCP and UDP passed");
    }

    private static void verifyConfiguration(JSONObject fixture) throws Exception {
        String file = fixture.getString("file");
        JSONObject imported = readConfig("\uFEFF" + file);
        check(imported.getString("serial").equals("TEST-001"), "Could not import agent configuration");
        check(imported.getInt("device_port") == 4370 && imported.getString("transport").equals("auto"), "Incorrect agent defaults");
        check(imported.getString("server_url").equals("https://erp.example.test"), "Incorrect upload destination");
        try {
            readConfig(file.replace("https://", "http://"));
            throw new AssertionError("Insecure upload destination accepted");
        } catch (java.io.IOException expected) { /* Invalid configuration. */ }
        check(SyncClient.signature(imported.getString("sync_key"), fixture.getString("timestamp"), fixture.getString("body"))
            .equals(fixture.getString("signature")), "Request signature mismatch");
    }

    private static JSONObject readConfig(String file) throws Exception {
        return AgentConfiguration.read(new ByteArrayInputStream(file.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }

    private static void verifyTcp() throws Exception {
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            FutureTask<Void> mock = new FutureTask<>(() -> {
                try (Socket stream = server.accept()) { stream.setSoTimeout(5000); emulate(new Tcp(stream)); }
                return null;
            });
            new Thread(mock).start();
            try (ZkReader client = new ZkReader(new Socket(InetAddress.getLoopbackAddress(), server.getLocalPort()))) {
                verifyRows(client);
            }
            mock.get();
        }
    }

    private static void verifyUdp() throws Exception {
        try (DatagramSocket server = new DatagramSocket(0, InetAddress.getLoopbackAddress())) {
            server.setSoTimeout(5000);
            FutureTask<Void> mock = new FutureTask<>(() -> { emulate(new Udp(server)); return null; });
            new Thread(mock).start();
            try (ZkReader client = new ZkReader(new DatagramSocket(), new InetSocketAddress(InetAddress.getLoopbackAddress(), server.getLocalPort()))) {
                verifyRows(client);
            }
            mock.get();
        }
    }

    private static void verifyRows(ZkReader reader) throws Exception {
        reader.start(0, "TEST-001");
        JSONArray result = new JSONArray();
        reader.readAttendance(ZoneId.of("Asia/Baghdad"), rows -> result.put(rows.getJSONObject(0)));
        check(result.length() == 1, "Wrong row count");
        check(result.getJSONObject(0).getString("user_pin").equals("00027"), "Device PIN lost its leading zeros");
        check(result.getJSONObject(0).getString("verify_time").equals("2026-11-19T07:15:00+03:00"), "Wrong Baghdad time");
    }

    private static void emulate(Transport wire) throws Exception {
        require(wire, 1000); respond(wire, 2000, new byte[0]);
        require(wire, 11); respond(wire, 2000, "~SerialNumber=TEST-001\0".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        require(wire, 50); respond(wire, 2000, bytes(80).putInt(32, 1).array());
        ByteBuffer request = require(wire, 1503);
        check(request.getShort(9) == 13, "Requested a table other than attendance");
        respond(wire, 2000, bytes(5).put((byte) 0).putInt(44).array());
        request = require(wire, 1504);
        check(request.getInt(8) == 0 && request.getInt(12) == 44, "Incorrect buffer request");
        int stamp = (((26 * 12 + 10) * 31 + 18) * 24 + 7) * 3600 + 15 * 60;
        ByteBuffer record = bytes(44).putInt(40).putShort((short) 10).put("00027".getBytes(java.nio.charset.StandardCharsets.US_ASCII));
        record.put(30, (byte) 1).putInt(31, stamp).put(35, (byte) 0);
        respond(wire, 1500, bytes(4).putInt(44).array());
        respond(wire, 1501, record.array());
        respond(wire, 2000, new byte[0]);
        require(wire, 1502); respond(wire, 2000, new byte[0]);
        require(wire, 1001); respond(wire, 2000, new byte[0]);
    }

    private static ByteBuffer require(Transport wire, int command) throws Exception {
        ByteBuffer packet = ByteBuffer.wrap(wire.read()).order(ByteOrder.LITTLE_ENDIAN);
        check(Short.toUnsignedInt(packet.getShort(0)) == command, "Unexpected command " + packet.getShort(0));
        return packet;
    }
    private static void respond(Transport wire, int code, byte[] data) throws Exception {
        wire.send(bytes(8 + data.length).putShort((short) code).putShort((short) 0).putShort((short) 7)
            .putShort((short) 2).put(data).array());
    }
    private static ByteBuffer bytes(int size) { return ByteBuffer.allocate(size).order(ByteOrder.LITTLE_ENDIAN); }
    private static void check(boolean ok, String error) { if (!ok) throw new AssertionError(error); }

    private interface Transport { byte[] read() throws Exception; void send(byte[] data) throws Exception; }
    private static final class Tcp implements Transport {
        final Socket socket;
        Tcp(Socket socket) { this.socket = socket; }
        public byte[] read() throws Exception {
            DataInputStream input = new DataInputStream(socket.getInputStream());
            byte[] header = new byte[8]; input.readFully(header);
            ByteBuffer frame = ByteBuffer.wrap(header).order(ByteOrder.LITTLE_ENDIAN);
            check(frame.getInt(0) == 0x72825050, "Wrong frame magic");
            byte[] payload = new byte[frame.getInt(4)]; input.readFully(payload);
            return payload;
        }
        public void send(byte[] data) throws Exception {
            byte[] frame = bytes(8 + data.length).putInt(0x72825050).putInt(data.length).put(data).array();
            socket.getOutputStream().write(frame, 0, 5);
            socket.getOutputStream().write(frame, 5, frame.length - 5);
        }
    }
    private static final class Udp implements Transport {
        final DatagramSocket socket;
        DatagramPacket peer;
        Udp(DatagramSocket socket) { this.socket = socket; }
        public byte[] read() throws Exception {
            peer = new DatagramPacket(new byte[2048], 2048); socket.receive(peer);
            return Arrays.copyOf(peer.getData(), peer.getLength());
        }
        public void send(byte[] data) throws Exception { socket.send(new DatagramPacket(data, data.length, peer.getSocketAddress())); }
    }
}
