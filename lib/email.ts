import { Resend } from "resend";

let client: Resend | null = null;

function getResend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY is not set");
    }
    client = new Resend(apiKey);
  }
  return client;
}

export async function sendReminderEmail(params: {
  to: string;
  memberName: string;
  daysSinceLastLog: number | null;
}): Promise<void> {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error("EMAIL_FROM is not set");
  }
  const resend = getResend();

  const subject = "【成長トラッカー】実践ログを記録しましょう";
  const body =
    params.daysSinceLastLog === null
      ? `${params.memberName}さん\n\nまだ実践ログが記録されていません。成長トラッカーを開いて、最近試したこと・その効果を記録してみましょう。`
      : `${params.memberName}さん\n\n実践ログの記録から${params.daysSinceLastLog}日が経ちました。成長トラッカーを開いて、最近試したこと・その効果を記録してみましょう。`;

  await resend.emails.send({
    from,
    to: params.to,
    subject,
    text: body,
  });
}
