# Android build notes

1. **minSdkVersion**: the NFC passport reading library depends on
   `IsoDep`/`NfcA` tag tech which is available from API 16+, but JMRTD's
   crypto stack and the library's own requirements typically push this to
   **API 24 (Android 7.0)** in practice. Check `android/build.gradle` ->
   `minSdkVersion` and raise it if the library's own `build.gradle`
   declares a higher floor — it usually will fail the build loudly if so.

2. **Dependency conflicts**: `react-native-nfc-passport-info` (and the
   JMRTD-based libraries generally) pull in `org.jmrtd:jmrtd`,
   `net.sf.scuba:scuba-sc-android`, and a SpongyCastle/BouncyCastle
   provider. If you (or another dependency, e.g. a different KYC/NFC SDK)
   already include any of these, you'll get duplicate-class errors at
   build time. Exclude the duplicate from whichever dependency pulled it
   in second, e.g.:

   ```gradle
   implementation('some.other.sdk:thing:1.0.0') {
       exclude group: 'org.jmrtd', module: 'jmrtd'
       exclude group: 'net.sf.scuba', module: 'scuba-sc-android'
       exclude group: 'com.madgag.spongycastle', module: 'prov'
   }
   ```

3. **ProGuard/R8**: if you enable minification for release builds, add
   keep rules for the JMRTD/SCUBA/SpongyCastle packages — reflection-heavy
   crypto libraries like this are a common source of release-only crashes
   that don't reproduce in debug builds. Test a release build (not just
   debug) against a physical passport before shipping.

4. **Physical device only**: NFC passport reading cannot be tested in the
   Android emulator. You need a physical Android device with NFC hardware
   and a physical passport (or an ICAO test document) for any real
   end-to-end test.
