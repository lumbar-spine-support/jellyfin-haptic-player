[← Back to Table of Content](index.md)

# Intiface Central Integration

For haptic support install [Intiface Central](https://intiface.com/#intiface-central). It connects to your toys directly and provides a generic API for haptic control, so HAPPY works with arbitrary haptic toys.

For a more detailed tutorial, see the [Intiface Central Quickstart Guide](https://intiface.com/docs/intiface-central/quickstart).

## Connecting

1. In Intiface Central, start the server with the big "play" button.
2. Press "start scan" with your devices in pairing mode.
3. In HAPPY, open the settings panel, enter the Intiface address (default `ws://localhost:12345`) and press **Connect**.

`localhost` only works when your browser and Intiface run on the same device. Otherwise, enter the address of the device running Intiface. If you open HAPPY over `https://` and Intiface is on another device, Intiface must be behind a TLS proxy: pick `wss://` in the dropdown.

HAPPY reconnects on page load if Intiface was connected last time and you did not press **Disconnect**. To turn this off, use *Reconnect to Intiface on page load* (see [Configuration](configuration.md#haptics)).

If the connection drops, HAPPY keeps retrying in the background.

On phones, turning off the screen freezes the browser tab and Intiface drops the connection. HAPPY therefore keeps the screen on while media plays (**Keep Screen On During Playback** under *Appearance* in the settings, on by default). This needs HTTPS or `localhost`.

## Device Assignment

Each device exposes features like "linear", "vibrate" or "rotate". Strokers are usually "linear" features but may also have "vibrate" features. A Nexus Revo Stealth exposes both a "rotate" and a "vibrate" feature through Intiface. You can assign each feature to the same or a different funscript!

Each stroker has its own position limits on its device card, so a long and a short stroker can use different ranges. New devices start at 0–100 %.

See [Funscripts](library.md#funscripts) for how to store funscripts so that HAPPY finds them. Features can also be assigned to [Auto funscripts](library.md#auto-funscript), if they are turned on.

The status badge above each funscript shows whether a device will play it; click it for details.

## Unsupported Features

Some toys report features that should not follow a funscript. HAPPY lists them on the device card but they cannot be assigned:

- **Temperature** (heating/cooling elements)
- **LED** (lights)
- **Spray** (liquid dispensers)
