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
import { nanoid } from 'nanoid'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputFooter,
  PromptInputTextarea,
  type PromptInputMessage,
} from '@/components/ai-elements/prompt-input'

import { getSubmittableInputText } from '../../lib'
import {
  extractFileText,
  FileTextExtractionError,
  MAX_TOTAL_EXTRACTED_FILE_CHARACTERS,
} from '../../lib/input/file-text-extractor'
import type {
  ModelOption,
  GroupOption,
  ParameterEnabled,
  PlaygroundConfig,
  PlaygroundAttachment,
} from '../../types'
import { PlaygroundInputControls } from './playground-input-controls'
import { PlaygroundInputTools } from './playground-input-tools'

interface PlaygroundInputProps {
  config: PlaygroundConfig
  onSubmit: (text: string, attachments?: PlaygroundAttachment[]) => void
  onStop?: () => void
  disabled?: boolean
  isGenerating?: boolean
  models: ModelOption[]
  modelValue: string
  onModelChange: (value: string) => void
  isModelLoading?: boolean
  groups: GroupOption[]
  groupValue: string
  onGroupChange: (value: string) => void
  hasMessages?: boolean
  onConfigChange: <K extends keyof PlaygroundConfig>(
    key: K,
    value: PlaygroundConfig[K]
  ) => void
  onClearMessages?: () => void
  onParameterEnabledChange: (
    key: keyof ParameterEnabled,
    value: boolean
  ) => void
  parameterEnabled: ParameterEnabled
}

const MAX_ATTACHMENT_FILES = 4
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024

async function toPlaygroundAttachment(
  file: FileUIPart,
  sendFileAsBase64: boolean
): Promise<PlaygroundAttachment> {
  const filename = file.filename || 'attachment'
  const mediaType = file.mediaType || 'application/octet-stream'

  if (mediaType.startsWith('image/')) {
    return {
      id: nanoid(),
      type: 'image',
      filename,
      mediaType,
      dataUrl: file.url,
    }
  }

  if (sendFileAsBase64) {
    return {
      id: nanoid(),
      type: 'file',
      filename,
      mediaType,
      contentMode: 'base64',
      dataUrl: file.url,
    }
  }

  return {
    id: nanoid(),
    type: 'file',
    filename,
    mediaType,
    contentMode: 'text',
    text: await extractFileText(file),
  }
}

export function PlaygroundInput({
  config,
  onSubmit,
  onStop,
  disabled,
  isGenerating,
  models,
  modelValue,
  onModelChange,
  isModelLoading = false,
  groups,
  groupValue,
  onGroupChange,
  hasMessages = false,
  onConfigChange,
  onClearMessages,
  onParameterEnabledChange,
  parameterEnabled,
}: PlaygroundInputProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [isExtractingFiles, setIsExtractingFiles] = useState(false)

  const handleSubmit = async (message: PromptInputMessage) => {
    const submittableText = getSubmittableInputText(message, disabled)

    if (submittableText === null || isExtractingFiles) return

    setIsExtractingFiles(true)
    try {
      const attachments = await Promise.all(
        (message.files ?? []).map((file) =>
          toPlaygroundAttachment(file, config.sendFileAsBase64)
        )
      )
      const totalFileCharacters = attachments.reduce(
        (total, attachment) =>
          total +
          (attachment.type === 'file' && attachment.contentMode === 'text'
            ? attachment.text.length
            : 0),
        0
      )

      if (totalFileCharacters > MAX_TOTAL_EXTRACTED_FILE_CHARACTERS) {
        toast.error(
          t(
            'The total extracted file text is too long. Please upload fewer or smaller files.'
          )
        )
        throw new Error('Total extracted file text is too long')
      }

      onSubmit(submittableText, attachments)
      setText('')
    } catch (error) {
      if (error instanceof FileTextExtractionError) {
        if (error.code === 'unsupported') {
          toast.error(
            t('Unsupported file type: {{name}}', { name: error.filename })
          )
        } else if (error.code === 'empty') {
          toast.error(
            t('No readable text was found in {{name}}', {
              name: error.filename,
            })
          )
        } else if (error.code === 'too_long') {
          toast.error(
            t(
              'The extracted text from {{name}} is too long. Please split the file.',
              { name: error.filename }
            )
          )
        } else {
          toast.error(
            t('Failed to extract text from {{name}}', { name: error.filename })
          )
        }
      }
      throw error
    } finally {
      setIsExtractingFiles(false)
    }
  }

  return (
    <div className='grid shrink-0 gap-4 px-1 md:pb-4'>
      <PromptInput
        className='relative'
        groupClassName='bg-background/95 dark:bg-background/80 border-border/70 shadow-[0_18px_60px_-32px_rgba(0,0,0,0.65)] ring-1 ring-foreground/5 rounded-xl overflow-hidden transition-all duration-200 focus-within:border-primary/45 focus-within:ring-primary/15 focus-within:shadow-[0_22px_70px_-34px_rgba(0,0,0,0.75)]'
        maxFiles={MAX_ATTACHMENT_FILES}
        maxFileSize={MAX_ATTACHMENT_SIZE_BYTES}
        multiple
        onError={(error) => toast.error(error.message)}
        onSubmit={handleSubmit}
      >
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>
        <PromptInputTextarea
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck={false}
          className='min-h-20 px-5 pt-4 pb-3 leading-7 md:min-h-24 md:text-base'
          disabled={disabled || isExtractingFiles}
          onChange={(event) => setText(event.target.value)}
          placeholder={t('Ask anything')}
          value={text}
        />

        <PromptInputFooter className='border-border/60 bg-muted/20 dark:bg-muted/10 border-t px-3 py-2.5 backdrop-blur'>
          <PlaygroundInputControls
            disabled={disabled || isExtractingFiles}
            groups={groups}
            groupValue={groupValue}
            isGenerating={isGenerating}
            isModelLoading={isModelLoading}
            models={models}
            modelValue={modelValue}
            onGroupChange={onGroupChange}
            onModelChange={onModelChange}
            onStop={onStop}
            text={text}
            tools={
              <PlaygroundInputTools
                config={config}
                disabled={disabled || isExtractingFiles}
                hasMessages={hasMessages}
                onConfigChange={onConfigChange}
                onClearMessages={onClearMessages}
                onParameterEnabledChange={onParameterEnabledChange}
                parameterEnabled={parameterEnabled}
              />
            }
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
