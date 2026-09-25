/**
 * The two emails a cancellation produces.
 *
 * Both say the three things the customer needs and nothing else: the
 * date, what they keep until then, and the one link that changes their
 * mind. Sent in the customer's own language (`users.locale`).
 *
 * Kept as plain functions returning an `EmailMessage` so they can be
 * previewed and tested without a provider.
 */

import type { EmailMessage } from './email';

type Locale = 'en' | 'ar';

interface Recipient {
  email: string;
  name: string | null;
  locale: Locale | string;
}

/** Tier names as the product shows them. */
const TIER_NAMES: Record<Locale, Record<string, string>> = {
  en: { basic: 'Basic', creator: 'Creator', pro: 'Pro', ultimate: 'Ultimate' },
  ar: { basic: 'الأساسية', creator: 'المبدع', pro: 'الاحترافية', ultimate: 'المطلقة' },
};

function pick(locale: string): Locale {
  return locale === 'ar' ? 'ar' : 'en';
}

function tierName(locale: Locale, tier: string): string {
  return TIER_NAMES[locale][tier] ?? tier;
}

function fmtDate(locale: Locale, d: Date): string {
  return d.toLocaleDateString(locale === 'ar' ? 'ar-EG' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
}

/** One layout for both, so they read as the same sender. */
function layout(locale: Locale, title: string, paragraphs: string[], cta: { href: string; label: string }): string {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.55">${p}</p>`).join('');
  return `<!doctype html><html dir="${dir}" lang="${locale}"><body style="margin:0;background:#0b0b0c;color:#e8e8ea;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#141416;border-radius:16px;padding:28px;text-align:${locale === 'ar' ? 'right' : 'left'}">
<tr><td>
<h1 style="margin:0 0 18px;font-size:20px;font-weight:600">${title}</h1>
${body}
<p style="margin:22px 0 0"><a href="${cta.href}" style="display:inline-block;background:#3ddc84;color:#0b0b0c;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:999px">${cta.label}</a></p>
<p style="margin:26px 0 0;font-size:12px;color:#8a8a90">Clickefy · <a href="https://clickefy.ai/contact" style="color:#8a8a90">clickefy.ai/contact</a></p>
</td></tr></table></td></tr></table></body></html>`;
}

export function planEndingEmail(input: {
  to: Recipient;
  tier: string;
  endsAt: Date;
  billingUrl: string;
}): EmailMessage {
  const locale = pick(input.to.locale);
  const plan = tierName(locale, input.tier);
  const date = fmtDate(locale, input.endsAt);
  const name = input.to.name ? escape(input.to.name) : null;

  if (locale === 'ar') {
    const title = `تم إلغاء خطة ${plan}`;
    const paras = [
      name ? `مرحباً ${name}،` : 'مرحباً،',
      `تلقّينا طلب إلغاء خطة ${plan}. ستبقى خطتك ورصيدك من النقاط متاحين حتى <strong>${date}</strong>، ولن يتم خصم أي مبلغ بعد ذلك.`,
      'نقاط الترحيب المجانية تبقى لك دائماً، وأي حزمة نقاط اشتريتها تُحفظ لحين عودتك.',
      'إذا كان الإلغاء عن طريق الخطأ، يمكنك استئناف الخطة بضغطة واحدة قبل ذلك التاريخ.',
    ];
    return {
      to: input.to.email,
      subject: `تم إلغاء خطة ${plan} — تبقى فعّالة حتى ${date}`,
      html: layout(locale, title, paras, { href: input.billingUrl, label: 'استئناف الخطة' }),
      text: `${paras.map((p) => p.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${input.billingUrl}`,
    };
  }

  const title = `Your ${plan} plan is set to end`;
  const paras = [
    name ? `Hi ${name},` : 'Hi,',
    `We've received the request to cancel your ${plan} plan. You keep your plan and every credit you have until <strong>${date}</strong>, and you will not be charged again after that.`,
    'Your free welcome credits stay with you, and any credit packs you bought are kept safely for whenever you come back.',
    'If this was a mistake, you can resume the plan with one click any time before that date.',
  ];
  return {
    to: input.to.email,
    subject: `Your ${plan} plan ends on ${date}`,
    html: layout(locale, title, paras, { href: input.billingUrl, label: 'Resume my plan' }),
    text: `${paras.map((p) => p.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${input.billingUrl}`,
  };
}

export function planResumedEmail(input: {
  to: Recipient;
  tier: string;
  renewsAt: Date | null;
  billingUrl: string;
}): EmailMessage {
  const locale = pick(input.to.locale);
  const plan = tierName(locale, input.tier);
  const date = input.renewsAt ? fmtDate(locale, input.renewsAt) : null;
  const name = input.to.name ? escape(input.to.name) : null;

  if (locale === 'ar') {
    const title = `خطة ${plan} فعّالة من جديد`;
    const paras = [
      name ? `مرحباً ${name}،` : 'مرحباً،',
      date
        ? `تم استئناف خطة ${plan}. ستتجدد تلقائياً في <strong>${date}</strong> كالمعتاد.`
        : `تم استئناف خطة ${plan} وستتجدد تلقائياً كالمعتاد.`,
    ];
    return {
      to: input.to.email,
      subject: `تم استئناف خطة ${plan}`,
      html: layout(locale, title, paras, { href: input.billingUrl, label: 'عرض الفوترة' }),
      text: `${paras.map((p) => p.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${input.billingUrl}`,
    };
  }

  const title = `Your ${plan} plan is active again`;
  const paras = [
    name ? `Hi ${name},` : 'Hi,',
    date
      ? `Your ${plan} plan has been resumed. It will renew as usual on <strong>${date}</strong>.`
      : `Your ${plan} plan has been resumed and will renew as usual.`,
  ];
  return {
    to: input.to.email,
    subject: `Your ${plan} plan has been resumed`,
    html: layout(locale, title, paras, { href: input.billingUrl, label: 'View billing' }),
    text: `${paras.map((p) => p.replace(/<[^>]+>/g, '')).join('\n\n')}\n\n${input.billingUrl}`,
  };
}
