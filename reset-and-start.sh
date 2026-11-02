#!/usr/bin/env sh
# Wipes the database volume and rebuilds from scratch (deletes all data!).
cd "$(dirname "$0")" && docker compose down -v && docker compose up --build
