"""
Connect your Kalshi account (run by `./parlay setup`).

Asks for your API key's ID and the private key file Kalshi downloaded, checks the file is a
key, copies it to ~/.parlay/ (only you can read it), saves the ID next to it, and makes one
read-only request (your balance) to prove Kalshi accepts it. Nothing is sent anywhere else.
"""

import json
import os
import shutil
import sys

import kalshi


def ask(prompt):
    try:
        return input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        print()
        sys.exit(1)


def clean_path(text):
    """A path dragged into Terminal: maybe quoted, maybe with backslash-escaped spaces."""
    text = text.strip().strip("'\"")
    return os.path.expanduser(text.replace("\\ ", " "))


def main():
    print("Connect your Kalshi account\n")
    print("Make an API key at kalshi.com/account/profile (scroll to API Keys). Keep the key type")
    print("on Ed25519 and leave the public key box empty. Kalshi shows a Key ID and downloads")
    print("a .txt file with your private key (only once).\n")

    if os.path.exists(kalshi.CONFIG_PATH) and ask("A key is already set up. Replace it? [y/N] ").lower() != "y":
        return

    key_id = ask("1. Paste your Key ID: ")
    if not key_id:
        sys.exit("No Key ID entered.")

    path = clean_path(ask("2. Drag the downloaded key file into this window, then press Return: "))
    try:
        key = kalshi.load_private_key(path)
    except FileNotFoundError:
        sys.exit(f"No file at {path}")
    except ValueError:
        sys.exit("That file isn't a private key. It should be the .txt Kalshi downloaded when you made the key.")
    kind = "Ed25519" if isinstance(key, kalshi.Ed25519PrivateKey) else "RSA"

    os.makedirs(kalshi.HOME, mode=0o700, exist_ok=True)
    os.chmod(kalshi.HOME, 0o700)
    stored = os.path.join(kalshi.HOME, "kalshi_private_key.pem")
    if os.path.abspath(path) != os.path.abspath(stored):
        shutil.copyfile(path, stored)
    os.chmod(stored, 0o600)
    with open(kalshi.CONFIG_PATH, "w") as f:
        json.dump({"key_id": key_id, "private_key": stored}, f, indent=2)
    os.chmod(kalshi.CONFIG_PATH, 0o600)

    print(f"\nChecking with Kalshi ({kind} key)...")
    try:
        kalshi.initialize()
        data = kalshi._request("GET", "/portfolio/balance")
    except Exception as e:
        print(f"Kalshi didn't accept it: {e}")
        print("Check the Key ID matches this key file (and that the key wasn't deleted), then run ./parlay setup again.")
        sys.exit(1)
    cents = data.get("balance")
    print(f"Connected. Balance: ${cents / 100:,.2f}" if isinstance(cents, (int, float)) else "Connected.")
    print(f"\nYour key is saved in {kalshi.HOME} (only your account can read it).")
    if os.path.abspath(path) != os.path.abspath(stored):
        print(f"You can delete the downloaded copy now: {path}")
    print("Start the site with: ./parlay")


if __name__ == "__main__":
    main()
