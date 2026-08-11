import { strToU8, zipSync } from "fflate";

import { AppError, errorResponse } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

// ノートのMarkdown一括エクスポート（Issue #38）。
// ごみ箱を除く全ノートを「1ノート=1 .mdファイル（frontmatter付き）」のZIPで返す。
// 認可: セッション必須＋RLS越し取得（自分のノートのみ）

type NoteRow = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
  note_tags: { tags: { name: string; kind: string } | null }[];
};

/** ファイル名に使えない文字を除去し、長すぎるタイトルを丸める */
function toFileBaseName(title: string): string {
  const cleaned = title
    .replaceAll(/[/\\:*?"<>|]/g, "")
    .replaceAll(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 50);
  return cleaned || "無題";
}

/** YAML frontmatter の値として安全な形にする（JSON文字列はYAMLとして妥当） */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

function toMarkdown(note: NoteRow): string {
  const tags = note.note_tags.flatMap((nt) =>
    nt.tags ? [`${nt.tags.kind}/${nt.tags.name}`] : [],
  );
  const frontmatter = [
    "---",
    `title: ${yamlString(note.title)}`,
    `tags: [${tags.map(yamlString).join(", ")}]`,
    `created: ${note.created_at}`,
    `updated: ${note.updated_at}`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${note.content}\n`;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new AppError("unauthorized", "ログインが必要です");

    enforceRateLimit(user.id, "notes-export", { perMinute: 5, perDay: 100 });

    // PostgREST の max_rows（1000件）で黙って切り詰められないよう、全件をページング取得する
    const PAGE_SIZE = 1000;
    const rows: NoteRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await supabase
        .from("notes")
        .select(
          "id, title, content, created_at, updated_at, note_tags(tags(name, kind))",
        )
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .order("id") // updated_at 同値でもページ境界が安定するよう副キーを付ける
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new AppError("internal", error.message);
      rows.push(...((data ?? []) as NoteRow[]));
      if (!data || data.length < PAGE_SIZE) break;
    }

    // タイトル重複・空タイトルがあってもZIP内で衝突しないよう、末尾にIDの先頭8桁を付ける
    const files: Record<string, Uint8Array> = {};
    for (const note of rows) {
      const name = `${toFileBaseName(note.title)}-${note.id.slice(0, 8)}.md`;
      files[name] = strToU8(toMarkdown(note));
    }

    const zipped = zipSync(files, { level: 6 });
    const date = new Date().toISOString().slice(0, 10);
    return new Response(new Uint8Array(zipped), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="nekonote-notes-${date}.zip"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
