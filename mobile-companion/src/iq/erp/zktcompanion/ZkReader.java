package iq.erp.zktcompanion;

import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.DataInputStream;
import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/** Implements the ZK read commands and framing documented by the pyzk reference client. */
final class ZkReader implements Closeable {
    private static final int MAX_BYTES = 16 * 1024 * 1024;
    private static final int TCP_MAGIC_1 = 0x5050, TCP_MAGIC_2 = 0x7d82;
    private static final int ACK = 2000, UNAUTHORIZED = 2005, DATA = 1501, PREPARE = 1500;
    private final Socket tcp;
    private final DatagramSocket udp;
    private final DataInputStream input;
    private int session;
    private int reply = 65534;

    ZkReader(Socket socket) throws IOException {
        tcp = socket;
        udp = null;
        tcp.setSoTimeout(8000);
        input = new DataInputStream(tcp.getInputStream());
    }

    ZkReader(DatagramSocket socket, InetSocketAddress address) throws IOException {
        tcp = null;
        input = null;
        udp = socket;
        udp.setSoTimeout(8000);
        udp.connect(address);
    }

    void start(int password, String expectedSerial) throws IOException {
        Packet response = send(1000, new byte[0]);
        session = response.session;
        if (response.command == UNAUTHORIZED) response = send(1102, commKey(password, session));
        if (response.command == UNAUTHORIZED) throw new DeviceIdentityException("رفض الجهاز الاتصال. تحقق من مفتاح الاتصال.");
        if (response.command != ACK) throw unsupported();
        response = send(11, "~SerialNumber\0".getBytes(StandardCharsets.US_ASCII));
        String serial = text(response.data, 0, response.data.length);
        int separator = serial.indexOf('=');
        if (separator >= 0) serial = serial.substring(separator + 1).trim();
        if (response.command != ACK || serial.isEmpty()) throw unsupported();
        if (!expectedSerial.equals(serial)) {
            throw new DeviceIdentityException("الرقم التسلسلي للجهاز المتصل يختلف عن الجهاز المرتبط.");
        }
    }

    interface Records { void accept(JSONArray logs) throws Exception; }

    void readAttendance(ZoneId zone, Records destination) throws Exception {
        Packet sizes = send(50, new byte[0]);
        if (sizes.command != ACK || sizes.data.length < 36) throw unsupported();
        int numberOfRecords = le(sizes.data).getInt(32);
        if (numberOfRecords == 0) return;
        if (numberOfRecords < 0 || numberOfRecords > MAX_BYTES / 8) throw unsupported();
        byte[] data = bufferedRead(13, 0);
        int size = payloadSize(data);
        if (size == 0) return;
        if (size % numberOfRecords != 0) throw new DeviceException("تغير عدد الحركات أثناء القراءة. أعد السحب.");
        int width = size / numberOfRecords;
        if (width != 8 && width != 16 && width != 40) throw unsupported();
        Map<Integer, String> pins = width == 8 ? readPins(le(sizes.data).getInt(16)) : new HashMap<>();
        decodeRows(data, width, zone, pins, destination);
    }

    static void decodeRows(byte[] data, int width, ZoneId zone, Map<Integer, String> pins,
                           Records destination) throws Exception {
        ByteBuffer bytes = le(data);
        int size = payloadSize(data);
        JSONArray part = new JSONArray();
        for (int offset = 4; offset < 4 + size; offset += width) {
            String pin;
            int timeOffset, verification, status;
            if (width == 8) {
                int uid = u16(bytes, offset);
                pin = pins.getOrDefault(uid, String.valueOf(uid));
                timeOffset = offset + 3;
                verification = Byte.toUnsignedInt(bytes.get(offset + 2));
                status = Byte.toUnsignedInt(bytes.get(offset + 7));
            } else if (width == 16) {
                pin = Integer.toUnsignedString(bytes.getInt(offset));
                timeOffset = offset + 4;
                verification = Byte.toUnsignedInt(bytes.get(offset + 8));
                status = Byte.toUnsignedInt(bytes.get(offset + 9));
            } else {
                pin = text(data, offset + 2, 24);
                if (pin.isEmpty()) pin = String.valueOf(u16(bytes, offset));
                timeOffset = offset + 27;
                verification = Byte.toUnsignedInt(bytes.get(offset + 26));
                status = Byte.toUnsignedInt(bytes.get(offset + 31));
            }
            part.put(new JSONObject().put("user_pin", pin).put("verify_time", timestamp(bytes.getInt(timeOffset), zone))
                .put("verify_type", verification).put("status", status));
            if (part.length() == 500) {
                destination.accept(part);
                part = new JSONArray();
            }
        }
        if (part.length() > 0) destination.accept(part);
    }

