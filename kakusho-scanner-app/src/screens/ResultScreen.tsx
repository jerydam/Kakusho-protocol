import React from 'react';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'Result'>;

/**
 * The desktop tab is the source of truth for "what happens next" — it's
 * polling/listening on the relayer for session completion already. This
 * screen's job is just to tell the user they're done on the phone and can
 * go back to their computer, not to navigate anywhere itself.
 */
export default function ResultScreen({ route, navigation }: Props) {
  const { params } = route;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {params.success ? (
          <>
            <Text style={styles.titleSuccess}>Verification submitted</Text>
            <Text style={styles.subtitle}>
              You can return to your computer now — the verification page will update
              automatically once processing finishes.
            </Text>
            {!params.result.passiveAuthVerified && (
              <Text style={styles.warning}>
                Note: passive authentication of the chip signature could not be confirmed.
                Depending on your integrator's policy this may require manual review.
              </Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.titleError}>Verification failed</Text>
            <Text style={styles.subtitle}>{params.message}</Text>
            <TouchableOpacity style={styles.button} onPress={() => navigation.popToTop()}>
              <Text style={styles.buttonText}>Start over</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  titleSuccess: { color: '#3FB950', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  titleError: { color: '#E5534B', fontSize: 20, fontWeight: '700', textAlign: 'center' },
  subtitle: {
    color: '#8B98A5',
    fontSize: 15,
    textAlign: 'center',
    marginTop: 14,
    lineHeight: 22,
  },
  warning: {
    color: '#D29922',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 18,
    lineHeight: 19,
  },
  button: {
    backgroundColor: '#2F81F7',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    marginTop: 28,
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
