declare module 'snarkjs' {
  export const groth16: {
    fullProve(
      input: Record<string, string | string[]>,
      wasmFile: string | Uint8Array,
      zkeyFile: string | Uint8Array,
    ): Promise<{ proof: any; publicSignals: string[] }>;
  };
}