/**
 * Chat multi-attachment trust boundary (schema 0012 / issue #349).
 *
 * `parseMessageAttachments` is the validation gate every client-supplied
 * attachment passes through before it can become a storage-backed message
 * payload — the same key-then-mint rule the router used to inline. Extracting
 * it here means the trust boundary is unit-testable without booting the
 * 7k-line router, and `rowAttachments` / `freshenAttachments` pin the
 * dual-shape coalesce every read path depends on.
 *
 * Run: node --import tsx --test server/src/__tests__/message-attachments.test.ts
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

process.env.CUMORA_RUNTIME_CLIENT = 'http'
process.env.OPENAI_API_KEY ??= 'test-key'

const {
  MAX_CHAT_ATTACHMENTS,
  freshenAttachments,
  parseMessageAttachments,
  rowAttachments,
} = await import('../storage.js')

const localAtt = (name: string, over: Record<string, unknown> = {}) => ({
  url: `/uploads/attachments/${name}`,
  name,
  kind: 'file',
  ...over,
})

// ── parseMessageAttachments ─────────────────────────────────────────────────

test('a singular legacy object is accepted and wrapped', async () => {
  const parsed = await parseMessageAttachments(localAtt('a.txt'))
  assert.ok('attachments' in parsed)
  assert.equal(parsed.attachments.length, 1)
  assert.equal(parsed.attachments[0].name, 'a.txt')
  assert.equal(parsed.attachments[0].key, 'attachments/a.txt')
  assert.equal(parsed.attachments[0].kind, 'file')
})

test('an array of N resolves every element', async () => {
  const parsed = await parseMessageAttachments([
    localAtt('a.txt'),
    localAtt('b.pdf', { kind: 'pdf' }),
    localAtt('c.png', { kind: 'img' }),
  ])
  assert.ok('attachments' in parsed)
  assert.deepEqual(parsed.attachments.map((a) => a.name), ['a.txt', 'b.pdf', 'c.png'])
  assert.deepEqual(parsed.attachments.map((a) => a.kind), ['file', 'pdf', 'img'])
})

test('more than MAX_CHAT_ATTACHMENTS is refused', async () => {
  const many = Array.from({ length: MAX_CHAT_ATTACHMENTS + 1 }, (_, i) => localAtt(`f${i}.txt`))
  const parsed = await parseMessageAttachments(many)
  assert.ok('error' in parsed)
  assert.match(parsed.error, /too many attachments/)
})

test('a URL outside Cumora storage is refused', async () => {
  const parsed = await parseMessageAttachments([
    { url: 'https://attacker.example/payload.txt', name: 'payload.txt', kind: 'file' },
  ])
  assert.ok('error' in parsed)
  assert.match(parsed.error, /must reference Cumora storage/)
})

test('a non-object entry is skipped, not fatal', async () => {
  const parsed = await parseMessageAttachments([null, 42, localAtt('ok.txt')])
  assert.ok('attachments' in parsed)
  assert.equal(parsed.attachments.length, 1)
  assert.equal(parsed.attachments[0].name, 'ok.txt')
})

// ── rowAttachments (dual-shape coalesce) ────────────────────────────────────

test('a legacy singular row wraps to a one-element list', () => {
  const a = { url: '/uploads/attachments/a.txt', name: 'a.txt', kind: 'file' }
  assert.deepEqual(rowAttachments({ attachment: a }), [a])
})

test('the plural column wins when present', () => {
  const a = { url: '/uploads/attachments/a.txt', name: 'a.txt', kind: 'file' }
  const b = { url: '/uploads/attachments/b.txt', name: 'b.txt', kind: 'file' }
  assert.deepEqual(rowAttachments({ attachment: a, attachments: [a, b] }), [a, b])
})

test('garbage shapes coerce to an empty list instead of throwing', () => {
  assert.deepEqual(rowAttachments({}), [])
  assert.deepEqual(rowAttachments({ attachment: null, attachments: null }), [])
  assert.deepEqual(rowAttachments({ attachments: 'nope' as unknown as never }), [])
  assert.deepEqual(rowAttachments({ attachments: [null, 7, { url: 1 }] as unknown as never }), [])
  assert.deepEqual(rowAttachments({ attachment: { url: 1 } }), [])
})

// ── freshenAttachments ──────────────────────────────────────────────────────

test('entries without keys fall back to their stored URL', async () => {
  // LocalStorage.publicUrl for a keyless legacy row keeps the input untouched
  // (freshenAttachmentUrl returns early); the point of the list wrapper is
  // that one element failing does not sink the others.
  const stale = { url: '/uploads/attachments/legacy.txt', name: 'legacy.txt', kind: 'file' as const }
  const fresh = await freshenAttachments([stale])
  assert.equal(fresh.length, 1)
  assert.equal(fresh[0].url, stale.url)
})
