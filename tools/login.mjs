// Gets a refresh token for every account in accounts.csv that has none, through the real e-mail OTP sign-in:
// GET /auth/emailotp, then POST /auth/emailsignin. A new e-mail address is registered by the API on its first sign-in.
//
//   node tools/login.mjs                          asks for the code of each account on the terminal
//   node tools/login.mjs --otp-file otps.csv      reads the codes from a CSV with the columns email,otp
//
// accounts.csv is updated after every account, so an interrupted run keeps its progress.
// The environment must send the codes somewhere you can read them. Do not use this against a KUYY environment
// that sends real e-mail to real people.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { call, describe, DEVICE, ok, out, readCsv, writeCsv } from './lib/api.mjs';

const file = process.env.ACCOUNTS_FILE || out('accounts.csv');
const otpFileIndex = process.argv.indexOf('--otp-file');
const otpFile = otpFileIndex >= 0 ? process.argv[otpFileIndex + 1] : undefined;

const accounts = readCsv(file);
// Keep the columns the user has, and make sure the token column exists.
const columns = Object.keys(accounts[0] || { email: '', role: '' });
if (!columns.includes('refresh_token')) columns.push('refresh_token');
const codes = otpFile ? Object.fromEntries(readCsv(otpFile).map((r) => [r.email, r.otp])) : {};
const pending = accounts.filter((a) => !a.refresh_token && !a.access_token);
console.log(`${accounts.length} accounts, ${pending.length} without a token.`);

const rl = otpFile ? undefined : readline.createInterface({ input: stdin, output: stdout });
let failed = 0;

for (const account of pending) {
  const requested = await call('GET', '/auth/emailotp', { query: { email: account.email } });
  if (requested.status !== 200 && requested.status !== 204) {
    console.error(`${account.email}: could not request a code: ${describe(requested)}`);
    failed++;
    continue;
  }
  const otp = otpFile ? codes[account.email] : (await rl.question(`${account.email} code: `)).trim();
  if (!otp) {
    console.error(`${account.email}: no code`);
    failed++;
    continue;
  }
  const body = { email: account.email, otp, project_id: process.env.PROJECT_ID || '', ...DEVICE };
  const signedIn = await call('POST', '/auth/emailsignin', { body });
  if (!ok(signedIn) || !signedIn.json?.refresh_token) {
    console.error(`${account.email}: sign-in failed: ${describe(signedIn)}`);
    failed++;
    continue;
  }
  account.refresh_token = signedIn.json.refresh_token;
  writeCsv(file, accounts, columns);
  console.log(`${account.email}: ok`);
}

rl?.close();
console.log(failed === 0 ? 'Done.' : `${failed} accounts failed. Run it again to retry them.`);
process.exit(failed === 0 ? 0 : 1);
