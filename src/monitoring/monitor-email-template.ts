/**
 * HTML layout shared by every status monitor email (alerts, daily summary,
 * test). Table-based with inline styles so it renders in Outlook (Word engine)
 * and Gmail, which ignore most of a <style> block; the one <style> block only
 * adds progressive enhancements (phone stacking, link colour).
 */

export type EmailTone = 'healthy' | 'warning' | 'critical' | 'neutral';

export type EmailMetric = { label: string; value: string; tone: EmailTone };

export type EmailItem = {
  name: string;
  tone: EmailTone;
  /** Short explanation, e.g. the check's error detail. */
  detail?: string | null;
  /** Secondary line, e.g. timestamps. */
  note?: string | null;
};

export type EmailSection = {
  title: string;
  tone: EmailTone;
  items: EmailItem[];
};

export type MonitorEmailModel = {
  /** Small label above the title: "Real-time alert", "Daily summary", … */
  kind: string;
  title: string;
  intro?: string | null;
  /** Colour of the banner under the header. */
  tone: EmailTone;
  /** Inbox preview text; hidden in the email itself. */
  preheader: string;
  generatedAt: Date;
  metrics?: EmailMetric[];
  sections: EmailSection[];
  /** Shown instead of the sections when there are none. */
  emptyMessage?: string | null;
  statusUrl: string | null;
  /** Why the reader got this email. */
  footerNote?: string | null;
};

const FONT = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const COLOR = {
  navy: '#0b1f3a',
  navyText: '#c7d4ea',
  accent: '#2563eb',
  accentSoft: '#eff6ff',
  page: '#f1f4f9',
  card: '#ffffff',
  border: '#e2e8f0',
  text: '#0f172a',
  muted: '#64748b',
};

const TONES: Record<
  EmailTone,
  { label: string; fg: string; bg: string; bar: string }
> = {
  healthy: { label: 'Healthy', fg: '#166534', bg: '#dcfce7', bar: '#16a34a' },
  warning: { label: 'Warning', fg: '#92400e', bg: '#fef3c7', bar: '#d97706' },
  critical: { label: 'Critical', fg: '#991b1b', bg: '#fee2e2', bar: '#dc2626' },
  neutral: { label: 'Info', fg: '#334155', bg: '#f1f5f9', bar: '#94a3b8' },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "2026-10-14 11:55 UTC", or a placeholder for a missing or invalid date. */
export function formatUtc(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return 'time unknown';
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** "3 d 4 h", "2 h 5 min", "12 min"; null when not positive. */
export function formatDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours > 0) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  return `${Math.max(1, mins)} min`;
}

function text(value: string | null | undefined): string {
  return escapeHtml((value ?? '').trim());
}

function badge(tone: EmailTone): string {
  const t = TONES[tone];
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background-color:${t.bg};color:${t.fg};font-family:${FONT};font-size:11px;font-weight:600;line-height:16px;letter-spacing:0.2px;white-space:nowrap">${t.label}</span>`;
}

function metricCells(metrics: EmailMetric[]): string {
  const width = Math.floor(100 / metrics.length);
  const cells = metrics
    .map((metric, index) => {
      const t = TONES[metric.tone];
      const gap = index < metrics.length - 1 ? 'padding-right:8px;' : '';
      return `<td class="stack" width="${width}%" valign="top" style="${gap}padding-bottom:8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${COLOR.border};border-top:3px solid ${t.bar};border-radius:6px;background-color:${COLOR.card}">
<tr><td style="padding:10px 12px">
<div style="font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${COLOR.text}">${text(metric.value) || '&ndash;'}</div>
<div style="font-family:${FONT};font-size:12px;line-height:16px;color:${COLOR.muted}">${text(metric.label)}</div>
</td></tr></table></td>`;
    })
    .join('');
  return `<tr><td class="px" style="padding:16px 32px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>
</td></tr>`;
}

function itemRow(item: EmailItem): string {
  const t = TONES[item.tone];
  const detail = text(item.detail);
  const note = text(item.note);
  return `<tr><td style="padding:0 0 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${COLOR.border};border-left:4px solid ${t.bar};border-radius:6px;background-color:${COLOR.card}">
<tr><td style="padding:10px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top" style="font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:${COLOR.text};word-break:break-word">${text(item.name) || 'Unnamed check'}</td>
<td valign="top" align="right" width="80" style="padding-left:8px">${badge(item.tone)}</td>
</tr></table>
${detail ? `<div style="padding-top:4px;font-family:${FONT};font-size:13px;line-height:19px;color:#334155;word-break:break-word">${detail}</div>` : ''}
${note ? `<div style="padding-top:4px;font-family:${FONT};font-size:12px;line-height:17px;color:${COLOR.muted}">${note}</div>` : ''}
</td></tr></table>
</td></tr>`;
}

