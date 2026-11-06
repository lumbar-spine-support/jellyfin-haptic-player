[← Back to Table of Content](index.md)

# Installation

HAPPY runs inside your [Jellyfin](https://jellyfin.org/) server as a plugin. Jellyfin provides your media, metadata, users and streaming; the plugin adds HAPPY itself and your funscripts.

You need:

1. A Jellyfin server with your audio in a **Books** library and your videos in a **Music Videos** library (see [Media Library](library.md)).
2. The HAPPY plugin installed in that Jellyfin server (below).
3. Optionally, for the DG-Lab Coyote only: the [DG-Lab relay](dg-lab.md#the-relay).

## Install the plugin

Add HAPPY's plugin repository to Jellyfin once. After that, Jellyfin installs the plugin from its catalog and keeps it up to date like any official plugin.

1. In Jellyfin, open *Dashboard → Plugins → Repositories* and add a repository:
   - Name: `HAPPY`
   - URL: `https://raw.githubusercontent.com/lumbar-spine-support/jellyfin-haptic-player/refs/heads/jellyfin-plugin-repository/manifest.json`
2. Open the plugin *Catalog*, select **HAPPY** (category *General*) and install it.
3. Restart Jellyfin. *Dashboard → Plugins* now lists **HAPPY**.

Jellyfin installs new versions automatically; restart it to load an update. You can turn automatic updates off on the plugin's page.

The plugin is built for one Jellyfin version. After a Jellyfin upgrade, Jellyfin installs the matching plugin version once it is released.

## Open HAPPY

Open `<your Jellyfin address>/Happy/Web/` in your browser, for example `http://192.168.1.10:8096/Happy/Web/`. If Jellyfin runs under a base URL such as `/jellyfin`, keep it: `https://example.com/jellyfin/Happy/Web/`.

You can also open HAPPY with **HAPPY** in the menu of Jellyfin's web client, or with *Open HAPPY* on the plugin's settings page (*Dashboard → Plugins → HAPPY*). Jellyfin's apps for TVs and phones don't show the menu entry; open HAPPY in a browser there.

Sign in once per browser with a Jellyfin user. It does not have to be the user signed in to Jellyfin's web client, see [Authentication](authentication.md).

A Jellyfin administrator sets the server-wide defaults on the plugin's settings page, see [Configuration](configuration.md).

## Beta channel

To try changes before they are released, use the beta repository instead:

- URL: `https://raw.githubusercontent.com/lumbar-spine-support/jellyfin-haptic-player/refs/heads/jellyfin-plugin-repository/manifest-beta.json`

It is the same plugin with the same settings. Beta builds have a fourth version number, for example `1.1.0.3`, and HAPPY shows **beta** next to its version in the settings panel. They are tested automatically but not by hand, so expect the occasional bug, and please report it.

- **Switching to beta:** replace the HAPPY repository URL with the beta URL (or add it next to the stable one). Run the *Update Plugins* scheduled task, or wait a day, then restart Jellyfin.
- **Updates:** a new beta usually appears a few minutes after each change. The next stable release replaces all betas before it.
- **Back to stable:** switch the repository URL back. Jellyfin never downgrades a plugin, so you stay on the beta until the next stable release replaces it. To go back right away, uninstall HAPPY, restart Jellyfin and install it again from the stable repository; the plugin settings are kept.

## Install by hand

1. Download `happy_<version>.zip` from a [HAPPY release](https://github.com/lumbar-spine-support/jellyfin-haptic-player/releases) and unzip it into a new folder `HAPPY_<version>`.
2. Copy that folder into the `plugins` directory of Jellyfin's data directory. For the official Docker image, that is `/config/plugins/` inside Jellyfin's config volume.
3. Restart Jellyfin and [open HAPPY](#open-happy).

After a Jellyfin upgrade, install the matching plugin version yourself.
