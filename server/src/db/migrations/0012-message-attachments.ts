import { createHash } from 'node:crypto'

export const MESSAGE_ATTACHMENTS_SQL = `
ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments JSONB;
`

export function messageAttachmentsChecksum(): string {
  return createHash('sha256').update(MESSAGE_ATTACHMENTS_SQL).digest('hex')
}
