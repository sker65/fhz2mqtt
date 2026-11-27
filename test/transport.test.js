import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {TcpPort, parseTcpAddress} from '../lib/transport.js';

test('parseTcpAddress tells tcp:// from serial paths', () => {
    assert.equal(parseTcpAddress('/dev/ttyUSB0'), null);
    assert.equal(parseTcpAddress('/dev/serial/by-id/usb-ELV_AG_ELV_FHZ_1300_PC_X-if00-port0'), null);
    assert.deepEqual(parseTcpAddress('tcp://192.0.2.10:10001'), {host: '192.0.2.10', port: 10001});
    assert.deepEqual(parseTcpAddress('TCP://xport.local:10001/'), {host: 'xport.local', port: 10001});
    assert.deepEqual(parseTcpAddress('tcp://[2001:db8::1]:2001'), {host: '2001:db8::1', port: 2001});
    assert.throws(() => parseTcpAddress('tcp://192.0.2.10'), /tcp:\/\/host:port/);
    assert.throws(() => parseTcpAddress('tcp://192.0.2.10:0'), /tcp:\/\/host:port/);
    assert.throws(() => parseTcpAddress('tcp://192.0.2.10:10001/x'), /tcp:\/\/host:port/);
    assert.throws(() => parseTcpAddress('tcp://:10001'), /tcp:\/\/host:port/);
});

async function server() {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1');
    await once(srv, 'listening');
    return {srv, port: srv.address().port};
}

test('TcpPort passes bytes both ways and reports the remote close', async () => {
    const {srv, port} = await server();
    const accepted = once(srv, 'connection');
    const tcp = new TcpPort({host: '127.0.0.1', port});
    await new Promise((resolve, reject) => tcp.open((err) => (err ? reject(err) : resolve())));
    assert.equal(tcp.isOpen, true);
    const [peer] = await accepted;

    const received = once(peer, 'data');
    tcp.write(Buffer.from([0x81, 0x01]));
    assert.deepEqual([...(await received)[0]], [0x81, 0x01]);

    const data = once(tcp, 'data');
    peer.write(Buffer.from([0x81, 0x02]));
    assert.deepEqual([...(await data)[0]], [0x81, 0x02]);

    const closed = once(tcp, 'close');
    peer.destroy();
    await closed;
    assert.equal(tcp.isOpen, false);
    srv.close();
});

test('TcpPort open fails without a close event when nobody listens', async () => {
    const {srv, port} = await server();
    await new Promise((resolve) => srv.close(resolve));
    const tcp = new TcpPort({host: '127.0.0.1', port});
    let closeEvents = 0;
    tcp.on('close', () => closeEvents++);
    const err = await new Promise((resolve) => tcp.open(resolve));
    assert.ok(err instanceof Error);
    assert.equal(tcp.isOpen, false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeEvents, 0);
    assert.equal(tcp.write(Buffer.from([1])), false);
});

test('TcpPort close ends the connection', async () => {
    const {srv, port} = await server();
    const accepted = once(srv, 'connection');
    const tcp = new TcpPort({host: '127.0.0.1', port});
    await new Promise((resolve, reject) => tcp.open((err) => (err ? reject(err) : resolve())));
    const [peer] = await accepted;
    const peerEnded = once(peer, 'end');
    await new Promise((resolve) => tcp.close(resolve));
    await peerEnded;
    assert.equal(tcp.isOpen, false);
    peer.destroy();
    srv.close();
});
