// Command mint signs HS256 access tokens for the seeded stress-test users.
//
// The KUYY API checks a token only against AUTH_SECRET and its c/r/u/d access claims, so a token
// minted with the secret of the TEST environment is accepted there and nowhere else.
//
//	AUTH_SECRET=... go run ./tools/mint -in users.csv -out tokens.json
//
// Input is a CSV with one user per line: id,c_access,r_access,u_access,d_access (sql/export_users.sql).
// Output is a JSON array of {"id", "token"}.
//
// The secret is read from the environment and is never printed. Do not use the secret of dev, beta or prod.
package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"
)

type userRow struct {
	ID         string
	C, R, U, D int
}

type tokenOut struct {
	ID    string `json:"id"`
	Token string `json:"token"`
	Exp   int64  `json:"exp"`
}

// claims mirrors the JSON tags of domain/users/model.Token. Fields the stress tests do not need
// (permissions, access, scope, station_id) are left out: their tags are all omitempty.
type claims struct {
	C              int    `json:"c"`
	R              int    `json:"r"`
	U              int    `json:"u"`
	D              int    `json:"d"`
	OriginalUserID string `json:"original_user_id"`
	Subject        string `json:"sub"`
	ExpiresAt      int64  `json:"exp"`
}

var b64 = base64.RawURLEncoding

func sign(secret []byte, c claims) (string, error) {
	header, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(c)
	if err != nil {
		return "", err
	}
	signingInput := b64.EncodeToString(header) + "." + b64.EncodeToString(payload)
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(signingInput))
	return signingInput + "." + b64.EncodeToString(mac.Sum(nil)), nil
}

func readUsers(r io.Reader) ([]userRow, error) {
	reader := csv.NewReader(r)
	reader.FieldsPerRecord = 5
	var rows []userRow
	for {
		rec, err := reader.Read()
		if errors.Is(err, io.EOF) {
			return rows, nil
		}
		if err != nil {
			return nil, err
		}
		u := userRow{ID: strings.TrimSpace(rec[0])}
		for i, dst := range []*int{&u.C, &u.R, &u.U, &u.D} {
			n, err := strconv.Atoi(strings.TrimSpace(rec[i+1]))
			if err != nil {
				return nil, fmt.Errorf("user %s: access level %q is not a number", u.ID, rec[i+1])
			}
			*dst = n
		}
		if u.ID == "" {
			return nil, errors.New("empty user id")
		}
		rows = append(rows, u)
	}
}

func mint(secret []byte, users []userRow, expiresAt time.Time) ([]tokenOut, error) {
	out := make([]tokenOut, 0, len(users))
	for _, u := range users {
		token, err := sign(secret, claims{C: u.C, R: u.R, U: u.U, D: u.D, Subject: u.ID, ExpiresAt: expiresAt.Unix()})
		if err != nil {
			return nil, err
		}
		out = append(out, tokenOut{ID: u.ID, Token: token, Exp: expiresAt.Unix()})
	}
	return out, nil
}

func main() {
	in := flag.String("in", "-", "CSV of id,c,r,u,d (- for stdin)")
	outPath := flag.String("out", "tokens.json", "where to write the tokens")
	ttl := flag.Duration("ttl", 24*time.Hour, "how long the tokens stay valid; a soak test needs more than the 30 minutes of a real sign-in")
	flag.Parse()

	secret := os.Getenv("AUTH_SECRET")
	if secret == "" {
		fmt.Fprintln(os.Stderr, "AUTH_SECRET is not set. Use the secret of the stress-test environment.")
		os.Exit(2)
	}

	src := os.Stdin
	if *in != "-" {
		f, err := os.Open(*in)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer f.Close()
		src = f
	}
	users, err := readUsers(src)
	if err != nil {
		fmt.Fprintln(os.Stderr, "read users:", err)
		os.Exit(1)
	}
	if len(users) == 0 {
		fmt.Fprintln(os.Stderr, "no users in the input. Seed the database and export sql/export_users.sql first.")
		os.Exit(1)
	}
	tokens, err := mint([]byte(secret), users, time.Now().Add(*ttl))
	if err != nil {
		fmt.Fprintln(os.Stderr, "mint:", err)
		os.Exit(1)
	}
	data, err := json.Marshal(tokens)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// 0600: the file is a set of working credentials for the test environment.
	if err := os.WriteFile(*outPath, data, 0o600); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Printf("wrote %d tokens to %s (valid for %s)\n", len(tokens), *outPath, *ttl)
}
