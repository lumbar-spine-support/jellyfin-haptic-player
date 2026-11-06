[← Back to Table of Content](index.md)

# DG-Lab Coyote 3.0

>⚠️ Please read through the manufacturer's instructions first!

The Coyote is not supported by Intiface. Instead, HAPPY talks to the Dungeon Lab app with its [WebSocket v4.0 protocol](https://github.com/dungeonlab-open/dglab-websocket-server).

The app keeps full ownership of the safety limits: HAPPY can only ever request a strength at or below the ceiling the app reports. Still, increase limits slowly, and inform yourself about how current flows between electrodes and how to avoid hurting yourself.

Due to a lack of long-term testing, the feature is off by default. To try it:

1. Run the [relay](#the-relay).
2. Turn on *Enable DG-Lab Coyote 3.0* on the HAPPY plugin's settings page in Jellyfin (*Dashboard → Plugins → HAPPY*).
3. [Set up the DG-Lab app](#dg-lab-app-setup).
4. [Pair the app with HAPPY](#pairing).

## The relay

HAPPY and the DG-Lab app never talk to each other directly. Both connect to a small relay that passes messages between them. It ships as its own Docker image, so only Coyote owners need to run it:

```yaml
services:
  happy-dglab-relay:
    image: ghcr.io/lumbar-spine-support/happy-dglab-relay:latest
    ports:
      - "8070:8070"
    environment:
      # Address the relay uses to check sign-ins with Jellyfin, e.g. on a shared Docker network.
      JELLYFIN_URL: "http://jellyfin:8096"
    restart: unless-stopped
```

The relay only accepts HAPPY tabs that are signed in to Jellyfin. Further settings are `PORT` (default `8070`) and `LOG_LEVEL` (`error`, `warn`, `info`, `debug`).

Then enter the relay's address under *Relay address* on the plugin's settings page. Both browsers and phones must be able to reach it, so don't use `localhost`.

- **Jellyfin over HTTP:** `ws://<host>:8070`, for example `ws://192.168.1.10:8070`.
- **Jellyfin over HTTPS:** `wss://…`, because browsers block plain `ws://` from an HTTPS page. Put the relay behind your reverse proxy, on its own host name (`wss://relay.example.com`) or under a path (`wss://example.com/dglab`). Any path ending in `/ws/dglab` works, so the proxy does not need to rewrite it.
- **Empty:** `/ws/dglab` on Jellyfin's own address. Use this if your reverse proxy forwards that path to the relay.

## DG-Lab App Setup

1. Download the most recent version of the app from [DG-Lab Downloads](https://www.dungeon-lab.com/app-download).
2. Follow the app's instructions to pair your Coyote. You do not pair the Coyote with HAPPY over Bluetooth: HAPPY and the app both connect to the relay.
3. Adjust the Coyote settings in the app. HAPPY cannot change them. The most important ones:
    - **Channel Mute**: the button with the sinusoidal icon turns the output of channels A and B on or off. Mute a channel to test whether funscript values arrive in the app; you still see the values HAPPY sends.
    - **Intensity Limit**: click the cog on the right side. For the Coyote 3.0 this is a value between 0 and 200; what is appropriate depends on the body region. HAPPY holds the channel at this limit (times the device strength slider) and plays the funscript through the pulse width: a position of 100 means full pulse width, 0 means no pulses.
    - **Soft Start**: a protection by Dungeon Lab that limits sudden spikes in the output. It will likely interfere with funscripts that have sudden spikes rather than continuous oscillations. If so, disable *Protection Mode* and adjust the maximum gradient yourself, for example by turning *decay* off and lowering the soft start rise-rate.

Apply the settings to both channels A and B if you use both outputs of the Coyote.

## Pairing

1. Open the settings sidebar in HAPPY and press **Enable** in the DG-Lab section.
2. On the phone running the DG-Lab app, tap **Open DG-Lab**. If HAPPY is open on a desktop browser, scan the QR code from the DG-Lab app, or copy the URL and enter it in the app.
3. Return to HAPPY. A green badge shows that pairing worked, and the Coyote's two channels appear in Device Assignment. Assign them to any funscript, like a toy connected through Intiface.
4. Have fun and **stay safe**!

The status badge above each funscript turns yellow or red when the Coyote is unplugged, muted or limited in the app; click it for details.

There is a single pairing per relay. Opening HAPPY in another browser or on another device takes over the paired app without pairing again, and the previous tab is disconnected. After a relay restart, you have to pair again.

A page reload reconnects to the relay automatically if DG-Lab was connected and the relay was last heard from less than 5 minutes ago. After that, pair again by hand. To turn this off, use *Reconnect to the relay on page load* on the plugin's settings page.

## Sandbox

The **Sandbox** button below the DG-Lab device cards opens a test page. Pick a channel and a pattern and press **Start**. The chart shows the pattern and the pulses it produces with the current strength and Pulse Frequency from the device card. Use it to find comfortable settings or check the setup without funscript media.

Starting pauses any playing media. **Stop** or leaving the page silences the Coyote. To hide the page, turn off *Show the waveform sandbox* on the plugin's settings page.

## Troubleshooting

### Relay logs

If the status badge flickers to *Error* or the DG-Lab app reports an unstable network, the relay's logs (`docker logs happy-dglab-relay`) tell you where the trouble is:

| Log line | Meaning |
| --- | --- |
| `Controller closed: code 1000 …, reason "ping_timeout"` | The HAPPY tab heard no answer from the relay for 6 s and reconnected. Look at the network between the browser and the relay (Wi-Fi, reverse proxy). |
| `… code 1006 (abnormal …)` | The connection dropped without a goodbye: a network or reverse proxy cut it, or the browser was suspended. |
| `… was silent for 7.3 s although it pings every 2 s` | Nothing reached the relay from that peer for that long; its link to the relay stalled. |
| `… answered a native ping after …` / `… has not answered native pings for …` | Slow or missing round trips between the relay and that peer. |
| `… is not keeping up: … KiB queued towards it` | The relay cannot send to that peer fast enough (slow link or buffering proxy). |
| `The relay stalled for up to … ms` | The relay itself froze (CPU limit, paused or swapping container), which delays both peers. |
| `Controller gone, keeping the app paired …` / `Controller … back after …` | The HAPPY tab disconnected and came back; the DG-Lab app stays paired meanwhile. |

`LOG_LEVEL=debug` adds the round trip time of every native ping (every 10 s per peer).

### Browser console

Warnings, rejected commands and every lost relay connection are always logged in the browser console. To trace all traffic, turn on *Debug output in the browser console* on the plugin's settings page for everyone, or set `localStorage['happy-log'] = 'dglab=debug'` in the console and reload.

`happy-log` is a comma-separated list of `namespace=level` pairs (`debug`, `info`, `warn`, `error`, `silent`). A namespace also covers its `:`-children, and `*` sets the default, e.g. `dglab=debug,dglab:socket=warn,*=info`.
