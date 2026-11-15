#!/usr/bin/env bash
# Creates a release signing key for the Android app and prints what to paste into GitHub Secrets.
# Keep the generated file and passwords private — never commit them.
set -euo pipefail
OUT="${1:-kompare-release.keystore}"
read -rsp "Choose a keystore password (min 6 chars): " PASS; echo
keytool -genkeypair -v -keystore "$OUT" -alias kompare -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" -dname "CN=Kompare, O=Kompare, C=IN"
echo
echo "GitHub → Settings → Secrets and variables → Actions → New repository secret:"
echo "  ANDROID_KEYSTORE_BASE64 = (contents of $OUT.base64)"; base64 -w0 "$OUT" > "$OUT.base64"
echo "  ANDROID_KEYSTORE_PASSWORD = <the password you chose>"
echo "  ANDROID_KEY_ALIAS = kompare"
echo "  ANDROID_KEY_PASSWORD = <the password you chose>"
echo
echo "SHA-1 to add in Firebase → Project settings → Your Android app (app.kompare.mobile):"
keytool -list -v -keystore "$OUT" -alias kompare -storepass "$PASS" | grep -E "SHA1|SHA-1"
