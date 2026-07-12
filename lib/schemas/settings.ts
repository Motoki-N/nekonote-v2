import { z } from 'zod'
import { aiCapabilities, aiProviders } from './enums'

// 能力レベル → 実モデルのマッピング（1ユーザーにつき capability ごとに1行）
export const aiModelSettingInputSchema = z.object({
  capability: z.enum(aiCapabilities),
  provider: z.enum(aiProviders),
  model_id: z.string().min(1, 'モデルIDを入力してください'),
})
export const aiModelSettingUpdateSchema = aiModelSettingInputSchema.partial()

export type AiModelSettingInput = z.infer<typeof aiModelSettingInputSchema>
export type AiModelSettingUpdate = z.infer<typeof aiModelSettingUpdateSchema>

// 端末間で同期すべきUI状態（1ユーザー1行、user_id が PK）
export const userSettingsInputSchema = z.object({
  selected_project_id: z.uuid().nullish(),
})

export type UserSettingsInput = z.infer<typeof userSettingsInputSchema>
