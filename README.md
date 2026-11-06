# Score Player

A local, browser-based sheet music / tab player (Soundslice-style), built on [alphaTab](https://alphatab.net).

```sh
npm install
npm start        # → http://localhost:3333
```

**Supported files:** Guitar Pro (`.gp`, `.gp3`–`.gp7`, `.gpx`), MusicXML (`.musicxml`, `.xml`, `.mxl`), Capella (`.cap`), alphaTex (`.atex`, `.tex`).

**Features:** notation + tab rendering, synthesized playback with a moving cursor and auto-scroll, click-to-seek, drag-select a passage to play/loop it, speed 25–200%, metronome, count-in, per-track show/mute/solo, page/horizontal layout, zoom.

**Piano fingering:** click **🖐 Fingering** (or press `F`) to show suggested finger numbers (1 = thumb … 5 = little finger) above the notes — blue for the right hand (treble staff), green for the left (bass staff). Fingering stored in the file (e.g. MusicXML) is used as-is; everything else is computed by `public/fingering.js`, a dynamic-programming optimizer based on Parncutt's ergonomic fingering model (hand spans, thumb crossings, black keys, hand shifts). The setting is remembered between visits.

**Piano sound:** piano parts play through a sampled concert grand — the [YDP Grand Piano](https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html) SoundFont (Yamaha Disklavier Pro, FreePats project, [CC-BY 3.0](https://creativecommons.org/licenses/by/3.0/)), stored in `soundfonts/` (118 MB). It loads in the background on top of alphaTab's small General MIDI SoundFont, which still provides the other instruments and the metronome. Switch between *Concert grand* and *Basic (GM)* in the sidebar's **Sound** section. If the file is missing, run `npm run fetch-piano`.

**URL options:** `?score=Minuet%20in%20G%20(Piano)&fingering=1` opens a specific score with fingering on.

Put scores in `scores/` (or drop them onto the page and click **Save to library**).
