import 'server-only'

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { AppError } from '@/lib/errors'

// AES-256-GCM（SPEC-proofreading §5）。鍵は ENCRYPTION_KEY（32バイト・base64）で server-only。
// 暗号文は iv(12) + authTag(16) + ciphertext を連結して base64 で持ち回る
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new AppError('internal', '環境変数 ENCRYPTION_KEY が未設定です')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new AppError('internal', 'ENCRYPTION_KEY は32バイトの base64 である必要があります')
  }
  return key
}

/** 平文を暗号化して base64 文字列で返す */
export function encrypt(plain: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64')
}

/**
 * 暗号文（encrypt の出力形式）を復号する。
 * 不正な暗号文・authTag 不整合は詳細を漏らさず AppError に正規化する
 */
export function decrypt(ciphertext: string): string {
  try {
    const buffer = Buffer.from(ciphertext, 'base64')
    if (buffer.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
      throw new Error('ciphertext too short')
    }
    const iv = buffer.subarray(0, IV_LENGTH)
    const authTag = buffer.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
    const encrypted = buffer.subarray(IV_LENGTH + AUTH_TAG_LENGTH)
    const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
    decipher.setAuthTag(authTag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch (error) {
    if (error instanceof AppError) throw error
    // 原因詳細（暗号文断片・スタック）はクライアントへ出さない。
    // internal はクライアントで固定文言に置換されるため、案内文が届く validation を使う
    throw new AppError('validation', '保存されたトークンの復号に失敗しました。設定から登録し直してください')
  }
}
