#!/usr/bin/env node
// A stand-in for an Intiface server with virtual toys, speaking just enough of the Buttplug v4 spec for
// the client's device list (the real thing needs the Intiface engine and its device configuration).
// scripts/screenshot-app.js uses it for the settings panel; run it on its own to try the device UI
// without toys:
//
//   node scripts/mock-intiface.mjs [port]     default 12345, the address HAPPY suggests

import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';

const MESSAGE_SPEC_VERSION = { ProtocolVersionMajor: 4, ProtocolVersionMinor: 0 };

const NO_INPUT = {};

/** Virtual toys, keyed like the server's `DeviceList.Devices`: Vibrate + Rotate, and a timed stroker. */
export const MOCK_DEVICES = {
    0: {
        DeviceIndex: 0,
        DeviceName: 'Nexus Revo Stealth',
        DeviceDisplayName: 'Nexus Revo Stealth',
        DeviceMessageTimingGap: 50,
        DeviceFeatures: {
            0: { FeatureIndex: 0, FeatureDescriptor: 'Vibrator', Output: { Vibrate: { Value: [0, 20] } }, Input: NO_INPUT },
            1: { FeatureIndex: 1, FeatureDescriptor: 'Rotator', Output: { Rotate: { Value: [-2, 2] } }, Input: NO_INPUT },
        },
    },
    1: {
        DeviceIndex: 1,
        DeviceName: 'The Handy',
        DeviceMessageTimingGap: 50,
        DeviceFeatures: {
            0: {
                FeatureIndex: 0,
                FeatureDescriptor: 'Stroker',
                Output: { HwPositionWithDuration: { Value: [0, 100], Duration: [0, 10000] } },
                Input: NO_INPUT,
            },
        },
    },
};

/** The reply to one client message; everything that is not a query only needs an acknowledgement. */
function reply(message) {
    const [[type, { Id }]] = Object.entries(message);
    switch (type) {
        case 'RequestServerInfo':
            return { ServerInfo: { Id, ServerName: 'HAPPY mock Intiface', MaxPingTime: 0, ...MESSAGE_SPEC_VERSION } };
        case 'RequestDeviceList':
            return { DeviceList: { Id, Devices: MOCK_DEVICES } };
        default:
            return { Ok: { Id } };
    }
}

/** Starts the mock on `port` (0 picks a free one) and resolves once it is listening. */
export function startMockIntiface(port = 12345) {
    return new Promise((resolve, reject) => {
        const server = new WebSocketServer({ host: '127.0.0.1', port });
        server.once('error', reject);
        server.once('listening', () => resolve(server));
        server.on('connection', (socket) => {
            socket.on('message', (data) => {
                socket.send(JSON.stringify(JSON.parse(data.toString()).map(reply)));
            });
        });
    });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const server = await startMockIntiface(Number(process.argv[2] ?? 12345));
    console.log(`Mock Intiface listening on ws://127.0.0.1:${server.address().port}`);
}
