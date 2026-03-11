#!/bin/bash

# Setup script to map /Volumes/Expansion/dev/modscope-data to /srv
# This allows devvit processes to write to /srv/data/redis

SOURCE_DIR="/Volumes/Expansion/dev/modscope-data"
TARGET_DIR="/srv"

# Create the source directory if it doesn't exist
mkdir -p "$SOURCE_DIR/data/redis"

# Remove existing /srv if it's a symlink or empty directory
if [ -L "$TARGET_DIR" ]; then
    echo "Removing existing symlink at $TARGET_DIR"
    sudo rm "$TARGET_DIR"
elif [ -d "$TARGET_DIR" ] && [ -z "$(ls -A $TARGET_DIR)" ]; then
    echo "Removing empty directory at $TARGET_DIR"
    sudo rmdir "$TARGET_DIR"
fi

# Create the symlink
echo "Creating symlink: $TARGET_DIR -> $SOURCE_DIR"
sudo ln -s "$SOURCE_DIR" "$TARGET_DIR"

# Verify the setup
if [ -L "$TARGET_DIR" ]; then
    echo "✓ Symlink created successfully"
    echo "✓ /srv/data/redis is now accessible"
    ls -la "$TARGET_DIR"
else
    echo "✗ Failed to create symlink"
    exit 1
fi