function section(s: EmailSection): string {
  const t = TONES[s.tone];
  return `<tr><td class="px" style="padding:8px 32px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td style="padding:0 0 8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${t.fg}">${text(s.title)} <span style="color:${COLOR.muted};font-weight:600">(${s.items.length})</span></td></tr>
${s.items.map(itemRow).join('')}
</table></td></tr>`;
}

function button(url: string): string {
  const href = escapeHtml(url);
  return `<tr><td class="px" style="padding:16px 32px 8px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" bgcolor="${COLOR.accent}" style="border-radius:6px;background-color:${COLOR.accent}">
<a href="${href}" target="_blank" style="display:inline-block;padding:11px 22px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px">Open the status dashboard &rarr;</a>
</td></tr></table>
<div style="padding-top:8px;font-family:${FONT};font-size:12px;line-height:17px;color:${COLOR.muted};word-break:break-all">Or paste this link into your browser: <a href="${href}" style="color:${COLOR.accent}">${href}</a></div>
</td></tr>`;
}

export function renderMonitorEmail(model: MonitorEmailModel): string {
  const tone = TONES[model.tone];
  const sections = model.sections.filter((s) => s.items.length > 0);
  const body =
    sections.length > 0
      ? sections.map(section).join('')
      : model.emptyMessage
        ? `<tr><td class="px" style="padding:8px 32px"><div style="padding:14px 16px;border-radius:6px;background-color:${COLOR.accentSoft};font-family:${FONT};font-size:14px;line-height:20px;color:#1e3a8a">${text(model.emptyMessage)}</div></td></tr>`
        : '';
  const cta = model.statusUrl
    ? button(model.statusUrl)
    : `<tr><td class="px" style="padding:16px 32px 8px;font-family:${FONT};font-size:13px;line-height:19px;color:${COLOR.muted}">Open the <strong>Status</strong> page in Runtime Config administration for details.</td></tr>`;
  const footerNote = text(model.footerNote);

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${text(model.title)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
@media only screen and (max-width:620px){
.container{width:100% !important}
.px{padding-left:20px !important;padding-right:20px !important}
.stack{display:block !important;width:100% !important;padding-right:0 !important}
}
a{color:${COLOR.accent}}
</style>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${COLOR.page}">${text(model.preheader)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLOR.page}" style="background-color:${COLOR.page}">
<tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;border-collapse:separate;background-color:${COLOR.card};border:1px solid ${COLOR.border};border-radius:8px">
<tr><td bgcolor="${COLOR.navy}" class="px" style="padding:18px 32px;background-color:${COLOR.navy};border-radius:8px 8px 0 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${FONT};font-size:16px;line-height:22px;font-weight:800;color:#ffffff;letter-spacing:0.2px">GeoHub <span style="font-weight:500;color:${COLOR.navyText}">Status monitor</span></td>
<td align="right" style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:500;color:${COLOR.navyText};text-transform:uppercase;letter-spacing:0.6px">${text(model.kind)}</td>
</tr></table>
</td></tr>
<tr><td height="4" bgcolor="${tone.bar}" style="height:4px;line-height:4px;font-size:4px;background-color:${tone.bar}">&nbsp;</td></tr>
<tr><td class="px" style="padding:24px 32px 8px">
<div style="padding-bottom:8px">${badge(model.tone)}</div>
<h1 style="margin:0;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:${COLOR.text}">${text(model.title)}</h1>
${model.intro ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:21px;color:#334155">${text(model.intro)}</p>` : ''}
<p style="margin:8px 0 0;font-family:${FONT};font-size:12px;line-height:17px;color:${COLOR.muted}">Generated ${escapeHtml(formatUtc(model.generatedAt))}</p>
</td></tr>
${model.metrics?.length ? metricCells(model.metrics) : ''}
${body}
${cta}
<tr><td class="px" style="padding:24px 32px;border-top:1px solid ${COLOR.border}">
<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${COLOR.muted}">Sent automatically by the GeoHub status monitor.${footerNote ? ` ${footerNote}` : ''}</p>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
