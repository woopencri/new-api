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

import { extractFileText, FileTextExtractionError } from './file-text-extractor'

describe('playground file text extraction', () => {
  test('decodes UTF-8 text data URLs', async () => {
    const text = await extractFileText({
      type: 'file',
      filename: 'notes.txt',
      mediaType: 'text/plain',
      url: 'data:text/plain;base64,aGVsbG8gd29ybGQ=',
    })

    assert.equal(text, 'hello world')
  })

  test('decodes UTF-16 little-endian text with a BOM', async () => {
    const text = await extractFileText({
      type: 'file',
      filename: 'notes.txt',
      mediaType: 'text/plain',
      url: 'data:text/plain;base64,//5oAGkA',
    })

    assert.equal(text, 'hi')
  })

  test('rejects unsupported binary files', async () => {
    await assert.rejects(
      extractFileText({
        type: 'file',
        filename: 'archive.zip',
        mediaType: 'application/zip',
        url: 'data:application/zip;base64,UEs=',
      }),
      (error: unknown) =>
        error instanceof FileTextExtractionError && error.code === 'unsupported'
    )
  })

  test('rejects text files without readable content', async () => {
    await assert.rejects(
      extractFileText({
        type: 'file',
        filename: 'empty.txt',
        mediaType: 'text/plain',
        url: 'data:text/plain;base64,',
      }),
      (error: unknown) =>
        error instanceof FileTextExtractionError && error.code === 'empty'
    )
  })
})