    static String timestamp(int packed, ZoneId zone) throws DeviceException {
        long value = Integer.toUnsignedLong(packed);
        int second = (int) (value % 60); value /= 60;
        int minute = (int) (value % 60); value /= 60;
        int hour = (int) (value % 24); value /= 24;
        int day = (int) (value % 31) + 1; value /= 31;
        int month = (int) (value % 12) + 1;
        int year = (int) (value / 12) + 2000;
        try {
            return LocalDateTime.of(year, month, day, hour, minute, second)
                .atZone(zone).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME);
        } catch (java.time.DateTimeException error) {
            throw new DeviceException("يحتوي الجهاز على تاريخ بصمة غير صالح.");
        }
    }

    private Map<Integer, String> readPins(int count) throws IOException {
        Map<Integer, String> pins = new HashMap<>();
        if (count <= 0) return pins;
        byte[] users = bufferedRead(9, 5);
        int size = payloadSize(users);
        if (size % count != 0) throw unsupported();
        int width = size / count;
        if (width != 28 && width != 72 && width != 120) throw unsupported();
        ByteBuffer bytes = le(users);
        for (int pos = 4; pos < size + 4; pos += width) {
            String pin = width == 28 ? Integer.toUnsignedString(bytes.getInt(pos + 24)) : text(users, pos + width - 24, 24);
            if (!pin.isEmpty()) pins.put(u16(bytes, pos), pin);
        }
        return pins;
    }

    private byte[] bufferedRead(int table, int kind) throws IOException {
        Packet start = send(1503, le(11).put((byte) 1).putShort((short) table).putInt(kind).putInt(0).array());
        if (start.command == DATA || start.command == PREPARE) return receiveChunk(start);
        if (start.command != ACK || start.data.length < 5) {
            if (table == 13) return receiveChunk(send(13, new byte[0]));
            throw unsupported();
        }
        int size = bounded(le(start.data).getInt(1), 0);
        ByteArrayOutputStream result = new ByteArrayOutputStream(size);
        try {
            for (int offset = 0; offset < size; ) {
                int length = Math.min(size - offset, tcp == null ? 16384 : 65472);
                byte[] slice = receiveChunk(send(1504, le(8).putInt(offset).putInt(length).array()));
                if (slice.length != length) throw unsupported();
                result.write(slice, 0, length);
                offset += length;
            }
        } finally {
            try { send(1502, new byte[0]); } catch (IOException ignored) { /* Transfer buffer only. */ }
        }
        return result.toByteArray();
    }

    private byte[] receiveChunk(Packet first) throws IOException {
        if (first.command == DATA) return first.data;
        if (first.command != PREPARE || first.data.length < 4) throw unsupported();
        int size = bounded(le(first.data).getInt(0), 0);
        ByteArrayOutputStream result = new ByteArrayOutputStream(size);
        while (result.size() < size) {
            Packet next = receive(DATA);
            if (next.command != DATA || next.data.length == 0 || next.data.length > size - result.size()) throw unsupported();
            result.write(next.data, 0, next.data.length);
        }
        if (receive(ACK).command != ACK) throw unsupported();
        return result.toByteArray();
    }

    private Packet send(int command, byte[] data) throws IOException {
        // No attendance, user or device settings write commands are supported.
        switch (command) {
            case 9: case 11: case 13: case 50: case 1000: case 1001:
            case 1102: case 1502: case 1503: case 1504: break;
            default: throw unsupported();
        }
        ByteBuffer frame = le(data.length + 8);
        frame.putShort((short) command).putShort((short) 0).putShort((short) session).putShort((short) reply).put(data);
        frame.putShort(2, checksum(frame.array()));
        frame.putShort(6, (short) ((reply + 1) % 65535));
        if (tcp != null) {
            byte[] packet = le(8 + frame.capacity()).putShort((short) TCP_MAGIC_1).putShort((short) TCP_MAGIC_2).putInt(frame.capacity()).put(frame.array()).array();
            tcp.getOutputStream().write(packet);
        } else {
            udp.send(new DatagramPacket(frame.array(), frame.capacity()));
        }
        Packet result = receive(0);
        reply = result.reply;
        return result;
    }

    private Packet receive(int bufferedCommand) throws IOException {
        byte[] frame;
        if (tcp != null) {
            byte[] header = new byte[8]; input.readFully(header);
            ByteBuffer contents = le(header);
            if (u16(contents, 0) != TCP_MAGIC_1 || u16(contents, 2) != TCP_MAGIC_2) throw unsupported();
            frame = new byte[bounded(contents.getInt(4), 8)]; input.readFully(frame);
        } else {
            DatagramPacket packet = new DatagramPacket(new byte[65507], 65507);
            udp.receive(packet);
            frame = Arrays.copyOf(packet.getData(), packet.getLength());
        }
        if (frame.length < 8) throw unsupported();
        ByteBuffer contents = le(frame);
        int command = u16(contents, 0), packetSession = u16(contents, 4);
        // Buffered data and its final acknowledgement may repurpose the session
        // field. The connected peer's PREPARE response must still match the session.
        if (session != 0 && session != packetSession && (bufferedCommand == 0 || command != bufferedCommand)) {
            throw unsupported();
        }
        return new Packet(command, packetSession, u16(contents, 6), Arrays.copyOfRange(frame, 8, frame.length));
    }

    static short checksum(byte[] message) {
        int sum = 0;
        for (int pos = 0; pos < message.length; pos += 2) {
            sum += Byte.toUnsignedInt(message[pos]);
            if (pos + 1 < message.length) sum += Byte.toUnsignedInt(message[pos + 1]) << 8;
            if (sum > 65535) sum -= 65535;
        }
        // ZKTeco folds the complemented sum modulo 65535, matching the desktop agent.
        return (short) Math.floorMod(~sum, 65535);
    }

    private static byte[] commKey(int password, int session) {
        byte[] key = le(4).putInt(Integer.reverse(password) + session).array();
        return new byte[] { (byte)(key[2] ^ 'S' ^ 50), (byte)(key[3] ^ 'O' ^ 50), 50, (byte)(key[1] ^ 'K' ^ 50) };
    }

    private static int payloadSize(byte[] data) throws DeviceException {
        if (data.length == 0) return 0;
        if (data.length < 4 || le(data).getInt(0) != data.length - 4) throw unsupported();
        return data.length - 4;
    }
    private static int bounded(int size, int minimum) throws DeviceException {
        if (size < minimum || size > MAX_BYTES) throw unsupported();
        return size;
    }
    private static ByteBuffer le(int size) { return le(new byte[size]); }
    private static ByteBuffer le(byte[] data) { return ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN); }
    private static int u16(ByteBuffer bytes, int offset) { return Short.toUnsignedInt(bytes.getShort(offset)); }
    private static String text(byte[] data, int start, int max) {
        int length = 0;
        while (length < max && data[start + length] != 0) length++;
        return new String(data, start, length, StandardCharsets.UTF_8).trim();
    }
    private static DeviceException unsupported() { return new DeviceException("صيغة رد جهاز ZKTeco غير مدعومة أو غير مكتملة."); }

    @Override public void close() throws IOException {
        if (session != 0) {
            try { send(1001, new byte[0]); } catch (IOException ignored) { /* Socket still closes. */ }
        }
        if (tcp != null) tcp.close(); else udp.close();
    }

    static final class DeviceException extends IOException { DeviceException(String message) { super(message); } }
    static final class DeviceIdentityException extends IOException { DeviceIdentityException(String message) { super(message); } }
    private static final class Packet {
        final int command, session, reply;
        final byte[] data;
        Packet(int command, int session, int reply, byte[] data) { this.command = command; this.session = session; this.reply = reply; this.data = data; }
    }
}
