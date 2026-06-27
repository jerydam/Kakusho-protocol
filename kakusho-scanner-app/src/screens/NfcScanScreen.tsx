import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import type { ScanStatus } from '../types';
import { checkNfcAvailability, openDeviceNfcSettings, readPassport } from '../native/passportReader';
import { describeApiError, submitNfcProof } from '../api/relayerClient';
import { useSession } from '../context/SessionContext';

type Props = NativeStackScreenProps<RootStackParamList, 'NfcScan'>;

export default function NfcScanScreen({ route, navigation }: Props) {
  const { bacKey } = route.params;
  const { session } = useSession();

  const [status, setStatus] = useState<ScanStatus>('checking_nfc');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const runScan = useCallback(async () => {
    setErrorMessage(null);
    setStatus('checking_nfc');

    const availability = await checkNfcAvailability();
    if (!availability.supported) {
      setStatus('nfc_unavailable');
      setErrorMessage('This device does not support NFC, so the chip on your passport can\u2019t be read here.');
      return;
    }
    if (!availability.enabled) {
      setStatus('nfc_unavailable');
      setErrorMessage('NFC is turned off. Enable it in settings, then try again.');
      return;
    }

    if (!session) {
      setStatus('error');
      setErrorMessage('Verification session was lost. Please re-scan the QR code from your desktop.');
      return;
    }

    try {
      setStatus('awaiting_tap');
      const result = await readPassport(bacKey);

      setStatus('submitting');
      await submitNfcProof(session, result);

      setStatus('success');
      navigation.replace('Result', { success: true, result });
    } catch (err) {
      setStatus('error');
      const message =
        err instanceof Error && err.message.includes('axios')
          ? describeApiError(err)
          : describeReadError(err);
      setErrorMessage(message);
    }
  }, [bacKey, navigation, session]);

  useEffect(() => {
    runScan();
  }, [runScan]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {status === 'awaiting_tap' && (
          <>
            <ActivityIndicator size="large" color="#2F81F7" />
            <Text style={styles.title}>Hold your passport against your phone</Text>
            <Text style={styles.subtitle}>
              {Platform.OS === 'ios'
                ? 'Place the passport\u2019s photo page flat against the top of your phone and hold still.'
                : 'Place the passport\u2019s photo page flat against the back of your phone and hold still.'}
            </Text>
          </>
        )}

        {(status === 'checking_nfc' || status === 'submitting') && (
          <>
            <ActivityIndicator size="large" color="#2F81F7" />
            <Text style={styles.title}>
              {status === 'checking_nfc' ? 'Checking NFC...' : 'Submitting verification...'}
            </Text>
          </>
        )}

        {(status === 'error' || status === 'nfc_unavailable') && (
          <>
            <Text style={styles.titleError}>Couldn\u2019t complete the scan</Text>
            <Text style={styles.subtitle}>{errorMessage}</Text>

            <TouchableOpacity style={styles.button} onPress={runScan}>
              <Text style={styles.buttonText}>Try again</Text>
            </TouchableOpacity>

            {status === 'nfc_unavailable' && Platform.OS === 'android' && (
              <TouchableOpacity style={styles.secondaryButton} onPress={openDeviceNfcSettings}>
                <Text style={styles.secondaryButtonText}>Open NFC settings</Text>
              </TouchableOpacity>
            )}
            {status === 'nfc_unavailable' && Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.secondaryButton} onPress={() => Linking.openSettings()}>
                <Text style={styles.secondaryButtonText}>Open settings</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function describeReadError(err: unknown): string {
  const message = err instanceof Error ? err.message.toLowerCase() : '';

  if (message.includes('bac') || message.includes('access') || message.includes('key')) {
    return 'The chip rejected the passport details entered. Double check the document number, date of birth, and expiry date and try again.';
  }
  if (message.includes('tag') && (message.includes('lost') || message.includes('removed'))) {
    return 'The passport moved away from your phone before the read finished. Hold it still against your phone and try again.';
  }
  return 'The passport chip could not be read. Hold the passport flat against your phone, away from any case, and try again.';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { color: '#E6EDF3', fontSize: 18, fontWeight: '600', marginTop: 20, textAlign: 'center' },
  titleError: { color: '#E5534B', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  subtitle: {
    color: '#8B98A5',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#2F81F7',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 28,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { marginTop: 14, paddingVertical: 8 },
  secondaryButtonText: { color: '#2F81F7', fontSize: 14 },
});
