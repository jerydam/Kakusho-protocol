import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { isPastDate, isValidDateInput, isValidDocumentNumber } from '../utils/mrz';
import { useSession } from '../context/SessionContext';

type Props = NativeStackScreenProps<RootStackParamList, 'MrzEntry'>;

/**
 * Collects the three MRZ fields needed to derive a BAC key. If your OCR
 * pipeline already extracts these from the passport photo page, prefer
 * pre-filling this form (or skipping it) over asking the user to retype
 * digits they just had OCR'd on the desktop — manual entry is the fallback,
 * not the primary path.
 */
export default function MrzEntryScreen({ navigation }: Props) {
  const { session, linkError } = useSession();

  const [documentNo, setDocumentNo] = useState('');
  const [birthDate, setBirthDate] = useState(''); // YYYY-MM-DD
  const [expiryDate, setExpiryDate] = useState(''); // YYYY-MM-DD
  const [touched, setTouched] = useState(false);

  const errors = useMemo(() => {
    const e: Partial<Record<'documentNo' | 'birthDate' | 'expiryDate', string>> = {};
    if (touched && !isValidDocumentNumber(documentNo)) {
      e.documentNo = 'Enter the passport document number (6-9 alphanumeric characters).';
    }
    if (touched && !(isValidDateInput(birthDate) && isPastDate(birthDate))) {
      e.birthDate = 'Enter date of birth as YYYY-MM-DD.';
    }
    if (touched && !isValidDateInput(expiryDate)) {
      e.expiryDate = 'Enter expiry date as YYYY-MM-DD.';
    }
    return e;
  }, [touched, documentNo, birthDate, expiryDate]);

  const canContinue =
    isValidDocumentNumber(documentNo) &&
    isValidDateInput(birthDate) &&
    isPastDate(birthDate) &&
    isValidDateInput(expiryDate);

  const handleContinue = () => {
    setTouched(true);
    if (!canContinue) return;

    navigation.navigate('NfcScan', {
      bacKey: {
        documentNo: documentNo.toUpperCase(),
        birthDate,
        expiryDate,
      },
    });
  };

  if (!session) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.body}>
            {linkError ?? 'Missing verification session. Please re-scan the QR code.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Enter passport details</Text>
          <Text style={styles.subtitle}>
            These are the three fields printed in the machine-readable zone on your passport's
            photo page. They're used to unlock the chip — nothing is sent anywhere yet.
          </Text>

          <Field
            label="Document number"
            value={documentNo}
            onChangeText={(t) => setDocumentNo(t.toUpperCase())}
            placeholder="e.g. A1234567"
            autoCapitalize="characters"
            error={errors.documentNo}
          />
          <Field
            label="Date of birth"
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="YYYY-MM-DD"
            keyboardType="numeric"
            error={errors.birthDate}
          />
          <Field
            label="Date of expiry"
            value={expiryDate}
            onChangeText={setExpiryDate}
            placeholder="YYYY-MM-DD"
            keyboardType="numeric"
            error={errors.expiryDate}
          />

          <TouchableOpacity
            style={[styles.button, !canContinue && touched && styles.buttonDisabled]}
            onPress={handleContinue}
          >
            <Text style={styles.buttonText}>Continue to NFC scan</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({
  label,
  error,
  ...inputProps
}: {
  label: string;
  error?: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error && styles.inputError]}
        placeholderTextColor="#5B6573"
        {...inputProps}
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  content: { padding: 24, paddingBottom: 48 },
  title: { color: '#E6EDF3', fontSize: 22, fontWeight: '600', marginBottom: 8 },
  subtitle: { color: '#8B98A5', fontSize: 14, lineHeight: 20, marginBottom: 28 },
  field: { marginBottom: 18 },
  label: { color: '#C3CCD6', fontSize: 13, marginBottom: 6 },
  input: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A323D',
    color: '#E6EDF3',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  inputError: { borderColor: '#E5534B' },
  errorText: { color: '#E5534B', fontSize: 12, marginTop: 6 },
  button: {
    backgroundColor: '#2F81F7',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  body: { color: '#8B98A5', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
