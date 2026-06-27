import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';

interface Props {
  errorMessage?: string | null;
}

export default function NoSessionScreen({ errorMessage }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Kakushō Scanner</Text>
        <Text style={styles.body}>
          {errorMessage ??
            'Open this app by scanning the QR code on your Kakushō verification page, or by tapping the verification link sent to you.'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  title: { color: '#E6EDF3', fontSize: 22, fontWeight: '600', marginBottom: 16 },
  body: { color: '#8B98A5', fontSize: 15, textAlign: 'center', lineHeight: 22 },
});
