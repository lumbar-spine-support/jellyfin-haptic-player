[← Back to Table of Content](index.md)

# Media Library

HAPPY plays the media of your [Jellyfin](https://jellyfin.org/) libraries and adds the funscripts that sit next to your files.

## Set up your libraries

Create one Jellyfin library for each kind of media, with exactly these library types:

| Media | Jellyfin library type |
| --- | --- |
| Audio | **Books** |
| Video | **Music Videos** |

Other library types lose information: audio descriptions go missing, and videos lose their artist. A library's type cannot be changed later, so if you already have a library of another type, create a new one.

Movies and TV shows can be shared with HAPPY too: select your existing **Movies** and **Shows** libraries on the plugin's settings page. See [Movies and TV series](#movies-and-tv-series).

Give each library its own folder, and put the funscripts next to your media:

```
audio/                       --> "Books" library
├── audio.mp3
├── audio.stroker.funscript  --> funscript for stroker toy
└── audio.buttplug.funscript --> funscript for buttplug toy
video/                       --> "Music Videos" library
├── video.mp4
└── video.stroker.funscript
```

HAPPY shows the audio and video of every library the signed-in user can see. To show only some of them, choose them on the plugin's settings page (see [Configuration](configuration.md#libraries)). Turn off the metadata downloaders of a library if Jellyfin should not rename your files.

Playlists are Jellyfin playlists: create them in Jellyfin or save a [queue](#queue) from HAPPY, and [edit your own](#edit-a-playlist). `.m3u` files in your media folders are not read.

## Tags and descriptions

Titles, artists, years, cover art and chapters come from your files, as read by Jellyfin. In HAPPY, **tags** are Jellyfin's tags and genres together, and a **description** is Jellyfin's overview of an item. Descriptions can use Markdown, for [links](https://github.com), **bold text** and more.

Set them in the files as described below, or by hand in Jellyfin's metadata editor. After changing a file, refresh its metadata in Jellyfin.

### Audio: file tags

Edit your audio files with a tag editor such as [Kid3](https://kid3.sourceforge.io/), [Mp3tag](https://www.mp3tag.de/) (Windows) or [Puddletag](https://docs.puddletag.net/) (Linux). For MP3 files, use the ID3v2 tags (*Tag 2* in Kid3).

| Field | What to put in it |
| --- | --- |
| Title | Title of the track |
| Artist | Author or narrator |
| Album, Album Artist | Tracks with the same album and album artist become an album in HAPPY |
| Track Number | Order of the tracks in an album |
| Date | Year only, e.g. `2026` |
| Genre | Your tags, as separate values |
| Comment | The description |
| Picture | Cover image (PNG or JPEG) |

Each tag must be a separate value of the genre field. In Kid3, separate the values with `|`; in Mp3tag, with `\\`. A single text like `sfw; funny` stays one tag, unless you enable custom tag delimiters in the library settings.

### Videos: NFO files

Put an NFO file named like the video (`<video name>.nfo`) next to it:

```xml
<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<musicvideo>
  <title>My video</title>
  <artist>My artist</artist>
  <plot><![CDATA[**Markdown** description]]></plot>
  <tag>sfw</tag>
  <tag>funny</tag>
</musicvideo>
```

## Filtering and sorting

The controls next to the search box limit the library by media type, by toy type (only items with scripts for all selected toys) and to your favorites, and sort it. **Shuffle** in the sort menu shows the library in a random order. Items without a value, such as playlists without a year, are always listed last. HAPPY remembers your choices in the browser.

**Album Display** under *Appearance* in the settings decides how albums appear in the library: **Albums + Tracks**, **Albums only** or **Tracks only**. An album with a single track always shows as just the track.

## Movies and TV series

Items of Jellyfin's **Movies** and **Shows** libraries get their own media filters, **Movies** and **TV series**. They appear in the filter only when your library has items of that kind, and those items no longer count as **Videos**.

- The artist of a movie or episode is its director, as listed under *People* in Jellyfin. When no director is listed, the producers are shown instead.
- The episodes of one season are grouped like an album, titled `Series – Season 1` and shown with the series poster. Opening the season lists its episodes in order, and playing it plays them one after another.
- **TV Season Display** in the settings works like *Album Display*: **Seasons + Episodes**, **Seasons only** or **Episodes only**. A season with a single episode shows as just the episode.
- Episodes are listed as `S03E09 Episode name – Series`. Turn off **Append Series Name to Episodes** in the settings to leave out the series name.

## Favorites

HAPPY uses the favorites of your Jellyfin account, so they are the same ones Jellyfin's own apps show. Click a heart to add or remove a favorite. Audio files, videos and playlists can be favorites. Albums have no heart of their own; with the favorites filter on, an album shows when one of its tracks is a favorite.

Favorites you change in another app show up in HAPPY after a page reload.

## Queue

The queue is what plays next. Playing an album or playlist fills it; playing a single file keeps the rest of the queue, which continues after that file. To add something, use the **⋯** menu of a file.

The queue button in the player's control bar opens the list, where you can reorder and remove entries, switch repeat, shuffle or clear what is up next.

The queue lives in the open browser tab and is gone after a reload. To keep it, save it as a Jellyfin playlist that only you can see. To change an existing playlist from the queue, press *Save*; HAPPY refuses this if the playlist was changed elsewhere in the meantime or holds media from libraries HAPPY does not show. In those cases, use *Save as…*.

## Edit a playlist

Press the pen button on the page of one of your own playlists to reorder, remove or rename its entries. Nothing reaches Jellyfin until you save. To add files, add them to the queue and save the queue. The limits on saving a queue apply here too, but renaming always works. The **⋯** menu of the playlist in the library deletes it; your media stays.

## Cover art

Cover art is the primary image of an item in Jellyfin: embedded art, an image next to the file, or a frame extracted from the video. Audio files without cover art show a black player surface. You can change how covers fit the grid on the plugin's settings page (see [Configuration](configuration.md#library)).

## Video codecs

HAPPY plays the original file whenever your browser can decode it, which keeps haptics exactly in time. Before a video starts, HAPPY asks Jellyfin whether that is the case. If not, Jellyfin converts only what the browser cannot play and HAPPY plays that stream instead. A typical case is a Blu-ray rip in MKV with TrueHD, DTS or AC-3 audio: browsers show its picture but stay silent, so Jellyfin converts the audio and copies the video. Converting needs some CPU on the Jellyfin server, and Chromecast cannot take over such a stream.

To see how a video is played, choose **Playback info** in the player's settings menu (the gear). A small overlay then shows whether the video plays directly or is converted and why, the codecs of the file and of the converted stream, how fast the server converts, and dropped frames and buffer in the browser. Tap × or the menu entry again to hide it.

## Funscripts

A funscript is named like its media file, plus a suffix for the toy type. It needs at least an `actions` list of `at/pos` pairs:

```json
// <audio_or_video_name>.<toy-suffix>.funscript
{
  "actions": [
    {"at": 0,   "pos": 0},
    {"at": 100, "pos": 100},
    ...
  ]
}
```

For two scripts of the same type, add a second suffix of your choice:

```
file.mp4
file.vibrator.cock.funscript
file.vibrator.balls.funscript
```

Funscripts without a known toy suffix (`file.funscript`) show up as *Generic* and can be assigned to any device.

If your funscripts use another naming pattern, such as `file-prostate.funscript`, change the separator and suffixes on the plugin's settings page (see [Configuration](configuration.md#funscript-file-names)).

### Timelines

The file page draws a timeline per funscript. Use the buttons next to it to zoom in around the playhead, hide the timelines, or unlock seeking by clicking a timeline.

### Auto funscript

When *Generate an Auto funscript from the audio* is on (see [Configuration](configuration.md#auto-funscript)), every file with an audio track also gets an **Auto** script. It follows how loud a frequency band of the audio is, by default the bass. Assign it to a device like any other script.

The script is generated the first time someone opens the file, which takes a few seconds for an hour of audio.

### Where funscripts are found

The HAPPY plugin looks through your Jellyfin libraries and assigns each `.funscript` file to the media file whose name it starts with:

- The longest match wins: `scene.part2.stroker.funscript` belongs to `scene.part2.mp4` if that exists, otherwise to `scene.mp4`.
- A media file in the same folder wins. Otherwise the script goes to every media file with that name in the same library, so you can keep scripts in a subfolder.

New scripts show up after the next library scan, or within about 30 seconds.

## Chapters

Chapters split the progress bar into segments. Dragging near a chapter start snaps to it; hold <kbd>Shift</kbd> to seek freely.

HAPPY reads chapters from two sources. *Chapters* on the plugin's settings page sets which one comes first, or turns chapters off (see [Configuration](configuration.md#playback)).

- **Funscript**: `metadata.chapters` of the funscripts of a file, as written by [OpenFunscripter](https://github.com/OpenFunscripter/OFS) and [MultiFunPlayer](https://github.com/Yoooi0/MultiFunPlayer):
  ```json
  {
    "metadata": {
      "chapters": [
        { "name": "Introduction", "startTime": "00:00:00.000", "endTime": "00:03:00.000" },
        { "name": "Finale", "startTime": "00:03:00.000" }
      ]
    },
    "actions": []
  }
  ```
- **Embedded**: chapters stored in the media file (e.g. MP4, MKV, MP3). To add them without re-encoding, write an [FFMETADATA](https://ffmpeg.org/ffmpeg-formats.html#Metadata-1) file and run the command below, then rescan the file in Jellyfin:
  ```shell
  ffmpeg -i input.mp4 -i chapters.txt -map 0 -map_metadata 0 -map_chapters 1 -codec copy output.mp4
  ```

## Timeline thumbnails

Hovering over the progress bar of a video shows a preview frame. These are Jellyfin's **trickplay** images: enable *trickplay image extraction* in the library settings and let the *Generate Trickplay Images* task run.

## VR180 videos

Videos whose filename marks them as VR180 open as a panorama you can look around in. The tokens are not case-sensitive and must be separated by `_`, `.`, `-` or spaces:

| Filename contains | Layout |
| --- | --- |
| `180` and `LR`, `SBS` or `3DH` (e.g. `Scene_180_LR.mp4`) | side by side |
| `180` and `TB`, `OU` or `3DV` (e.g. `Scene_180_TB.mp4`) | top/bottom |
| `VR180` alone | side by side |

Drag to look around and scroll or pinch to zoom. On phones and tablets, the phone icon lets you look around by moving the device; this needs HTTPS. Very high resolutions (8K) may play poorly on phones.
