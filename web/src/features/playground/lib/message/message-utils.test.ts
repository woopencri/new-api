/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import type { Message } from '../../types'
import { formatMessageForAPI } from './message-utils'

describe('playground attachment payloads', () => {
  test('formats images and files as chat completion content parts', () => {
    const message: Message = {
      key: 'message-1',
      from: 'user',
      versions: [{ id: 'version-1', content: 'Inspect these attachments' }],
      attachments: [
        {
          id: 'image-1',
          type: 'image',
          filename: 'photo.png',
          mediaType: 'image/png',
          dataUrl: 'data:image/png;base64,aW1hZ2U=',
        },
        {
          id: 'file-1',
          type: 'file',
          filename: 'notes.txt',
          mediaType: 'text/plain',
          contentMode: 'text',
          text: 'hello',
        },
      ],
    }

    assert.deepEqual(formatMessageForAPI(message), {
      role: 'user',
      content: [
        { type: 'text', text: 'Inspect these attachments' },
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,aW1hZ2U=' },
        },
        {
          type: 'text',
          text: 'notes.txt\nhello',
        },
      ],
    })
  })

  test('does not add an empty text part to attachment-only messages', () => {
    const message: Message = {
      key: 'message-1',
      from: 'user',
      versions: [{ id: 'version-1', content: '' }],
      attachments: [
        {
          id: 'file-1',
          type: 'file',
          filename: 'notes.txt',
          mediaType: 'text/plain',
          contentMode: 'text',
          text: 'hello',
        },
      ],
    }

    assert.deepEqual(formatMessageForAPI(message), {
      role: 'user',
      content: [{ type: 'text', text: 'notes.txt\nhello' }],
    })
  })

  test('formats Base64 files as OpenAI file content parts', () => {
    const message: Message = {
      key: 'message-1',
      from: 'user',
      versions: [{ id: 'version-1', content: 'Summarize this file' }],
      attachments: [
        {
          id: 'file-1',
          type: 'file',
          filename: 'report.pdf',
          mediaType: 'application/pdf',
          contentMode: 'base64',
          dataUrl: 'data:application/pdf;base64,JVBERi0=',
        },
      ],
    }

    assert.deepEqual(formatMessageForAPI(message), {
      role: 'user',
      content: [
        { type: 'text', text: 'Summarize this file' },
        {
          type: 'file',
          file: {
            filename: 'report.pdf',
            file_data: 'data:application/pdf;base64,JVBERi0=',
          },
        },
      ],
    })
  })

  test('keeps text-only messages in the compact string format', () => {
    const message: Message = {
      key: 'message-1',
      from: 'user',
      versions: [{ id: 'version-1', content: 'Hello' }],
    }

    assert.deepEqual(formatMessageForAPI(message), {
      role: 'user',
      content: 'Hello',
    })
  })
})
