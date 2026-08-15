import assert from 'node:assert/strict'
import test from 'node:test'
import { redact, redactText } from '../src/daemon/redaction.ts'

const slackToken = ['xox', 'b', '1234567890', '1234567890123', 'abcdefghijklmnopqrstuvwx'].join('-').replace('xox-b', 'xoxb')

test('redacts OpenAI-style sk- keys', () => {
  const out = redactText('key is sk-abcdefghijklmnop123456')
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, /sk-abcdefghijklmnop123456/)
})

test('redacts GitHub tokens (ghp_ and github_pat_)', () => {
  assert.match(redactText('token ghp_abcdefghijklmnop1234'), /\[REDACTED\]/)
  assert.match(redactText('token github_pat_abcdefghijklmnop1234'), /\[REDACTED\]/)
})

test('redacts Bearer auth headers', () => {
  const out = redactText('Authorization: Bearer abcdefghijklmnop.123456')
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, /abcdefghijklmnop\.123456/)
})

test('redacts PEM private key blocks', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----'
  const out = redactText(`cert:\n${pem}`)
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, /MIIEpAIBAAKCAQEA/)
})

test('redacts AWS access key ids', () => {
  const out = redactText('AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE')
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, /AKIAIOSFODNN7EXAMPLE/)
})

test('redacts Google API keys', () => {
  const out = redactText('key=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY')
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, /AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY/)
})

test('redacts Slack tokens', () => {
  const out = redactText(`SLACK_TOKEN=${slackToken}`)
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, /abcdefghijklmnopqrstuvwx/)
})

test('redacts JWTs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
  const out = redactText(`auth token: ${jwt}`)
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, new RegExp(jwt.replace(/\./g, '\\.')))
})

test('redacts embedded URL credentials, keeps user and host', () => {
  const out = redactText('DATABASE_URL=postgres://dbuser:p4ssw0rd123@localhost:5432/mydb')
  assert.match(out, /\[REDACTED\]/)
  assert.doesNotMatch(out, /p4ssw0rd123/)
  assert.match(out, /dbuser/)
  assert.match(out, /localhost:5432\/mydb/)
})

test('redacts generic KEY=value and key: value assignments by key name', () => {
  assert.match(redactText('api_key=abcdefghij12345'), /api_key=\[REDACTED\]/)
  assert.doesNotMatch(redactText('api_key=abcdefghij12345'), /abcdefghij12345/)

  assert.match(redactText('password: hunter2hunter2'), /password:\s*\[REDACTED\]/)
  assert.doesNotMatch(redactText('password: hunter2hunter2'), /hunter2hunter2/)
})

test('does not redact short values or unrelated keys', () => {
  assert.equal(redactText('short=1234567'), 'short=1234567')
  assert.equal(redactText('username=johndoe123456'), 'username=johndoe123456')
})

test('leaves non-secret text untouched', () => {
  const text = 'This is a normal log line with nothing sensitive in it.'
  assert.equal(redactText(text), text)
  assert.equal(redactText(undefined), undefined)
})

test('redacts object values by key name recursively', () => {
  const input = {
    apiKey: 'plain-secret-value',
    nested: { password: 'plain-secret-value', safe: 'ok' },
    list: [{ token: 'plain-secret-value' }, 'sk-abcdefghijklmnop123456'],
  }
  const out = redact(input)
  assert.equal(out.apiKey, '[REDACTED]')
  assert.equal(out.nested.password, '[REDACTED]')
  assert.equal(out.nested.safe, 'ok')
  assert.equal(out.list[0].token, '[REDACTED]')
  assert.match(out.list[1], /\[REDACTED\]/)
})

test('redacts a realistic multiline .env dump end to end', () => {
  const dump = [
    'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE',
    'AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY',
    'GOOGLE_API_KEY=AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY',
    `SLACK_TOKEN=${slackToken}`,
    'GITHUB_TOKEN=ghp_abcdefghijklmnop1234',
    'DATABASE_URL=postgres://dbuser:p4ssw0rd123@localhost:5432/mydb',
    'JWT_SECRET=abcdef1234567890',
    'APP_NAME=clibridge',
  ].join('\n')

  const out = redactText(dump)

  assert.doesNotMatch(out, /AKIAIOSFODNN7EXAMPLE/)
  assert.doesNotMatch(out, /wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY/)
  assert.doesNotMatch(out, /AIzaSyD-9tSrke72PouQMnMX-a7eZSW0jkFMBWY/)
  assert.doesNotMatch(out, /abcdefghijklmnopqrstuvwx/)
  assert.doesNotMatch(out, /ghp_abcdefghijklmnop1234/)
  assert.doesNotMatch(out, /p4ssw0rd123/)
  assert.doesNotMatch(out, /abcdef1234567890/)
  assert.match(out, /APP_NAME=clibridge/)
  assert.match(out, /dbuser/)
})
