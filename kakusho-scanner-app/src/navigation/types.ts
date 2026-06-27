import type { BacKey, NfcReadResult } from '../types';

export type RootStackParamList = {
  MrzEntry: undefined;
  NfcScan: { bacKey: BacKey };
  Result: { success: true; result: NfcReadResult } | { success: false; message: string };
};
