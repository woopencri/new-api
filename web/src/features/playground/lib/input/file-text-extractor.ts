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
import type { FileUIPart } from 'ai'

export const MAX_EXTRACTED_FILE_CHARACTERS = 200_000
export const MAX_TOTAL_EXTRACTED_FILE_CHARACTERS = 400_000

const PDF_MIME_TYPE = 'application/pdf'
const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TEXT_MIME_TYPES = new Set([
  'application/graphql',
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/sql',
  'application/toml',
  'application/xml',
  'application/x-httpd-php',
  'application/x-javascript',
  'application/x-ndjson',
  'application/x-sh',
  'application/x-yaml',
])
const TEXT_FILE_EXTENSIONS = new Set([
  'bash',
  'c',
  'conf',
  'cpp',
  'cs',
  'css',
  'csv',
  'env',
  'go',
  'gql',
  'graphql',
  'h',
  'hpp',
  'htm',
  'html',
  'ini',
  'java',
  'js',
  'json',
  'jsonl',
  'jsx',
  'kt',
  'kts',
  'log',
  'markdown',
  'md',
  'mjs',
  'php',
  'properties',
  'ps1',
  'py',
  'rb',
  'rs',
  'sh',
  'sql',
  'svelte',
  'swift',
  'toml',
  'ts',
  'tsv',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
])

export const PLAYGROUND_TEXT_FILE_ACCEPT = [
  '.pdf',
  '.docx',
  ...Array.from(TEXT_FILE_EXTENSIONS, (extension) => `.${extension}`),
].join(',')

export type FileTextExtractionErrorCode =
  | 'empty'
  | 'parse_failed'
  | 'too_long'
  | 'unsupported'

export class FileTextExtractionError extends Error {
  constructor(
    public readonly code: FileTextExtractionErrorCode,
    public readonly filename: string
  ) {
    super(code)
    this.name = 'FileTextExtractionError'
  }
}

function getFileExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

async function readFileBytes(file: FileUIPart): Promise<Uint8Array> {
  const response = await fetch(file.url)
  if (!response.ok) {
    throw new Error('Unable to read attachment data')
  }
  return new Uint8Array(await response.arrayBuffer())
}

function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('gb18030').decode(bytes)
  }
}

function normalizeExtractedText(text: string): string {
  return text
    .replaceAll('\u0000', '')
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
    .trim()
}

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()

  const loadingTask = pdfjs.getDocument({ data: bytes })
  const document = await loadingTask.promise
  const pages: string[] = []

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      let pageText = ''

      for (const item of content.items) {
        if (!('str' in item)) continue
        pageText += item.str
        pageText += item.hasEOL ? '\n' : ' '
      }

      pages.push(pageText.trim())
    }
  } finally {
    await loadingTask.destroy()
  }

  return pages.filter(Boolean).join('\n\n')
}

async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  const result = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

export async function extractFileText(file: FileUIPart): Promise<string> {
  const filename = file.filename || 'attachment'
  const extension = getFileExtension(filename)
  const mediaType = file.mediaType.toLowerCase()
  const isPdf = mediaType === PDF_MIME_TYPE || extension === 'pdf'
  const isDocx = mediaType === DOCX_MIME_TYPE || extension === 'docx'
  const isText =
    mediaType.startsWith('text/') ||
    TEXT_MIME_TYPES.has(mediaType) ||
    TEXT_FILE_EXTENSIONS.has(extension)

  if (!isPdf && !isDocx && !isText) {
    throw new FileTextExtractionError('unsupported', filename)
  }

  try {
    const bytes = await readFileBytes(file)
    let rawText: string

    if (isPdf) {
      rawText = await extractPdfText(bytes)
    } else if (isDocx) {
      rawText = await extractDocxText(bytes)
    } else {
      rawText = decodeText(bytes)
    }

    const extractedText = normalizeExtractedText(rawText)

    if (!extractedText) {
      throw new FileTextExtractionError('empty', filename)
    }
    if (extractedText.length > MAX_EXTRACTED_FILE_CHARACTERS) {
      throw new FileTextExtractionError('too_long', filename)
    }

    return extractedText
  } catch (error) {
    if (error instanceof FileTextExtractionError) throw error
    throw new FileTextExtractionError('parse_failed', filename)
  }
}
