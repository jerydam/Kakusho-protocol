// Thin adapter around the native NFC passport-reading library so the rest
// of the app never imports it directly. If you swap libraries later
// (e.g. react-native-nfc-passport-info <-> @didit-sdk/react-native-nfc-passport-reader)
// this is the only file that needs to change.
//
// IMPORTANT: verify the exact method names against the installed package's
// index.d.ts / README before shipping. Several forks of this library exist
// (react-native-nfc-passport-info, @didit-sdk/react-native-nfc-passport-reader,
// react-native-nfc-passport-reader) with slightly different signatures —
// the shape below matches the common API surface across that family
// (startReading / isNfcSupported / isNfcEnabled / openNfcSettings), but
// confirm before your first physical-device test.

import type { BacKey, NfcAvailability, NfcReadResult } from '../types';
import { Platform } from 'react-native';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const NativeReader = require('react-native-nfc-passport-info');

export async function checkNfcAvailability(): Promise<NfcAvailability> {
  const supported: boolean = await NativeReader.isNfcSupported();
  if (!supported) {
    return { supported: false, enabled: false };
  }

  // iOS doesn't expose a separate enabled/disabled toggle the way Android
  // does — CoreNFC is either supported by the device or it isn't.
  if (Platform.OS === 'ios') {
    return { supported: true, enabled: true };
  }

  const enabled: boolean =
    typeof NativeReader.isNfcEnabled === 'function' ? await NativeReader.isNfcEnabled() : true;

  return { supported: true, enabled };
}

export async function openDeviceNfcSettings(): Promise<void> {
  if (Platform.OS === 'android' && typeof NativeReader.openNfcSettings === 'function') {
    await NativeReader.openNfcSettings();
  }
}

/**
 * Performs BAC + secure messaging + DG1/DG2/SOD read + passive
 * authentication against the master list bundled with the native module.
 * Throws if the tap fails, the BAC key is wrong, or the tag is removed
 * mid-read — surface these to the user as "try again" rather than a fatal
 * error, since a failed tap is the normal/expected case on a first attempt.
 */
export async function readPassport(bacKey: BacKey): Promise<NfcReadResult> {
  const raw = await NativeReader.startReading({
    bacKey,
    includeImages: true,
  });

  return {
    documentNo: raw.documentNumber ?? bacKey.documentNo,
    firstName: raw.firstName ?? '',
    lastName: raw.lastName ?? '',
    nationality: raw.nationality ?? '',
    dateOfBirth: raw.dateOfBirth ?? bacKey.birthDate,
    dateOfExpiry: raw.dateOfExpiry ?? bacKey.expiryDate,
    gender: raw.gender ?? '',
    issuingState: raw.issuingState ?? '',
    faceImageBase64: raw.faceImage,
    dg1Base64: raw.dg1,
    sodBase64: raw.sod,
    passiveAuthVerified: Boolean(raw.passiveAuthenticationSucceeded ?? raw.isPAValid),
  };
}
