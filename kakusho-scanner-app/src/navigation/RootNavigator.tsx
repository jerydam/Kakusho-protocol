import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { RootStackParamList } from './types';
import MrzEntryScreen from '../screens/MrzEntryScreen';
import NfcScanScreen from '../screens/NfcScanScreen';
import ResultScreen from '../screens/ResultScreen';
import NoSessionScreen from '../screens/NoSessionScreen';
import { useSession } from '../context/SessionContext';

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { session, linkError } = useSession();

  if (!session) {
    return (
      <NavigationContainer>
        <NoSessionScreen errorMessage={linkError} />
      </NavigationContainer>
    );
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: '#0B0F14' },
          headerTintColor: '#E6EDF3',
          headerShadowVisible: false,
          contentStyle: { backgroundColor: '#0B0F14' },
        }}
      >
        <Stack.Screen name="MrzEntry" component={MrzEntryScreen} options={{ title: 'Verify' }} />
        <Stack.Screen name="NfcScan" component={NfcScanScreen} options={{ title: 'Scan passport' }} />
        <Stack.Screen
          name="Result"
          component={ResultScreen}
          options={{ title: 'Result', headerBackVisible: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
