package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestMintedTokenVerifiesAndCarriesClaims(t *testing.T) {
	secret := []byte("test-secret")
	expires := time.Now().Add(time.Hour)
	tokens, err := mint(secret, []userRow{{ID: "user-1", C: 2, R: 2, U: 2, D: 2}}, expires)
	if err != nil || len(tokens) != 1 {
		t.Fatalf("mint = %v, %v", tokens, err)
	}
	if tokens[0].Exp != expires.Unix() {
		t.Fatalf("exp = %d, want %d", tokens[0].Exp, expires.Unix())
	}
	parts := strings.Split(tokens[0].Token, ".")
	if len(parts) != 3 {
		t.Fatalf("token has %d parts", len(parts))
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if parts[2] != b64.EncodeToString(mac.Sum(nil)) {
		t.Fatal("signature does not verify with the secret")
	}
	payload, err := b64.DecodeString(parts[1])
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]any
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatal(err)
	}
	if got["sub"] != "user-1" || got["r"] != float64(2) || got["c"] != float64(2) || got["exp"] != float64(expires.Unix()) {
		t.Fatalf("claims = %v", got)
	}
	// The API treats a token with r <= 0 as not an access token (Token.IsAccessToken).
	if got["r"].(float64) <= 0 {
		t.Fatal("token would be refused as not an access token")
	}
}

func TestReadUsersRejectsBadRows(t *testing.T) {
	if _, err := readUsers(strings.NewReader("abc,2,2,2\n")); err == nil {
		t.Fatal("a row with four fields was accepted")
	}
	if _, err := readUsers(strings.NewReader("abc,2,x,2,2\n")); err == nil {
		t.Fatal("a non-numeric access level was accepted")
	}
	rows, err := readUsers(strings.NewReader("abc,2,2,2,2\ndef,1,1,1,1\n"))
	if err != nil || len(rows) != 2 || rows[1].ID != "def" {
		t.Fatalf("rows = %v, err = %v", rows, err)
	}
}
