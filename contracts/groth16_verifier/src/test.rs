// test.rs — wire real test vectors in here once trusted_setup.sh has
// run for kyc_ocr.circom. snarkjs can export a sample proof + public
// signals JSON for a known-good witness (see backend test fixtures in
// your original groth16-verifier crate for the exact pattern — same
// idea, just swap in the new VK bytes from generate_verifier.js output
// and a proof generated against kyc_ocr.circom instead of the old
// single-purpose kyc.circom).
//
// Until those are wired in, this module intentionally contains no
// tests rather than fake/stub assertions that would pass without
// verifying anything — an empty test file is honest about what's not
// yet verified; a fake-passing test is not.
