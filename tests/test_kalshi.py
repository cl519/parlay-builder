import base64
import json
import os
import tempfile
import unittest
from unittest import mock

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, padding, rsa

import kalshi
from setup_key import clean_path

TEXT = "1761450000000GET/trade-api/v2/portfolio/balance"


def pem(key, fmt):
    return key.private_bytes(serialization.Encoding.PEM, fmt, serialization.NoEncryption())


class SignTest(unittest.TestCase):
    """Throwaway keys made here: the signature must verify with the key's own public half."""

    def test_ed25519(self):
        key = ed25519.Ed25519PrivateKey.generate()
        key.public_key().verify(base64.b64decode(kalshi.sign(key, TEXT)), TEXT.encode())  # raises if wrong

    def test_rsa_pss(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        key.public_key().verify(base64.b64decode(kalshi.sign(key, TEXT)), TEXT.encode(),
                                padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=padding.PSS.DIGEST_LENGTH),
                                hashes.SHA256())

    def test_loads_both_kinds_of_key_file(self):
        keys = [(ed25519.Ed25519PrivateKey.generate(), serialization.PrivateFormat.PKCS8),  # Kalshi's .txt download
                (rsa.generate_private_key(public_exponent=65537, key_size=2048), serialization.PrivateFormat.TraditionalOpenSSL)]
        with tempfile.TemporaryDirectory() as d:
            for i, (key, fmt) in enumerate(keys):
                path = os.path.join(d, f"key{i}.txt")
                with open(path, "wb") as f:
                    f.write(pem(key, fmt))
                self.assertIsInstance(kalshi.load_private_key(path), type(key))


class ConfigTest(unittest.TestCase):
    def test_missing_config_says_run_setup(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(kalshi, "CONFIG_PATH", os.path.join(d, "config.json")):
            with self.assertRaisesRegex(kalshi.NotSetUp, "./parlay setup"):
                kalshi.load_config()

    def test_incomplete_config(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "config.json")
            with open(path, "w") as f:
                json.dump({"key_id": "abc"}, f)
            with mock.patch.object(kalshi, "CONFIG_PATH", path), self.assertRaises(kalshi.NotSetUp):
                kalshi.load_config()


class DraggedPathTest(unittest.TestCase):
    def test_terminal_drag_formats(self):
        self.assertEqual(clean_path("/Users/a/Downloads/my\\ key.txt "), "/Users/a/Downloads/my key.txt")
        self.assertEqual(clean_path("'/Users/a/Downloads/my key.txt'"), "/Users/a/Downloads/my key.txt")


if __name__ == "__main__":
    unittest.main()
