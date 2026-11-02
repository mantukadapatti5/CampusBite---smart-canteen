#!/usr/bin/env sh
# One-click start for Linux / macOS (Docker must be running).
cd "$(dirname "$0")" && docker compose up --build
