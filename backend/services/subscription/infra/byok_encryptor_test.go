package infra

import "testing"

func TestBYOKEncryptor_RoundTrip(t *testing.T) {
	enc, err := NewBYOKEncryptor("test-secret-2026")
	if err != nil {
		t.Fatalf("init: %v", err)
	}
	plain := "sk-or-abc123-xyz789"
	cipher, err := enc.Encrypt(plain)
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}
	if cipher == plain {
		t.Fatal("cipher must differ from plaintext")
	}
	out, err := enc.Decrypt(cipher)
	if err != nil {
		t.Fatalf("decrypt: %v", err)
	}
	if out != plain {
		t.Fatalf("roundtrip mismatch: got %q want %q", out, plain)
	}
}

func TestBYOKEncryptor_EmptySecret(t *testing.T) {
	if _, err := NewBYOKEncryptor(""); err == nil {
		t.Fatal("expected error on empty secret")
	}
}

func TestBYOKEncryptor_DifferentSecretsFail(t *testing.T) {
	e1, _ := NewBYOKEncryptor("alpha")
	e2, _ := NewBYOKEncryptor("beta")
	cipher, _ := e1.Encrypt("sk-test")
	if _, err := e2.Decrypt(cipher); err == nil {
		t.Fatal("expected decryption to fail with mismatched key")
	}
}
