#!/bin/sh
# Downloads the YDP Grand Piano SoundFont (Yamaha Disklavier Pro, CC-BY 3.0, FreePats project)
# into soundfonts/. Only needed if soundfonts/YDP-GrandPiano.sf2 is missing.
set -e
cd "$(dirname "$0")/.."
mkdir -p soundfonts
tmp=$(mktemp -d)
curl -fSL -o "$tmp/ydp.tar.bz2" https://freepats.zenvoid.org/Piano/YDP-GrandPiano/YDP-GrandPiano-SF2-20160804.tar.bz2
tar -xjf "$tmp/ydp.tar.bz2" -C "$tmp"
mv "$tmp"/YDP-GrandPiano-SF2-20160804/YDP-GrandPiano-20160804.sf2 soundfonts/YDP-GrandPiano.sf2
mv "$tmp"/YDP-GrandPiano-SF2-20160804/YDP-GrandPiano-20160804.txt soundfonts/YDP-GrandPiano-LICENSE.txt
rm -rf "$tmp"
echo "Installed soundfonts/YDP-GrandPiano.sf2"
