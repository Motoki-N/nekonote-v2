"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/** 挿絵テンプレートの種別（親SPEC §4.6。テーマCSSのクラスに対応） */
export type IllustKind = "inline" | "full";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp|gif)$/i;

/**
 * 画像アップロードの確認ダイアログ（SPEC-vertical-editor-phase3 §6）。
 * 種別（本文中カット／全面挿絵）とキャプションを決めて images/ へ即コミットする。
 * ダイアログは検証と入力のみを担い、アップロードと記法挿入は親の責務
 */
export function ImageUploadDialog({
  file,
  uploading,
  onConfirm,
  onCancel,
}: {
  /** アップロード対象（null なら非表示） */
  file: File | null;
  uploading: boolean;
  onConfirm: (params: { kind: IllustKind; caption: string }) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<IllustKind>("inline");
  const [caption, setCaption] = useState("");

  const sizeError = file !== null && file.size > MAX_IMAGE_BYTES;
  const extError = file !== null && !ALLOWED_EXTENSIONS.test(file.name);
  const error = sizeError
    ? "画像が大きすぎます（上限10MB）"
    : extError
      ? "対応していない形式です（png / jpg / jpeg / webp / gif のみ）"
      : null;

  return (
    <Dialog
      open={file !== null}
      onOpenChange={(open) => {
        if (!open && !uploading) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>画像を挿入</DialogTitle>
          <DialogDescription>
            images/ へのコミットと、カーソル位置への挿入記法の追記を行います
          </DialogDescription>
        </DialogHeader>
        {file !== null && (
          <div className="flex flex-col gap-3">
            <p className="min-w-0 break-all text-sm text-foreground">
              {file.name}
              <span className="ml-2 text-xs text-muted-foreground">
                {(file.size / 1024 / 1024).toFixed(2)}MB
              </span>
            </p>
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1 text-sm text-foreground">
                    挿絵の種別
                  </legend>
                  {(
                    [
                      {
                        value: "inline",
                        label: "本文中カット",
                        hint: "版面内に収まる小さめの画像＋任意のキャプション",
                      },
                      {
                        value: "full",
                        label: "全面挿絵",
                        hint: "改ページして単独ページに全面配置（塗り足し込み）",
                      },
                    ] as const
                  ).map((option) => (
                    <label
                      key={option.value}
                      className="flex cursor-pointer items-start gap-2 rounded-md border border-border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
                    >
                      <input
                        type="radio"
                        name="illust-kind"
                        value={option.value}
                        checked={kind === option.value}
                        onChange={() => setKind(option.value)}
                        className="mt-0.5 accent-[var(--primary)]"
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-foreground">{option.label}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {kind === "inline" && (
                  <label className="flex flex-col gap-1 text-sm">
                    キャプション（任意）
                    <Input
                      value={caption}
                      onChange={(event) => setCaption(event.target.value)}
                      placeholder="発光石の意匠"
                    />
                  </label>
                )}
              </>
            )}
          </div>
        )}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={uploading}
            onClick={onCancel}
          >
            キャンセル
          </Button>
          <Button
            type="button"
            disabled={uploading || error !== null}
            onClick={() => onConfirm({ kind, caption: caption.trim() })}
          >
            {uploading && (
              <Loader2 data-icon="inline-start" className="animate-spin" />
            )}
            コミットして挿入
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
