import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.CUMORA_RUNTIME_CLIENT = 'http'
process.env.OPENAI_API_KEY ??= 'test-key'

const { drainWorkspaceCleanupJobs, findReferencedStorageKeys, CLEANUP_MAX_ATTEMPTS } = await import('../workspace-cleanup.js')
const { pool } = await import('../db/pool.js')

test('cleanup claims are capped and message references match the key exactly', async () => {
  const original = pool.query.bind(pool)
  const sql: string[] = []
  pool.query = (async (text: string) => {
    sql.push(String(text))
    return { rows: [], rowCount: 0 }
  }) as unknown as typeof pool.query
  try {
    await drainWorkspaceCleanupJobs({
      dependencies: {
        deleteStorageObject: async () => true,
        deleteAgentRuntime: async () => {},
      },
    })
    await findReferencedStorageKeys(['attachments/exact.png'])
  } finally {
    pool.query = original as typeof pool.query
  }
  const claim = sql.find((statement) => statement.includes('FOR UPDATE SKIP LOCKED'))
  assert.ok(claim, 'drain did not claim a job')
  assert.match(claim, /attempts < \$4/)
  const messages = sql.find((statement) => statement.includes('FROM messages'))
  assert.ok(messages)
  // Legacy singular column AND the schema-0012 attachments array — the
  // ->>'key' projection returns NULL for JSON arrays, so without the
  // jsonb_array_elements clause GC would delete objects referenced only
  // by attachments[1..].
  assert.match(messages, /attachment->>'key' = ANY/)
  assert.match(messages, /jsonb_array_elements/)
  assert.doesNotMatch(messages, /LIKE/)
  assert.equal(CLEANUP_MAX_ATTEMPTS, 12)
})
