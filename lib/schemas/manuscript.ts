import { z } from 'zod'
import { suggestionGranularities, suggestionStatuses } from './enums'

export const manuscriptLinkInputSchema = z.object({
  project_id: z.uuid(),
  file_path: z.string().min(1, 'ファイルパスを入力してください'),
  last_reviewed_commit: z.string().nullish(),
})
export const manuscriptLinkUpdateSchema = manuscriptLinkInputSchema
  .partial()
  .omit({ project_id: true })

export type ManuscriptLinkInput = z.infer<typeof manuscriptLinkInputSchema>
export type ManuscriptLinkUpdate = z.infer<typeof manuscriptLinkUpdateSchema>

export const revisionSuggestionInputSchema = z.object({
  manuscript_link_id: z.uuid(),
  granularity: z.enum(suggestionGranularities),
  original_text: z.string().default(''),
  suggested_text: z.string().default(''),
  reason: z.string().nullish(),
  status: z.enum(suggestionStatuses).default('pending'),
  committed_sha: z.string().nullish(),
})
export const revisionSuggestionUpdateSchema = revisionSuggestionInputSchema
  .partial()
  .omit({ manuscript_link_id: true })

export type RevisionSuggestionInput = z.infer<typeof revisionSuggestionInputSchema>
export type RevisionSuggestionUpdate = z.infer<typeof revisionSuggestionUpdateSchema>

export const writingProgressInputSchema = z.object({
  project_id: z.uuid(),
  date: z.iso.date(),
  total_chars: z.number().int().min(0).default(0),
})
export const writingProgressUpdateSchema = writingProgressInputSchema
  .partial()
  .omit({ project_id: true })

export type WritingProgressInput = z.infer<typeof writingProgressInputSchema>
export type WritingProgressUpdate = z.infer<typeof writingProgressUpdateSchema>
