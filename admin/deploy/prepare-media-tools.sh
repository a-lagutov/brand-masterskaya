#!/usr/bin/env bash
# Fetch pinned, static Linux tools into a private deployment staging directory.
set -euo pipefail
media_directory="$1"
mkdir -p "$media_directory"
curl --fail --location --silent --show-error --retry 3 --max-time 180 \
  https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  -o "$media_directory/ffmpeg.tar.xz"
printf '%s  %s\n' abda8d77ce8309141f83ab8edf0596834087c52467f6badf376a6a2a4c87cf67 "$media_directory/ffmpeg.tar.xz" | sha256sum --check
tar -xJf "$media_directory/ffmpeg.tar.xz" -C "$media_directory" --strip-components=1 ffmpeg-7.0.2-amd64-static/ffmpeg
rm "$media_directory/ffmpeg.tar.xz"
curl --fail --location --silent --show-error --retry 3 --max-time 180 \
  https://github.com/shaka-project/shaka-packager/releases/download/v3.9.3/packager-linux-x64 \
  -o "$media_directory/packager"
printf '%s  %s\n' 7a3cf35ad146fd7810b4ededab363c8a3e6121d1b2c8391f53863126186f9ee6 "$media_directory/packager" | sha256sum --check
chmod 700 "$media_directory/ffmpeg" "$media_directory/packager"
