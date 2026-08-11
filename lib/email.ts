import { Resend } from "resend";

const DEFAULT_FROM = "ネコノテAI <onboarding@resend.dev>";

let client: Resend | null = null;

function resend(): Resend {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

export type MilestoneReminderItem = {
  projectTitle: string;
  label: string;
  /** YYYY-MM-DD */
  dueDate: string;
  daysUntil: number;
};

/** マイルストーン締切リマインドメールを送信する（Issue #51） */
export async function sendMilestoneReminderEmail(
  to: string,
  items: MilestoneReminderItem[],
): Promise<void> {
  const lines = items.map(
    (item) =>
      `・${item.projectTitle} / ${item.label}（${item.dueDate}・あと${item.daysUntil}日）`,
  );
  const { error } = await resend().emails.send({
    from: process.env.REMINDER_FROM_EMAIL || DEFAULT_FROM,
    to,
    subject: "【ネコノテAI】マイルストーン締切が近づいています",
    text: `以下のマイルストーンの締切が近づいています。\n\n${lines.join("\n")}\n\nダッシュボードで詳細を確認してください。`,
  });
  if (error) {
    throw new Error(`メール送信に失敗しました: ${error.message}`);
  }
}
