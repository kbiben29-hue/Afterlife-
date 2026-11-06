#!/bin/zsh
# Double-click to play Afterlife on this Mac.
# Starts the game and opens it in your browser. Close this window (or press Ctrl+C) to stop it.

cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
	echo "Node.js isn't installed. Get the LTS version from https://nodejs.org, then double-click this file again."
	read -k1 "?Press any key to close…"
	exit 1
fi

if [ ! -d node_modules ]; then
	echo "First run: installing (about a minute)…"
	npm install || { read -k1 "?Install failed. Press any key to close…"; exit 1; }
fi

if [ ! -f public/cards/cards.json ]; then
	echo "Downloading the card database (first run only)…"
	npm run fetch-cards || echo "Card download failed — the game will use placeholder cards for now."
fi

echo ""
echo "Starting Afterlife… your browser will open in a moment."
echo "Leave this window open while you play. Close it to stop the game."
echo ""
npm run dev -- --open
