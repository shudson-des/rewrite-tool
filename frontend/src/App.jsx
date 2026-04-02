import { useState, useRef } from 'react';
import { Button, Tag, Typography, theme } from 'antd';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const { Text, Title } = Typography;
const { useToken } = theme;

// --- HTML extraction -----------------------------------------------------------

const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'ol', 'ul', 'tr', 'td', 'th', 'blockquote',
  'section', 'article', 'header', 'footer', 'pre', 'table',
]);

// Boilerplate line patterns — matched per-line, never greedy across content.
// These target generic footer/legal/support junk only.
// CTA lines (View, Upload, Confirm, Schedule, etc.) are intentionally preserved.
const BOILERPLATE_LINE_PATTERNS = [
  // Confidentiality / legal
  /^this (message|email|communication) (is |may be |contains )?confidential/i,
  /^if you (are not|received this|have received).{0,80}(intended|error|mistake)/i,
  /^do not (forward|share|distribute|copy) this (email|message)/i,
  /^privileged.{0,60}confidential/i,

  // Unsubscribe / preferences
  /^(to )?unsubscribe/i,
  /^(manage |update )?(your )?(email )?(preferences|subscriptions)/i,
  /^you('re| are) receiving this (email|message|notification)/i,
  /^this email was sent (to|because)/i,
  /^(click here to )?unsubscribe/i,

  // Copyright / legal footer
  /^©\s*\d{4}/,
  /^copyright\s*©?\s*\d{4}/i,
  /^all rights reserved/i,

  // Privacy / terms
  /^privacy policy/i,
  /^terms (of (use|service))?/i,
  /^view (in browser|this email in)/i,

  // Generic support footer
  /^(need help\?|questions\?|contact (us|support))\s*$/i,
  /^(visit (our )?help center|help\.snapdocs\.com|support@)/i,
  /^\+?1[-.\s]?\(?\d{3}\)?.{0,20}\d{4}\s*$/,  // bare phone number line

  // DO NOT FORWARD blocks
  /^do not forward/i,
  /^not for (distribution|forwarding|sharing)/i,
];

function isBoilerplateLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return BOILERPLATE_LINE_PATTERNS.some((p) => p.test(trimmed));
}

function walkNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent.replace(/[ \t]+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const tag = node.tagName.toLowerCase();
  if (tag === 'br') return '\n';
  const inner = Array.from(node.childNodes).map(walkNode).join('');
  return BLOCK_TAGS.has(tag) ? `\n${inner.trim()}\n` : inner;
}

function extractTextFromHTML(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // Remove non-visible elements
  doc.querySelectorAll(
    'style, script, noscript, head, link, meta, [hidden], [aria-hidden="true"]'
  ).forEach((el) => el.remove());

  // Remove inline-hidden elements
  doc.querySelectorAll('[style]').forEach((el) => {
    const s = el.getAttribute('style') || '';
    if (/display\s*:\s*none/i.test(s) || /visibility\s*:\s*hidden/i.test(s)) {
      el.remove();
    }
  });

  let text = walkNode(doc.body ?? doc.documentElement);

  // Normalise whitespace before line filtering
  text = text
    .replace(/[ \t]+/g, ' ')  // collapse inline whitespace
    .replace(/^ +| +$/gm, ''); // trim each line

  // Remove boilerplate lines one at a time — never strips across CTA content
  text = text
    .split('\n')
    .filter((line) => !isBoilerplateLine(line))
    .join('\n');

  return text
    .replace(/\n{3,}/g, '\n\n') // max two consecutive blank lines
    .trim();
}

const ACCEPTED_TYPES = ['.html', '.htm'];

function validateFiles(files) {
  const valid = [];
  const errors = [];
  for (const f of files) {
    const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase();
    if (ACCEPTED_TYPES.includes(ext)) {
      valid.push(f);
    } else {
      errors.push(`"${f.name}" is not a supported file type. Only .html and .htm files are accepted.`);
    }
  }
  return { valid, errors };
}

let nextFileId = 1;

const USER_TYPES = [
  { value: 'borrower', label: 'Borrower', desc: 'Homebuyer completing a mortgage closing' },
  { value: 'lender', label: 'Lender', desc: 'Mortgage lender or loan officer' },
  { value: 'settlement_agent', label: 'Settlement agent', desc: 'Person directly responsible for the closing task' },
  { value: 'settlement_office', label: 'Settlement office', desc: 'Office audience copied for visibility or coordination' },
  { value: 'notary', label: 'Notary', desc: 'Signing agent or notary public' },
  { value: 'support', label: 'Support', desc: 'Internal Snapdocs support user' },
];

function OutputSection({ label, children }) {
  if (!children) return null;
  return (
    <div className="output-section">
      <span className="output-label">{label}</span>
      <div className="output-content">{children}</div>
    </div>
  );
}

function OutputList({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <ol className="output-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

function KeyDetailsTable({ details }) {
  if (!details || details.length === 0) return null;
  return (
    <table className="key-details-table">
      <tbody>
        {details.map((row, i) => (
          <tr key={i}>
            <td className="key-details-label">{row.label}</td>
            <td className="key-details-value">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const EMAIL_TYPE_LABELS = {
  action_required: 'Action required',
  status_update: 'Status update',
  issue_error: 'Issue / error',
  message: 'Message',
};

const EP_CHIP = {
  action_required: { label: 'Action required', color: 'orange' },
  issue_error:     { label: 'Issue',            color: 'red'    },
  message:         { label: 'Message',          color: 'blue'   },
};

// CTA button color override for non-primary types
const EP_CTA_COLOR = {
  action_required: '#d97706',
  issue_error:     '#c0392b',
};

function EpBlock({ title, children, token }) {
  return (
    <div style={{
      border: `1px solid ${token.colorBorderSecondary}`,
      borderRadius: token.borderRadius,
      overflow: 'hidden',
    }}>
      <div style={{
        padding: `${token.paddingXS}px ${token.padding}px`,
        background: token.colorFillAlter,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
      }}>
        <Text style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.07em',
          color: token.colorTextDescription,
        }}>
          {title}
        </Text>
      </div>
      <div style={{ padding: token.padding }}>
        {children}
      </div>
    </div>
  );
}

// Render a body string, styling any line that contains '→' as an inline link.
function renderBodyWithInlineLinks(body, token) {
  if (!body) return null;
  const lines = body.split('\n');
  const result = [];
  lines.forEach((line, i) => {
    if (i > 0) result.push('\n');
    if (line.includes('→')) {
      result.push(
        <span key={i} style={{
          color: token.colorPrimary,
          textDecoration: 'underline',
          cursor: 'default',
          pointerEvents: 'none',
        }}>
          {line}
        </span>
      );
    } else {
      result.push(line);
    }
  });
  return result;
}

function EmailPreview({ data, logoUrl, userType }) {
  const { token } = useToken();
  const chip = EP_CHIP[data.emailType];
  const isPrimary = data.emailType === 'action_required' && !!data.cta;
  const isSecondary = (data.emailType === 'status_update' || data.emailType === 'update') && !!data.cta;
  const isNavigational = data.ctaStyle === 'navigational';
  const ctaColor = EP_CTA_COLOR[data.emailType];
  const isRON = /webcam\s+signing\s+appointment|remote\s+online\s+notary/i.test(
    [data.notes, data.summary, data.headline].filter(Boolean).join(' ')
  );
  const nextStepsTitle = isRON ? 'Before your appointment' : 'Next steps';

  return (
    <div style={{
      background: token.colorBgLayout,
      borderRadius: token.borderRadius,
      padding: token.paddingLG,
    }}>

      {/* Subject — email client UI, outside the body container */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: token.paddingXS,
        paddingBottom: token.paddingSM,
        borderBottom: `1px solid ${token.colorBorderSecondary}`,
        marginBottom: token.padding,
      }}>
        <Text style={{
          flexShrink: 0,
          fontSize: token.fontSizeSM,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: token.colorTextDescription,
        }}>
          Subject
        </Text>
        <Text strong style={{ fontSize: token.fontSize }}>
          {data.subjectLine || '—'}
        </Text>
      </div>

      {/* Email body container */}
      <div style={{
        maxWidth: 600,
        margin: '0 auto',
        background: token.colorBgContainer,
        border: `1px solid ${token.colorBorder}`,
        borderRadius: token.borderRadius,
        overflow: 'hidden',
        lineHeight: token.lineHeight,
      }}>

        {/* Lender logo area */}
        <div style={{
          padding: token.paddingLG,
          minHeight: 64,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: 'flex',
          alignItems: 'center',
        }}>
          {logoUrl ? (
            <img
              src={logoUrl}
              alt="Lender logo"
              style={{ maxHeight: 40, maxWidth: 200, objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <Text style={{
              fontSize: token.fontSizeSM,
              color: token.colorTextDisabled,
              border: `1px dashed ${token.colorBorder}`,
              borderRadius: token.borderRadiusSM,
              padding: '4px 10px',
            }}>
              Lender logo
            </Text>
          )}
        </div>

        {/* Body */}
        <div style={{
          padding: token.paddingLG,
          display: 'flex',
          flexDirection: 'column',
          gap: token.marginMD,
        }}>

          {chip && !isNavigational && (
            <Tag color={chip.color} style={{ alignSelf: 'flex-start', marginBottom: 0 }}>
              {chip.label}
            </Tag>
          )}

          {data.headline && (
            <Title level={4} style={{ margin: 0, color: token.colorText, lineHeight: 1.3 }}>
              {data.headline}
            </Title>
          )}

          {data.summary && (
            <Text style={{
              fontSize: token.fontSize,
              color: token.colorTextSecondary,
              lineHeight: 1.65,
              display: 'block',
              whiteSpace: 'pre-line',
            }}>
              {data.summary}
            </Text>
          )}

          {data.messageText && (
            <EpBlock title="Message" token={token}>
              <Text style={{
                fontSize: token.fontSize,
                color: token.colorText,
                lineHeight: 1.65,
                whiteSpace: 'pre-wrap',
                display: 'block',
                borderLeft: `3px solid ${token.colorBorderSecondary}`,
                paddingLeft: token.paddingSM,
              }}>
                {data.messageText}
              </Text>
            </EpBlock>
          )}

          {data.nextSteps && data.nextSteps.length > 0 && (
            <EpBlock title={nextStepsTitle} token={token}>
              <ul style={{
                margin: 0,
                paddingLeft: token.paddingLG,
                display: 'flex',
                flexDirection: 'column',
                gap: token.paddingXS,
              }}>
                {data.nextSteps.map((step, i) => (
                  <li key={i} style={{ fontSize: token.fontSize, color: token.colorText, lineHeight: 1.5 }}>
                    {step}
                  </li>
                ))}
              </ul>
              {!isSecondary && !isNavigational && data.cta && (
                <div style={{
                  marginTop: token.padding,
                  paddingTop: token.padding,
                  borderTop: `1px solid ${token.colorFillSecondary}`,
                }}>
                  <Button
                    type="primary"
                    size="large"
                    tabIndex={-1}
                    style={{
                      pointerEvents: 'none',
                      cursor: 'default',
                      ...(ctaColor ? { background: ctaColor, borderColor: ctaColor } : {}),
                    }}
                  >
                    {data.cta}
                  </Button>
                </div>
              )}
            </EpBlock>
          )}

          {data.keyDetails && data.keyDetails.length > 0 && (
            <EpBlock title={data.keyDetailsTitle || 'Details'} token={token}>
              <dl style={{ margin: 0, padding: 0 }}>
                {data.keyDetails.map((row, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    gap: token.paddingXS,
                    padding: `6px 0`,
                    ...(i > 0 ? { borderTop: `1px solid ${token.colorFillSecondary}` } : {}),
                  }}>
                    <dt style={{
                      flexShrink: 0,
                      width: '40%',
                      fontSize: token.fontSizeSM,
                      fontWeight: 600,
                      color: token.colorTextSecondary,
                    }}>
                      {row.label}
                    </dt>
                    <dd style={{ margin: 0, fontSize: token.fontSizeSM, color: token.colorText }}>
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
              {!isSecondary && !isNavigational && data.cta && (!data.nextSteps || data.nextSteps.length === 0) && (
                <div style={{
                  marginTop: token.padding,
                  paddingTop: token.padding,
                  borderTop: `1px solid ${token.colorFillSecondary}`,
                }}>
                  <Button
                    type="primary"
                    size="large"
                    tabIndex={-1}
                    style={{
                      pointerEvents: 'none',
                      cursor: 'default',
                      ...(ctaColor ? { background: ctaColor, borderColor: ctaColor } : {}),
                    }}
                  >
                    {data.cta}
                  </Button>
                </div>
              )}
            </EpBlock>
          )}

          {data.lenderTeam && data.lenderTeam.length > 0 && (
            <EpBlock title="Lender team" token={token}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {groupLenderTeam(data.lenderTeam).map((group, gi) => (
                  <div key={gi} style={{
                    paddingTop: gi > 0 ? 12 : 0,
                    borderTop: gi > 0 ? `1px solid ${token.colorFillSecondary}` : 'none',
                  }}>
                    {group.map((row, i) => (
                      <div key={i} style={{
                        display: 'flex',
                        gap: token.paddingXS,
                        padding: `2px 0`,
                      }}>
                        <span style={{
                          flexShrink: 0,
                          width: '40%',
                          fontSize: token.fontSizeSM,
                          fontWeight: 600,
                          color: token.colorTextSecondary,
                        }}>
                          {row.label}
                        </span>
                        <span style={{ fontSize: token.fontSizeSM, color: token.colorText }}>
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </EpBlock>
          )}

          {data.infoSections && data.infoSections.length > 0 && data.infoSections.map((sec, i) => {
            const isLast = i === data.infoSections.length - 1;
            const showCtaInside = isLast && isSecondary && data.cta;
            return (
              <EpBlock key={i} title={sec.heading} token={token}>
                <span style={{
                  fontSize: token.fontSizeSM,
                  color: token.colorTextSecondary,
                  lineHeight: 1.65,
                  whiteSpace: 'pre-line',
                }}>
                  {renderBodyWithInlineLinks(sec.body, token)}
                  {showCtaInside && (
                    <> <span style={{
                      color: token.colorPrimary,
                      textDecoration: 'underline',
                      cursor: 'default',
                      pointerEvents: 'none',
                    }}>{data.cta}</span></>
                  )}
                </span>
              </EpBlock>
            );
          })}

          {data.contactGuidance && CONTACT_GUIDANCE_TEXT[data.contactGuidance] && (
            <Text style={{
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
              lineHeight: 1.6,
              display: 'block',
            }}>
              {CONTACT_GUIDANCE_TEXT[data.contactGuidance]}
            </Text>
          )}

          {data.replyGuidance && (
            <Text style={{
              fontSize: token.fontSizeSM,
              color: token.colorTextSecondary,
              lineHeight: 1.6,
              display: 'block',
            }}>
              {data.replyGuidance}
            </Text>
          )}

          {data.cta && (
            <div>
              {isNavigational ? (
                // Navigational CTA always renders standalone as an outlined button.
                <Button
                  type="default"
                  size="large"
                  tabIndex={-1}
                  style={{ pointerEvents: 'none', cursor: 'default' }}
                >
                  {data.cta}
                </Button>
              ) : isSecondary ? (
                // Secondary CTA is rendered inside the last infoSection above when present;
                // only render standalone if there are no infoSections.
                (!data.infoSections || data.infoSections.length === 0) && (
                  <span style={{
                    fontSize: token.fontSize,
                    color: token.colorPrimary,
                    textDecoration: 'underline',
                    cursor: 'default',
                    pointerEvents: 'none',
                  }}>
                    {data.cta}
                  </span>
                )
              ) : (
                // Primary CTA renders inside nextSteps (preferred) or keyDetails (fallback).
                // Only render here when neither section is present.
                (!data.nextSteps || data.nextSteps.length === 0) &&
                (!data.keyDetails || data.keyDetails.length === 0) && (
                  <Button
                    type="primary"
                    size="large"
                    tabIndex={-1}
                    style={{
                      pointerEvents: 'none',
                      cursor: 'default',
                      ...(ctaColor ? { background: ctaColor, borderColor: ctaColor } : {}),
                    }}
                  >
                    {data.cta}
                  </Button>
                )
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: `${token.padding}px ${token.paddingLG}px`,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
          textAlign: 'center',
        }}>
          <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
            Powered by Snapdocs
          </Text>
        </div>

      </div>
    </div>
  );
}

// ─── PII anonymization ────────────────────────────────────────────────────────

const ANON_ROLE_LABELS = {
  'borrower':         'Borrower FirstName LastName',
  'lender':           'Lender FirstName LastName',
  'settlement agent': 'Settlement Agent Name',
  'settlement office':'Settlement Office Name',
  'notary':           'Notary Name',
  'from':             'FirstName LastName',
  'to':               'FirstName LastName',
  'name':             'FirstName LastName',
  'agent':            'Agent Name',
};

function anonymizeResult(data) {
  // Build a consistent name → placeholder map from all structured fields.
  const nameMap = new Map(); // real value → placeholder (sorted longest-first on apply)

  for (const row of (data.keyDetails || [])) {
    const label = (row.label || '').toLowerCase().trim();
    const value = (row.value || '').trim();
    if (value && ANON_ROLE_LABELS[label] && !nameMap.has(value)) {
      nameMap.set(value, ANON_ROLE_LABELS[label]);
    }
  }

  // Lender team names
  let lenderIdx = 0;
  for (const row of (data.lenderTeam || [])) {
    if (row.label?.toLowerCase() === 'name' && row.value?.trim() && !nameMap.has(row.value.trim())) {
      nameMap.set(row.value.trim(), lenderIdx === 0 ? 'Lender FirstName LastName' : `Lender Contact ${lenderIdx + 1}`);
      lenderIdx++;
    }
  }

  function redact(text) {
    if (!text || typeof text !== 'string') return text;
    let s = text;

    // Names — apply longest match first to avoid partial clobbering
    const sortedNames = [...nameMap.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [real, placeholder] of sortedNames) {
      s = s.replace(new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), placeholder);
    }

    // Closing IDs (BC + 5+ digits, or similar prefix patterns)
    s = s.replace(/\b([A-Z]{2})\d{5,}\b/g, '$1000000000');

    // Email addresses
    s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, 'name@example.com');

    // Phone numbers (various formats)
    s = s.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, '000-000-0000');

    // Full month-name dates: December 17, 2025
    s = s.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi, 'MM/DD/YYYY');

    // Short dates: 1/30/26 or 01/30/2026
    s = s.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, 'MM/DD/YYYY');

    // Times: 12:00 PM CST / 9:00am
    s = s.replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s+[A-Z]{2,4}T)?\b/gi, '00:00 PM');

    // Street addresses with ZIP
    s = s.replace(/\d+\s+[\w\s.''-]+(?:Street|St|Drive|Dr|Lane|Ln|Avenue|Ave|Boulevard|Blvd|Road|Rd|Way|Court|Ct|Circle|Cir|Place|Pl)\.?[,\s][\w\s,]+\d{5}(?:-\d{4})?/gi, '123 Main Street, City, ST 12345');

    return s;
  }

  function redactRows(rows) {
    return (rows || []).map(row => ({ ...row, value: redact(row.value) }));
  }

  return {
    ...data,
    subjectLine:    redact(data.subjectLine),
    headline:       redact(data.headline),
    summary:        redact(data.summary),
    nextSteps:      data.nextSteps?.map(redact) ?? null,
    keyDetails:     redactRows(data.keyDetails),
    messageText:    data.messageText != null ? redact(data.messageText) : null,
    lenderTeam:     data.lenderTeam ? redactRows(data.lenderTeam) : null,
    replyGuidance:  redact(data.replyGuidance),
    capabilities:   redact(data.capabilities),
    closingInfo:    redact(data.closingInfo),
    timeline:       redact(data.timeline),
    reassurance:    redact(data.reassurance),
    notes:          redact(data.notes),
    infoSections:   data.infoSections ? data.infoSections.map(s => ({ heading: s.heading, body: redact(s.body) })) : null,
    cta:            redact(data.cta),
    rewrittenEmail: redact(data.rewrittenEmail),
  };
}

// Groups a flat lenderTeam array into per-person clusters.
// A new person starts whenever a "Name" label is encountered.
function groupLenderTeam(rows) {
  const groups = [];
  let current = null;
  for (const row of rows) {
    if (row.label.toLowerCase() === 'name') {
      if (current) groups.push(current);
      current = [row];
    } else {
      if (!current) current = [];
      current.push(row);
    }
  }
  if (current) groups.push(current);
  return groups;
}

// ─── Template catalog & classifier ───────────────────────────────────────────

// Template sections define the canonical section order and labels for each template.
// Each { slot, label } entry maps a semantic content slot from the API to a display heading.
// applyTemplate() uses this schema to build infoSections from the raw slot data.

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE APPLICATION RULES
//
// applyTemplate() is the single place where semantic slots become rendered sections.
//
// Rules:
// - preserve section order from template.sections
// - render only sections with content
// - allow static template text via `text`
// - suppress empty sections
// - inject contactGuidance only from template config, not from arbitrary model output
//
// Output:
// - infoSections should reflect the exact section structure used by Preview / Inspect / Export
// ─────────────────────────────────────────────────────────────────────────────

const CONTACT_GUIDANCE_TEXT = {
  lender:              'If you have questions, contact your lender.',
  lender_or_settlement: 'If you have questions, contact your lender or settlement team.',
};

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE STANDARDS
//
// Every template must define:
// - id
// - label
// - description
// - match(data, userType)
// - sections
// - optional contactGuidance
//
function isActionRequiredType(emailType) {
  return emailType === 'action_required';
}

function isMessageType(emailType) {
  return emailType === 'message';
}

function isInformationalType(emailType) {
  return emailType === 'status_update' || emailType === 'update';
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION / STRUCTURE VALIDATION
//
// runSectionValidation() enforces locked template rules.
//
// Global rules:
// - action_required emails must have nextSteps
// - action_required emails must have a CTA
// - message emails must have messageText
// - required template slots must not be empty
//
// Intent rules:
// - status_update / update emails should not require nextSteps unless explicitly designed
// - message emails should not depend on CTA for completeness
//
// This validation should catch structure problems before export.
// ─────────────────────────────────────────────────────────────────────────────

// Section rules:
// - sections must appear in the intended display order
// - only include sections needed for that template
// - use fixed labels for canonical sections
// - required sections should be validated in runSectionValidation()
//
// Canonical section labels:
// - Next steps
// - Getting started
// - Closing details
// - Signing details
// - Document details
// - Team details
// - Message
// - Notary details
//
// Email type intent:
// - action_required = task + CTA + optional nextSteps
// - status_update   = FYI / state change
// - update          = informational change
// - message         = preserve message text exactly
// - onboarding      = explanatory / setup guidance
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_CATALOG = [
  // Borrower
  {
    id: 'borrower_digital_closing_onboarding',
    label: 'Borrower: Digital closing onboarding',
    description: 'Introduces the digital closing experience, capabilities, and timeline.',
    match: (d, u) => u === 'borrower' && !!d.capabilities,
    contactGuidance: 'lender',
    sections: [
      { slot: 'capabilities', label: 'What you can do', text: 'With this experience, you\'ll be able to:\n• Review your closing documents online\n• Securely eSign most documents\n• Spend less time at your in-person signing appointment' },
      { slot: 'closingInfo',  label: 'Your closing information', required: true },
      { slot: 'timeline',     label: 'Your closing timeline',    required: true },
      { slot: 'reassurance',  label: 'Is this secure?', text: 'Your closing documents are shared through Snapdocs, a secure platform used by {{lender_name}}.\nLearn more about digital closings in the Borrower Resource Center →' },
    ],
  },
  {
    id: 'borrower_signing_appointment_canceled',
    label: 'Borrower: Signing appointment canceled',
    description: 'Notifies the borrower that their signing appointment was canceled.',
    match: (d, u) => u === 'borrower' && /cancel/i.test(d.headline || ''),
    contactGuidance: 'lender_or_settlement',
    sections: [
      { slot: 'notes',       label: 'What this means' },
    ],
  },
  {
    id: 'borrower_signing_appointment_scheduled',
    label: 'Borrower: Signing appointment scheduled',
    description: 'Confirms a signing appointment has been scheduled.',
    match: (d, u) => u === 'borrower' && d.emailType === 'status_update' &&
      /schedul|confirm/i.test(d.headline || ''),
    contactGuidance: 'lender_or_settlement',
    sections: [
      { slot: 'closingInfo',  label: 'Your appointment' },
      { slot: 'timeline',     label: 'What to expect' },
      { slot: 'reassurance',  label: 'Is this secure?', text: 'Your closing documents are shared through Snapdocs, a secure platform used by {{lender_name}}.\nLearn more about digital closings in the Borrower Resource Center →' },
    ],
  },
  {
    id: 'borrower_signing_appointment_updated',
    label: 'Borrower: Signing appointment updated',
    description: 'Notifies the borrower that appointment details changed.',
    match: (d, u) => u === 'borrower' && /updat|reschedul/i.test(d.headline || ''),
    contactGuidance: 'lender_or_settlement',
    sections: [
      { slot: 'closingInfo',  label: 'Updated appointment details' },
      { slot: 'notes',        label: 'What this means' },
      { slot: 'reassurance',  label: 'Is this secure?', text: 'Your closing documents are shared through Snapdocs, a secure platform used by {{lender_name}}.\nLearn more about digital closings in the Borrower Resource Center →' },
    ],
  },
  {
    id: 'borrower_action_required_esign',
    label: 'Borrower: eSign documents',
    description: 'Prompts the borrower to electronically sign documents.',
    match: (d, u) => u === 'borrower' && d.emailType === 'action_required' &&
      /esign|sign electronically|sign your doc/i.test(d.headline || ''),
    contactGuidance: 'lender',
    sections: [
      { slot: 'closingInfo', label: 'Your signing information' },
      { slot: 'timeline',    label: 'Your signing timeline' },
      { slot: 'notes',       label: 'What to know' },
    ],
  },
  {
    id: 'borrower_ron_signing',
    label: 'Borrower: Webcam signing',
    description: 'Notifies the borrower their documents are ready for a remote online notary (RON) or webcam signing appointment.',
    match: (d, u) => u === 'borrower' && d.emailType === 'action_required' &&
      /webcam|notary|ron\b|online\s+signing|remote\s+online/i.test([d.headline, d.notes, d.summary].filter(Boolean).join(' ')),
    contactGuidance: 'lender',
    sections: [
      { slot: 'notes',       label: 'Preparation checklist' },
      { slot: 'closingInfo', label: 'Signing details' },
    ],
  },
  {
    id: 'borrower_action_required_review',
    label: 'Borrower: Review documents',
    description: 'Prompts the borrower to review their closing documents.',
    match: (d, u) => u === 'borrower' && d.emailType === 'action_required' &&
      /review|documents? ready/i.test(d.headline || ''),
    contactGuidance: 'lender',
    sections: [
      { slot: 'notes',       label: 'What to review' },
      { slot: 'closingInfo', label: 'Your document details' },
    ],
  },
  {
    id: 'borrower_message_notification',
    label: 'Borrower: New message',
    description: 'Delivers a message from the lender or settlement team to the borrower.',
    match: (d, u) => u === 'borrower' && d.emailType === 'message',
    contactGuidance: 'lender',
    sections: [],
  },
  // Lender
  {
    id: 'lender_cd_balancing_issue',
    label: 'Lender: CD balancing issue',
    description: 'Alerts the lender to a Closing Disclosure balancing discrepancy.',
    match: (d, u) => u === 'lender' && /\bcd\b|closing disclosure|balanc/i.test(d.headline || ''),
    sections: [
      { slot: 'notes',       label: 'What needs to be done' },
      { slot: 'closingInfo', label: 'Closing details' },
    ],
  },
  {
    id: 'lender_missing_document',
    label: 'Lender: Missing document',
    description: 'Notifies the lender that a required document is missing.',
    match: (d, u) => u === 'lender' && d.emailType === 'action_required' &&
      /missing|document/i.test(d.headline || ''),
    sections: [
      { slot: 'notes',       label: "What's needed" },
      { slot: 'closingInfo', label: 'Closing details' },
    ],
  },
  {
    id: 'lender_signing_canceled',
    label: 'Lender: Signing canceled',
    description: 'Notifies the lender that the signing appointment was canceled.',
    match: (d, u) => u === 'lender' && /cancel/i.test(d.headline || ''),
    sections: [
      { slot: 'notes',       label: 'Next steps' },
      { slot: 'closingInfo', label: 'Closing details' },
    ],
  },
  {
    id: 'lender_signing_scheduled',
    label: 'Lender: Signing scheduled',
    description: 'Confirms a signing appointment for the lender.',
    match: (d, u) => u === 'lender' && /schedul|confirm/i.test(d.headline || ''),
    sections: [
      { slot: 'closingInfo', label: 'Signing details' },
      { slot: 'notes',       label: 'Additional information' },
    ],
  },
  // Settlement agent
  {
    id: 'settlement_agent_action_required',
    label: 'Settlement agent: Action required',
    description: 'Directs the settlement agent to take a specific action.',
    match: (d, u) => u === 'settlement_agent' && d.emailType === 'action_required',
    sections: [
      { slot: 'closingInfo', label: 'Closing details' },
      { slot: 'notes',       label: "What's needed" },
    ],
  },
  {
    id: 'settlement_agent_status_update',
    label: 'Settlement agent: Status update',
    description: 'Informs the settlement agent of a workflow status change.',
    match: (d, u) => u === 'settlement_agent' && d.emailType === 'status_update',
    sections: [
      { slot: 'closingInfo', label: 'Closing details' },
      { slot: 'notes',       label: 'Additional information' },
    ],
  },
  // Settlement office
  {
    id: 'settlement_office_status_update',
    label: 'Settlement office: Status update',
    description: 'FYI notification to the settlement office.',
    match: (d, u) => u === 'settlement_office',
    sections: [
      { slot: 'closingInfo', label: 'Closing details' },
      { slot: 'notes',       label: 'Additional information' },
    ],
  },
  // Notary
  {
    id: 'notary_assignment',
    label: 'Notary: Assignment notification',
    description: 'Notifies the notary of a new closing assignment.',
    match: (d, u) => u === 'notary' && /assign/i.test(d.headline || ''),
    sections: [
      { slot: 'closingInfo', label: 'Signing details' },
      { slot: 'notes',       label: 'Additional information' },
    ],
  },
  {
    id: 'notary_signing_canceled',
    label: 'Notary: Signing canceled',
    description: 'Notifies the notary that a signing was canceled.',
    match: (d, u) => u === 'notary' && /cancel/i.test(d.headline || ''),
    sections: [
      { slot: 'notes',       label: 'What this means' },
    ],
  },
  {
    id: 'notary_action_required_document_expired_7_day_reminder',
    label: 'Notary: Expired document — 7-day reminder',
    description: 'Follow-up reminder sent 7 days after first expired-document notice. Requires uploading the expired credential to return to active status.',
    match: (d, u) =>
      u === 'notary' &&
      d.emailType === 'action_required' &&
      (d.subtype === 'document_expired' ||
        /upload.*active\s+status|expired.*(?:receiv|signing\s+order|inactive)|no\s+longer\s+(?:active|receiv)/i.test(
          `${d.headline || ''} ${d.summary || ''}`
        )),
    sections: [
      { slot: 'notes', label: 'What you need to do', required: true },
    ],
  },
  {
    id: 'notary_action_required',
    label: 'Notary: Action required',
    description: 'Blocked-state or recovery email requiring the notary to take action.',
    match: (d, u) => u === 'notary' && d.emailType === 'action_required',
    sections: [
      { slot: 'notes',       label: 'What you need to know', required: true },
      { slot: 'closingInfo', label: 'Signing details' },
    ],
  },
  {
    id: 'notary_status_update',
    label: 'Notary: Status update',
    description: 'FYI notification to the notary.',
    match: (d, u) => u === 'notary',
    sections: [
      { slot: 'closingInfo', label: 'Signing details' },
      { slot: 'notes',       label: 'Additional information' },
    ],
  },
  // Support
  {
    id: 'support_operational_alert',
    label: 'Support: Operational alert',
    description: 'Internal support notification requiring review or action.',
    match: (d, u) => u === 'support',
    sections: [
      { slot: 'notes',       label: 'Details' },
      { slot: 'closingInfo', label: 'Related information' },
    ],
  },
  // Message (catch-all)
  {
    id: 'message_notification',
    label: 'Message notification',
    description: 'Relays a user-written message or comment.',
    match: (d, u) => d.emailType === 'message',
    sections: [],
  },
];

// Fallback section schema when no template matches
const DEFAULT_SECTIONS = [
  { slot: 'capabilities', label: 'What you can do' },
  { slot: 'closingInfo',  label: 'Closing information' },
  { slot: 'timeline',     label: 'Timeline' },
  { slot: 'reassurance',  label: 'Is this secure?' },
  { slot: 'notes',        label: 'Additional information' },
];

// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE MATCHING RULES
//
// classifyTemplate() should match the most specific valid template.
//
// Rules:
// - prefer explicit pattern matches over generic fallback
// - avoid matching a template unless the signal is clear
// - new template candidates should only appear when no strong existing template matches
//
// Template matching is system behavior, not just convenience.
// ─────────────────────────────────────────────────────────────────────────────

function classifyTemplate(data, userType) {
  if (!data) return null;
  const match = TEMPLATE_CATALOG.find(t => t.match(data, userType));
  if (match) return { ...match, isNew: false };

  // Generate a candidate ID from available signals
  const parts = [userType, data.emailType];
  const h = (data.headline || '').toLowerCase();
  if (/cancel/i.test(h))          parts.push('canceled');
  else if (/schedul|confirm/i.test(h)) parts.push('scheduled');
  else if (/updat|reschedul/i.test(h)) parts.push('updated');
  else if (/missing/i.test(h))    parts.push('missing_document');
  else if (/assign|link/i.test(h)) parts.push('assignment');
  else if (/complet|receiv/i.test(h)) parts.push('completed');
  const id = parts.filter(Boolean).join('_').replace(/[\s-]+/g, '_');
  return {
    id,
    label: `${userType.replace(/_/g, ' ')} — ${data.emailType.replace(/_/g, ' ')}`,
    description: 'No existing template matched. This is a new template candidate.',
    isNew: true,
  };
}

// Extract structured field values from keyDetails and closingInfo bullets for template substitution.
// Returns a map of field keys (e.g. lender_name, appointment_date) to real values.
function extractFields(data) {
  const fields = {};
  for (const row of (data.keyDetails || [])) {
    const label = (row.label || '').toLowerCase().trim();
    const value = (row.value || '').trim();
    if (!value) continue;
    const key = LABEL_TO_PLACEHOLDER[label];
    if (key && !fields[key]) fields[key] = value;
  }
  // Parse closingInfo bullet lines for date/time/location values not captured in keyDetails
  if (data.closingInfo) {
    for (const line of data.closingInfo.split('\n')) {
      const m = line.match(/^•\s*(.+?):\s*(.+)$/);
      if (!m) continue;
      const label = m[1].toLowerCase().trim();
      const value = m[2].trim();
      const key = LABEL_TO_PLACEHOLDER[label];
      if (key && !fields[key]) fields[key] = value;
    }
  }
  return fields;
}

// Build infoSections from semantic slot fields using the template's section schema.
// Sections with a `text` property use static template copy with {{field_name}} substitution.
// Sections without `text` fall back to Claude's slot content verbatim.
// Only sections with content are rendered — the `required` flag drives validation reporting
// only, not render presence. Empty sections are always suppressed.
function applyTemplate(data, template) {
  const schema = template?.sections ?? DEFAULT_SECTIONS;
  const fields = extractFields(data);
  const sections = schema
    .map(({ slot, label, text, required }) => {
      const body = text
        ? text.replace(/\{\{(\w+)\}\}/g, (_, key) => fields[key] ?? `{{${key}}}`)
        : data[slot] ?? null;
      return { heading: label, body, required: !!required, slot };
    })
    .filter(s => s.body); // only render sections that have content
  return { ...data, infoSections: sections.length > 0 ? sections : null, contactGuidance: template?.contactGuidance ?? null };
}

// Detect locked-section violations: required content slots Claude left empty, and
// structural requirements for action_required and message email types.
// Returns an array of human-readable issue strings (empty = no violations).
function runSectionValidation(data, template) {
  if (!template || template.isNew) return [];

  const issues = [];

  for (const { slot, label, text, required } of (template.sections ?? [])) {
    if (!required || text) continue;
    if (!data[slot]) {
      issues.push(`Required section "${label}" is empty — the "${slot}" slot must be filled for this email type.`);
    }
  }

  if (isActionRequiredType(data.emailType)) {
    if (!Array.isArray(data.nextSteps) || data.nextSteps.length === 0) {
      issues.push('Next steps are required for action_required emails.');
    }
    if (!data.cta) {
      issues.push('CTA is required for action_required emails.');
    }
  }

  if (isMessageType(data.emailType)) {
    if (!data.messageText) {
      issues.push('Message body (messageText) must be present for message emails.');
    }
  }

  return issues;
}

function TemplateMatchCard({ match }) {
  if (!match) return null;
  return (
    <div className={`template-match-card${match.isNew ? ' template-match-card--new' : ''}`}>
      <div className="template-match-header">
        <span className="template-match-badge">
          {match.isNew ? 'New template candidate' : 'Matched template'}
        </span>
        <code className="template-match-id">{match.id}</code>
      </div>
      <p className="template-match-label">{match.label}</p>
      <p className="template-match-desc">{match.description}</p>
      <p className="template-match-drives">
        Preview and Inspect are both rendered from this template
      </p>
    </div>
  );
}

// ─── HTML / export helpers ────────────────────────────────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HTML_CHIP = {
  action_required: { label: 'Action required', bg: '#fff3e0', color: '#b45309', border: '#fbbf24' },
  issue_error:     { label: 'Issue',            bg: '#fdecea', color: '#c0392b', border: '#f5c6c2' },
  message:         { label: 'Message',          bg: '#e6f4ff', color: '#1a5fa8', border: '#b8d4f0' },
};

const HTML_CTA_BG = {
  action_required: '#d97706',
  issue_error:     '#c0392b',
};

function htmlSectionBlock(title, contentHtml) {
  return `<table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:20px;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="padding:8px 16px;background:#fafafa;border-bottom:1px solid #e8e8e8;">
                  <p style="margin:0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:#8c8c8c;font-family:Inter,system-ui,-apple-system,sans-serif;">${escHtml(title)}</p>
                </td>
              </tr>
              <tr>
                <td style="padding:16px;">
                  ${contentHtml}
                </td>
              </tr>
            </table>`;
}

// Convert a body string to HTML, rendering '→' lines as styled anchor-like spans.
function bodyToHtml(body, F) {
  if (!body) return '';
  return body.split('\n').map(line =>
    line.includes('→')
      ? `<span style="color:#1a5fa8;text-decoration:underline;font-family:${F};">${escHtml(line)}</span>`
      : escHtml(line)
  ).join('<br>');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT STANDARDS: HTML
//
// generateEmailHTML() must mirror the same rules used by Preview and HAML.
//
// Rules:
// - only render sections that exist
// - only render one CTA
// - CTA style must match email intent
// - action_required => primary CTA
// - informational => secondary CTA or none
// - message => preserve message text block
// - support / reply guidance only when appropriate
//
// Preview, HTML, and HAML should stay structurally aligned.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT STANDARDS: HTML (FINAL)
//
// This function must mirror Preview + HAML behavior exactly.
//
// Rules:
// - Only one CTA
// - action_required => primary CTA
// - status/update => secondary CTA or none
// - message => no CTA (unless explicitly needed)
// - CTA placement must follow same logic as HAML
//
// Any deviation here creates inconsistency between preview and export.
// ─────────────────────────────────────────────────────────────────────────────

function generateEmailHTML(data, logoUrl = '', userType = '') {
  const F = 'Inter,system-ui,-apple-system,sans-serif';
  const chip = HTML_CHIP[data.emailType];
  const isSecondary = data.ctaStyle === 'secondary';
  const isNavigational = data.ctaStyle === 'navigational';
  const isRON = /webcam\s+signing\s+appointment|remote\s+online\s+notary/i.test(
    [data.notes, data.summary, data.headline].filter(Boolean).join(' ')
  );
  const nextStepsTitle = isRON ? 'Before your appointment' : 'Next steps';
  const ctaBg = (isSecondary || isNavigational) ? '#ffffff' : (HTML_CTA_BG[data.emailType] ?? '#1a5fa8');
  const ctaTextColor = (isSecondary || isNavigational) ? '#1a5fa8' : '#ffffff';
  const ctaBorder = (isSecondary || isNavigational) ? '1.5px solid #1a5fa8' : 'none';

  const logoHtml = logoUrl
    ? `<img src="${escHtml(logoUrl)}" alt="Lender logo" style="max-height:40px;max-width:200px;display:block;">`
    : `<!-- Add lender logo: <img src="logo.png" alt="Lender logo" style="max-height:40px;display:block;"> -->`;

  const chipHtml = (chip && !isNavigational)
    ? `<p style="margin:0 0 16px 0;">
                <span style="display:inline-block;padding:3px 10px;border-radius:100px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;background:${chip.bg};color:${chip.color};border:1px solid ${chip.border};font-family:${F};">${escHtml(chip.label)}</span>
              </p>`
    : '';

  let messageTextHtml = '';
  if (data.messageText) {
    messageTextHtml = htmlSectionBlock(
      'Message',
      `<p style="margin:0;font-size:15px;color:#1a1a1a;line-height:1.65;white-space:pre-wrap;border-left:3px solid #e0e0e0;padding-left:12px;font-family:${F};">${escHtml(data.messageText)}</p>`
    );
  }

  const primaryCtaInNextSteps = !isSecondary && !isNavigational && data.cta && data.nextSteps?.length;
  const primaryCtaInKeyDetails = !isSecondary && !isNavigational && data.cta && data.keyDetails?.length && !data.nextSteps?.length;
  const primaryCtaButtonHtml = `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-top:16px;">
              <tr>
                <td style="border-radius:6px;background:${ctaBg};">
                  <a href="#" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:${ctaTextColor};text-decoration:none;border-radius:6px;background:${ctaBg};font-family:${F};">${escHtml(data.cta || '')}</a>
                </td>
              </tr>
            </table>`;

  let nextStepsHtml = '';
  if (data.nextSteps?.length) {
    const items = data.nextSteps
      .map(s => `<li style="margin-bottom:8px;font-size:15px;color:#1a1a1a;line-height:1.5;font-family:${F};">${escHtml(s)}</li>`)
      .join('\n                  ');
    nextStepsHtml = htmlSectionBlock(
      nextStepsTitle,
      `<ul style="margin:0;padding-left:20px;">\n                  ${items}\n                </ul>${primaryCtaInNextSteps ? primaryCtaButtonHtml : ''}`
    );
  }

  function detailRows(items) {
    return items.map((row, i) =>
      `<tr>
                    <td style="padding:6px 8px 6px 0;width:40%;font-size:13px;font-weight:600;color:#595959;vertical-align:top;${i > 0 ? 'border-top:1px solid #f5f5f5;' : ''}font-family:${F};">${escHtml(row.label)}</td>
                    <td style="padding:6px 0;font-size:13px;color:#1a1a1a;vertical-align:top;${i > 0 ? 'border-top:1px solid #f5f5f5;' : ''}font-family:${F};">${escHtml(row.value)}</td>
                  </tr>`
    ).join('\n');
  }

  let keyDetailsHtml = '';
  if (data.keyDetails?.length) {
    keyDetailsHtml = htmlSectionBlock(
      data.keyDetailsTitle || 'Details',
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">\n${detailRows(data.keyDetails)}\n                </table>${primaryCtaInKeyDetails ? primaryCtaButtonHtml : ''}`
    );
  }

  let lenderTeamHtml = '';
  if (data.lenderTeam?.length) {
    const groups = groupLenderTeam(data.lenderTeam);
    const groupTables = groups.map((group, gi) => `
              ${gi > 0 ? '<tr><td colspan="2" style="padding:0;border-top:1px solid #e8e8e8;font-size:0;line-height:0;">&nbsp;</td></tr>' : ''}
              ${group.map((row, i) => `<tr>
                    <td style="padding:${i === 0 && gi > 0 ? '8px' : '4px'} 8px 4px 0;width:40%;font-size:13px;font-weight:600;color:#595959;vertical-align:top;font-family:${F};">${escHtml(row.label)}</td>
                    <td style="padding:${i === 0 && gi > 0 ? '8px' : '4px'} 0 4px 0;font-size:13px;color:#1a1a1a;vertical-align:top;font-family:${F};">${escHtml(row.value)}</td>
                  </tr>`).join('\n')}`).join('\n');
    lenderTeamHtml = htmlSectionBlock(
      'Lender team',
      `<table width="100%" cellpadding="0" cellspacing="0" border="0">${groupTables}\n                </table>`
    );
  }

  const navOrPrimaryButtonHtml = (bg, textColor, border) =>
    `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:20px;">
              <tr>
                <td style="border-radius:6px;background:${bg};border:${border};">
                  <a href="#" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:${textColor};text-decoration:none;border-radius:6px;background:${bg};font-family:${F};">${escHtml(data.cta || '')}</a>
                </td>
              </tr>
            </table>`;

  const ctaHtml = data.cta
    ? isSecondary
      ? `<p style="margin:0 0 20px 0;font-family:${F};"><a href="#" style="font-size:14px;color:#1a5fa8;text-decoration:underline;font-family:${F};">${escHtml(data.cta)}</a></p>`
      : isNavigational
        ? navOrPrimaryButtonHtml('#ffffff', '#1a5fa8', '1.5px solid #1a5fa8')
        : primaryCtaInNextSteps || primaryCtaInKeyDetails
          ? '' // already rendered inside nextSteps or keyDetails block
          : navOrPrimaryButtonHtml(ctaBg, ctaTextColor, 'none')
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(data.subjectLine || 'Email')}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="background:#f5f5f5;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e8e8e8;border-radius:8px;overflow:hidden;">
          <!-- Lender logo -->
          <tr>
            <td style="padding:24px;border-bottom:1px solid #f0f0f0;">
              ${logoHtml}
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:24px;">
              ${chipHtml}
              ${data.headline ? `<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:#1a1a1a;line-height:1.3;font-family:${F};">${escHtml(data.headline)}</h1>` : ''}
              ${data.summary ? `<p style="margin:0 0 20px 0;font-size:15px;color:#595959;line-height:1.65;white-space:pre-line;font-family:${F};">${escHtml(data.summary)}</p>` : ''}
              ${messageTextHtml}
              ${nextStepsHtml}
              ${keyDetailsHtml}
              ${lenderTeamHtml}
              ${(data.infoSections || []).map(sec => htmlSectionBlock(sec.heading, `<p style="margin:0;font-size:13px;color:#595959;line-height:1.65;font-family:${F};">${bodyToHtml(sec.body, F)}</p>`)).join('\n')}
              ${data.contactGuidance && CONTACT_GUIDANCE_TEXT[data.contactGuidance] ? `<p style="margin:0 0 20px 0;font-size:13px;color:#595959;line-height:1.6;font-family:${F};">${escHtml(CONTACT_GUIDANCE_TEXT[data.contactGuidance])}</p>` : ''}
              ${data.replyGuidance ? `<p style="margin:0 0 20px 0;font-size:13px;color:#595959;line-height:1.6;font-family:${F};">${escHtml(data.replyGuidance)}</p>` : ''}
              ${ctaHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:16px 24px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999999;font-family:${F};">Powered by Snapdocs</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function generateJSON(data) {
  const { complianceCheck: _cc, ...exportable } = data; // strip internal fields
  return JSON.stringify(exportable, null, 2);
}

// ─── Global template-safe replacement policy ─────────────────────────────────
//
// templateizeResult() is the SINGLE replacement pass applied to every field
// before Preview renders in placeholder mode. No field may bypass it.
//
// Two complementary registries drive replacement:
//   LABEL_TO_PLACEHOLDER  — structured-field registry: maps keyDetails/lenderTeam
//                           labels to {{placeholder}} keys. Add new dynamic field
//                           categories here when Claude introduces a new label type.
//   templatize() patterns  — pattern-based registry: regex catches for values that
//                           appear in prose but not in structured fields (dates,
//                           phones, emails, addresses, IDs, URLs, company names).
//
// Applies to ALL user types (borrower, lender, settlement_agent, settlement_office,
// notary, support) with no per-type exemptions.

// Structured-field placeholder registry.
// Maps keyDetails/lenderTeam row labels (lowercased) to {{placeholder}} keys.
// Every extractable structured field category must have an entry here.
const LABEL_TO_PLACEHOLDER = {
  'borrower':                  'borrower_name',
  'client':                    'borrower_name',
  'buyer':                     'borrower_name',
  'closing id':                'closing_id',
  'closing':                   'closing_id',
  'file number':               'closing_id',
  'file':                      'closing_id',
  'order id':                  'closing_id',
  'order number':              'closing_id',
  'reference number':          'closing_id',
  'reference':                 'closing_id',
  'date':                      'appointment_date',
  'appointment date':          'appointment_date',
  'signing date':              'appointment_date',
  'time':                      'appointment_time',
  'appointment time':          'appointment_time',
  'signing time':              'appointment_time',
  'location':                  'appointment_location',
  'address':                   'appointment_location',
  'signing location':          'appointment_location',
  'property address':          'property_address',
  'mailing address':                 'mailing_address',
  'mail to':                         'mailing_address',
  'return address':                  'mailing_address',
  'document return address':         'mailing_address',
  'send documents to':               'mailing_address',
  'send to':                         'mailing_address',
  'status':                          'trailing_documents_status',
  'document status':                 'trailing_documents_status',
  'trailing document status':        'trailing_documents_status',
  'trailing documents status':       'trailing_documents_status',
  'notary':                    'notary_name',
  'lender':                    'lender_name',
  'lender company':            'lender_name',
  'company':                   'lender_name',
  'lender name':               'lender_name',
  'reason':                    'cancellation_reason',
  'document':                  'document_name',
  // Notary credential / document type (expired-document emails)
  'document type':             'document_type',
  'credential':                'document_type',
  'credential type':           'document_type',
  'expired document':          'document_type',
  'expired credential':        'document_type',
  'signer':                    'signer_name',
  'loan number':               'loan_number',
  'loan officer':              'loan_officer_name',
  'title company':             'title_company_name',
  'settlement office':         'settlement_office_name',
  'settlement company':        'settlement_office_name',
  'scheduling company':        'settlement_office_name',
  'settlement agent company':  'settlement_office_name',
  'scheduler':                 'settlement_office_name',
  'signing company':           'settlement_office_name',
  'added by':                  'settlement_office_name',
  'scheduled by':              'settlement_office_name',
  'escrow number':             'escrow_number',
  'additional signers':        'additional_signers',
  // Borrower contact info
  'email':                     'borrower_email',
  'email address':             'borrower_email',
  'borrower email':            'borrower_email',
  'phone':                     'borrower_phone',
  'phone number':              'borrower_phone',
  'borrower phone':            'borrower_phone',
  'cell':                      'borrower_phone',
  'cell phone':                'borrower_phone',
  'mobile':                    'borrower_phone',
  // Closing type (e.g. "Hybrid signing", "RON", "In-person")
  'type':                      'closing_type',
  'closing type':              'closing_type',
  'signing type':              'closing_type',
  'loan type':                 'closing_type',
  // Shipping / delivery method (e.g. "FedEx Priority Overnight", "UPS Ground")
  'shipping method':           'shipping_method',
  'delivery method':           'shipping_method',
  'carrier':                   'shipping_method',
  // Fees and monetary amounts
  'fee':                       'fee_amount',
  'notary fee':                'fee_amount',
  'updated notary fee':        'fee_amount',
  'signing fee':               'fee_amount',
  'service fee':               'fee_amount',
  'shipping cost':             'shipping_amount',
  'shipping fee':              'shipping_amount',
  'delivery cost':             'shipping_amount',
  'charge':                    'amount',
  'amount':                    'amount',
  'total':                     'amount',
  'price':                     'price',
  'cost':                      'amount',
  // Lender team structured rows
  'title':                     'lender_contact_title',
  'role':                      'lender_contact_title',
  // Reporting period
  'month':                     'reporting_month',
  'reporting month':           'reporting_month',
  'period':                    'reporting_period',
  'reporting period':          'reporting_period',
  'quarter':                   'reporting_period',
  // Summary metrics (notary/agent monthly/periodic summary emails)
  'signings':                  'signings_count',
  'total signings':            'signings_count',
  'signing count':             'signings_count',
  'orders':                    'signings_count',
  'total orders':              'signings_count',
  'completions':               'signings_count',
  'revenue':                   'revenue_amount',
  'total revenue':             'revenue_amount',
  'earnings':                  'revenue_amount',
  'total earnings':            'revenue_amount',
  'miles':                     'miles_driven',
  'miles driven':              'miles_driven',
  'total miles':               'miles_driven',
  'avg miles per signing':     'avg_miles_per_signing',
  'average miles per signing': 'avg_miles_per_signing',
  'avg miles':                 'avg_miles_per_signing',
  'thumbs up':                       'thumbs_up_count',
  'thumbs up (companies)':           'thumbs_up_companies',
  'thumbs up from companies':        'thumbs_up_companies',
  'thumbs up - companies':           'thumbs_up_companies',
  'thumbs up (consumers)':           'thumbs_up_consumers',
  'thumbs up from consumers':        'thumbs_up_consumers',
  'thumbs up - consumers':           'thumbs_up_consumers',
  'thumbs up companies':             'thumbs_up_companies',
  'thumbs up consumers':             'thumbs_up_consumers',
  'company thumbs up':               'thumbs_up_companies',
  'consumer thumbs up':              'thumbs_up_consumers',
};

// Bullet-line patterns for infoSection body — replace the value portion
// of "• Label: value" lines with context-specific placeholders.
const BULLET_LINE_PATTERNS = [
  { re: /^(•\s*Review documents?(?:\s+by)?:?\s+)(.+)$/i,      ph: '{{review_documents_date}}' },
  { re: /^(•\s*eSign(?:\s+documents?)?(?:\s+by)?:?\s+)(.+)$/i, ph: '{{esign_date}}' },
  { re: /^(•\s*In-?person signing:?\s+)(.+)$/i,               ph: '{{in_person_signing_date}}' },
  { re: /^(•\s*Signing appointment:?\s+)(.+)$/i,              ph: '{{appointment_date}}' },
  // Reporting period
  { re: /^(•\s*(?:Month|Reporting month|Period|Reporting period|Quarter):?\s+)(.+)$/i, ph: '{{reporting_month}}' },
  // Summary metrics
  { re: /^(•\s*(?:Signings?|Total signings?|Signing count|Orders?|Total orders?|Completions?):?\s+)(.+)$/i, ph: '{{signings_count}}' },
  { re: /^(•\s*(?:Total revenue|Revenue|Earnings?|Total earnings?):?\s+)(.+)$/i,                           ph: '{{revenue_amount}}' },
  { re: /^(•\s*(?:Avg\.?\s+miles per signing|Average miles per signing):?\s+)(.+)$/i,                     ph: '{{avg_miles_per_signing}}' },
  { re: /^(•\s*(?:Miles driven|Total miles?|Miles?):?\s+)(.+)$/i,                                         ph: '{{miles_driven}}' },
  { re: /^(•\s*(?:Thumbs up\s*(?:from\s*)?\(?companies?\)?|Company thumbs up):?\s+)(.+)$/i,  ph: '{{thumbs_up_companies}}' },
  { re: /^(•\s*(?:Thumbs up\s*(?:from\s*)?\(?consumers?\)?|Consumer thumbs up):?\s+)(.+)$/i, ph: '{{thumbs_up_consumers}}' },
  { re: /^(•\s*Thumbs up:?\s+)(.+)$/i,                                                       ph: '{{thumbs_up_count}}' },
];

// ─── Borrower support guidance cleanup ───────────────────────────────────────
// Mirrors server.js logic but runs client-side at result storage time,
// guaranteeing enforcement regardless of server state.

function normalizeWhitespace(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function stripEmptyLines(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .split('\n')
    .map(line => line.trimEnd())
    .filter((line, idx, arr) => {
      if (line !== '') return true;
      return arr[idx - 1] !== '';
    })
    .join('\n')
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY STANDARDS: BORROWER CLEANUP
//
// sanitizeBorrowerResult() is the borrower copy enforcement layer.
//
// Rules:
// - borrower support guidance should be consistent
// - operational/internal support wording should be removed
// - remove duplicate or misplaced support guidance
// - normalize borrower-facing terminology
// - preserve meaning while reducing inconsistent phrasing
//
// Do not use this function to rewrite structure.
// Structure belongs to template application and validation.
// ─────────────────────────────────────────────────────────────────────────────

function sanitizeBorrowerResult(result, userType) {
  if (userType !== 'borrower' || !result) return result;

  const isSupportGuidance = (s) => {
    const t = (s || '').trim().toLowerCase();
    // Exception: in-person signing appointment notes are content, not support guidance.
    if (/\b(?:signing appointment|sign(?:ing)? (?:any )?remaining documents? in person|meet with your (?:notary|settlement agent))\b/.test(t)) return false;
    return (
      /\bif you have (?:any )?questions?\b/.test(t) ||
      /\bloan officers?\b/.test(t) ||
      /\bsettlement agents?\b/.test(t) ||
      /\breach out\b/.test(t) ||
      /\bcontact your\b/.test(t) ||
      /\bplease (?:don't hesitate to\s+)?contact\b/.test(t) ||
      /\bfeel free to (?:contact|reach out)\b/.test(t) ||
      /\bquestions?[,\s]+(?:please\s+)?(?:contact|reach out)\b/.test(t)
    );
  };

    const normalizeBorrowerCopy = (text) => {
    if (!text || typeof text !== 'string') return text;
    let s = text;

    s = s.replace(/\bloan officers?\b/gi, 'lender');
    s = s.replace(/\bsettlement agents?\b/gi, 'settlement team');
    s = s.replace(/\bplease don't hesitate to contact\b/gi, 'contact');
    s = normalizeWhitespace(s);
    s = stripEmptyLines(s);

    return s || null;
  };
  
  const stripSupportGuidance = (text) => {
    if (!text || typeof text !== 'string') return text;
    const cleaned = text
      .split('\n')
      .map(line => {
        if (!line.trim()) return line;
        const parts = line.split(/(?<=[.!?])\s+/).filter(s => !isSupportGuidance(s));
        return parts.length ? parts.join(' ') : null;
      })
      .filter(line => line !== null)
      .join('\n')
      .trim();
    return cleaned || null;
  };

  const normalizeRoles = (text) => {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(/\bloan officers?\b/gi, 'lender')
      .replace(/\bsettlement agents?\b/gi, 'settlement team');
  };

  const out = { ...result };

  for (const f of ['notes', 'closingInfo', 'reassurance', 'summary', 'capabilities', 'timeline', 'rewrittenEmail']) {
    if (out[f]) {
      out[f] = stripSupportGuidance(out[f]);
      if (out[f]) out[f] = normalizeBorrowerCopy(out[f]);
    }
  }

  if (Array.isArray(out.nextSteps)) {
    out.nextSteps = out.nextSteps
      .filter(step => !isSupportGuidance(step))
      .map(normalizeBorrowerCopy);
    if (out.nextSteps.length === 0) out.nextSteps = null;
  }

  // Fresh access link emails: always ensure the in-person signing note is present in nextSteps.
  const isFreshLink = /new eSign link|fresh.*link|new.*access link/i.test(
    [out.headline, out.subjectLine].filter(Boolean).join(' ')
  );
  const IN_PERSON_STEP = "At your signing appointment, you'll meet with your notary or settlement agent to sign any remaining documents in person.";
  if (isFreshLink) {
    const alreadyPresent = (out.nextSteps || []).some(s => /signing appointment|remaining documents.{0,20}in person/i.test(s));
    if (!alreadyPresent) {
      out.nextSteps = [...(out.nextSteps || []), IN_PERSON_STEP];
    }
  }

  return out;
}

function templateizeResult(data) {
  // Build real-value → {{placeholder}} map from keyDetails labels
  const valueMap = new Map();

  // Helper: for person names, also add last name alone so partial references in body
  // copy (e.g. "the Millsaps closing") are caught when only the surname appears.
  // AKA / alias variants are split and each part registered individually so prose that
  // uses only one name form (e.g. the alias without the primary name) is also caught.
  const PERSON_NAME_KEYS = new Set(['borrower_name', 'notary_name', 'signer_name', 'loan_officer_name']);
  const AKA_SEP = /\s+(?:AKA|A\.K\.A\.|a\.k\.a\.|also known as)\s+/i;
  function addWithLastName(value, placeholder) {
    if (!valueMap.has(value)) valueMap.set(value, placeholder);
    // If the value contains an AKA separator, register each name variant on its own.
    // This ensures "Spenser D. Smith AKA Spenser O. Smith" adds both individual names
    // to valueMap, catching prose that uses either form without the other.
    if (AKA_SEP.test(value)) {
      for (const part of value.split(AKA_SEP)) {
        const p = part.trim();
        if (p && !valueMap.has(p)) valueMap.set(p, placeholder);
      }
    }
    const key = placeholder.replace(/^\{\{|\}\}$/g, '');
    if (PERSON_NAME_KEYS.has(key)) {
      // Extract last name from the base form only (before any AKA separator or
      // "+ N more signer(s)" suffix that Claude appends when additional signers are present).
      const baseName = value.split(AKA_SEP)[0]
        .replace(/\s*\+\s*\d+\s+more\s+signer\w*/i, '')   // strip "+ N more signer(s)"
        .replace(/\s*,?\s*(?:Jr\.?|Sr\.?|II|III|IV|V|Esq\.?)$/i, '')  // strip generational suffixes
        .trim();
      // Register the stripped base name itself (e.g. "Kathy C Belmer" when value is
      // "Kathy C Belmer + 1 more signer") so prose uses are caught too.
      if (baseName && baseName !== value && !valueMap.has(baseName)) {
        valueMap.set(baseName, placeholder);
      }
      const parts = baseName.split(/\s+/);
      if (parts.length > 1) {
        const lastName = parts[parts.length - 1];
        if (lastName.length > 3 && !valueMap.has(lastName)) {
          valueMap.set(lastName, placeholder);
        }
        // For names with a middle name or initial (3+ parts), also register the
        // first+last form so "Kathy C Belmer" also catches "Kathy Belmer" in prose.
        if (parts.length >= 3) {
          const firstLast = `${parts[0]} ${parts[parts.length - 1]}`;
          if (!valueMap.has(firstLast)) valueMap.set(firstLast, placeholder);
        }
      }
    }
  }

  const COMPANY_NAME_KEYS = new Set(['settlement_office_name', 'title_company_name']);

  for (const row of (data.keyDetails || [])) {
    const label = (row.label || '').toLowerCase().trim();
    const value = (row.value || '').trim();
    const key = LABEL_TO_PLACEHOLDER[label];
    if (value && key) {
      addWithLastName(value, `{{${key}}}`);
      // For company names, also register a shortened form stripped of location qualifiers
      // ("in VA Beach") and legal suffixes ("Inc.", "LLC") so abbreviated prose references match.
      if (COMPANY_NAME_KEYS.has(key)) {
        const short = value
          .replace(/\s+in\s+\S.*$/i, '')                                           // strip " in City, State"
          .replace(/,?\s*(?:Inc|LLC|Corp|Ltd|Co|LLP|PC|PA|PLLC)\.?$/i, '')        // strip legal suffix
          .trim();
        if (short && short !== value && !valueMap.has(short)) {
          valueMap.set(short, `{{${key}}}`);
        }
      }
    } else if (value && !key) {
      // Value-format fallback: templatize by value shape when label isn't in LABEL_TO_PLACEHOLDER.
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !valueMap.has(value)) {
        valueMap.set(value, '{{borrower_email}}');
      } else if (/^\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}$/.test(value) && !valueMap.has(value)) {
        valueMap.set(value, '{{borrower_phone}}');
      }
    }
  }
  // Lender team: names, titles, emails, phones
  let lenderIdx = 1;
  let titleIdx = 1;
  for (const row of (data.lenderTeam || [])) {
    const label = row.label?.toLowerCase() ?? '';
    const value = row.value?.trim() ?? '';
    if (!value || valueMap.has(value)) continue;
    if (label === 'name') {
      const ph = `{{lender_contact_${lenderIdx}_name}}`;
      addWithLastName(value, ph);
      lenderIdx++;
    } else if (label === 'title' || label === 'role') {
      // Titles may be compound ("Loan Officer, Broker") — map the whole string.
      valueMap.set(value, `{{lender_contact_${titleIdx}_title}}`);
      titleIdx++;
    } else if (label === 'email' || /^[^@]+@/.test(value)) {
      valueMap.set(value, `{{lender_contact_email}}`);
    } else if (label === 'phone' || /\d{3}[-.\s]\d{3}[-.\s]\d{4}/.test(value)) {
      valueMap.set(value, `{{lender_contact_phone}}`);
    }
  }

  // Fallback: infer lender name from subject line ("...with LenderName")
  // and from summary opening ("[Company] is providing...").
  // Short company names without LLC/Inc suffixes need these to be caught in body prose.
  const hasLenderName = [...valueMap.values()].includes('{{lender_name}}');
  if (!hasLenderName) {
    const subjectMatch = data.subjectLine?.match(
      /\b(?:with|by|from|at)\s+([A-Z][A-Za-z0-9\s&',.-]{2,60}?)(?:\s*$|[,.])/
    );
    const summaryMatch = !subjectMatch && data.summary?.match(
      /^([A-Z][A-Za-z0-9&'.,\s-]{1,50}?)\s+(?:is|are|has)\s+(?:providing|offering|using|partnering)/
    );
    const candidate = (subjectMatch?.[1] ?? summaryMatch?.[1])?.trim();
    if (candidate && !valueMap.has(candidate)) {
      valueMap.set(candidate, '{{lender_name}}');
    }
  }

  // Fallback: infer borrower name from subject line.
  // Server deduplication removes the Borrower keyDetails row when the name appears in the subject
  // (e.g. "Closing created for Lopez Sepulveda (587001998509)"), so valueMap won't have it.
  // Notary subjects use last-name-only (e.g. "Shipping reminder for Bersot"), so {0,3} allows
  // a single capitalized word — {1,3} was incorrectly requiring at least two.
  const hasBorrowerName = () => [...valueMap.values()].includes('{{borrower_name}}');

  // "for [Name]" or "about [Name]" in subject line
  if (!hasBorrowerName() && data.subjectLine) {
    const m = data.subjectLine.match(
      /\b(?:for|about)\s+([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,3})\b/
    );
    if (m) addWithLastName(m[1].trim(), '{{borrower_name}}');
  }

  // "the [Name] closing" in body text — catches last-name-only references like "the Gore closing"
  // that appear when the borrower name is omitted from keyDetails due to deduplication rules.
  if (!hasBorrowerName()) {
    const bodyText = [data.summary, data.notes, data.headline, data.subjectLine].filter(Boolean).join('\n');
    const m = bodyText.match(/\bthe\s+([A-Z][A-Za-z'-]+)\s+closing\b/i);
    if (m && !valueMap.has(m[1])) {
      addWithLastName(m[1].trim(), '{{borrower_name}}');
    }
  }

  // Fallback: infer closing ID from subject line.
  // Pure numeric IDs in parentheses (e.g. "(587001998509)") are a common subject pattern.
  // Adding the bare number to valueMap ensures it's replaced everywhere, not just in parens.
  const hasClosingId = [...valueMap.values()].includes('{{closing_id}}');
  if (!hasClosingId && data.subjectLine) {
    const m = data.subjectLine.match(/\((\d{6,})\)/);
    if (m && !valueMap.has(m[1])) {
      valueMap.set(m[1], '{{closing_id}}');
    }
  }

  // Fallback: detect borrower last name and closing ID from Snapdocs "Name #ID" subject pattern.
  // e.g. "Gore #2000234747, Closing linked to notary order" → borrower "Gore", closing ID "2000234747".
  // The existing borrower fallback only catches "for [Name]" patterns and misses this form.
  if (data.subjectLine) {
    const snapSubject = data.subjectLine.match(/^([A-Z][A-Za-z'-]+(?:\s+[A-Z][A-Za-z'-]+){0,2})\s+#(\d{6,})/);
    if (snapSubject) {
      const [, namepart, idpart] = snapSubject;
      if (!valueMap.has(namepart) && ![...valueMap.values()].includes('{{borrower_name}}')) {
        addWithLastName(namepart.trim(), '{{borrower_name}}');
      }
      if (!valueMap.has(idpart) && ![...valueMap.values()].includes('{{closing_id}}')) {
        valueMap.set(idpart, '{{closing_id}}');
      }
    }
  }

  // Final fallback: extract actor from operational sentences in body text.
  // Catches entity names (companies, individuals) that appear only as the subject of
  // action verbs in prose — e.g. "reli removed a signed document..." — and were not
  // detected via keyDetails, lenderTeam, subject-line, or summary-opening patterns.
  // The valueMap replacement is case-insensitive so adding "reli" also replaces "Reli".
  if (![...valueMap.values()].includes('{{lender_name}}')) {
    const STOP_WORD = /^(?:a|an|the|your|this|these|no|some|all|you|we|they|it|she|he|its|our|their|there|here|closing|document|settlement|appointment|signing|notification|update|snapdocs|notary|borrower|lender|agent|scheduler|title|access|status|order|message|new|click|please|contact)\b/i;
    const DOC_WORD  = /\b(?:documents?|policy|policies|title|recorded|mortgage|deed|scanback|trailing|closing|file|form|package|report|certificate)\b/i;
    const OP_VERB_RE = /^(.{2,50}?)\s+(?:removed|added|uploaded|sent|created|updated|canceled|rescheduled|linked|assigned|reviewed|processed|completed|rejected|received|confirmed|notified|requested|shared|released|archived)\b/i;
    const bodyFields = [data.notes, data.summary, data.headline, data.timeline, data.closingInfo];
    const sentences = bodyFields
      .flatMap(f => (f || '').split(/[.\n]/))
      .map(s => s.trim())
      .filter(Boolean);
    for (const sentence of sentences) {
      const m = sentence.match(OP_VERB_RE);
      if (m) {
        const candidate = m[1].trim();
        if (!STOP_WORD.test(candidate) && !DOC_WORD.test(candidate) && candidate.length > 2 && !valueMap.has(candidate)) {
          valueMap.set(candidate, '{{lender_name}}');
          break;
        }
      }
    }
  }

  // Fallback: detect individual actor name from sentences like "Kelly Greaves has removed the signed document".
  // These are Snapdocs/lender users performing actions on a closing — not company names, and often not
  // listed in lenderTeam. The existing OP_VERB_RE fallback misses them because it only fires when
  // lender_name is absent, and it captures "X has" (with the auxiliary verb) rather than just "X".
  if (![...valueMap.values()].includes('{{actor_name}}')) {
    const ACTOR_PATTERNS = [
      // "Lisette Pollard has added a message" / "Kelly Greaves removed the document"
      /^([A-Z][a-z]+(?:[-'][A-Za-z]+)?(?:\s+[A-Z][a-z]+(?:[-'][A-Za-z]+)?){1,3})\s+(?:has\s+|have\s+|had\s+)?(?:removed|uploaded|added|updated|replaced|archived|released|shared|sent|posted)\b/im,
      // "New message from Lisette Pollard" / "added by Lisette Pollard"
      /\b(?:from|by)\s+([A-Z][a-z]+(?:[-'][A-Za-z]+)?(?:\s+[A-Z][a-z]+(?:[-'][A-Za-z]+)?){1,3})(?:\s*[|,.]|\s+(?:on|at|to|for)\b|$)/im,
    ];
    const actorText = [data.subjectLine, data.headline, data.summary, data.notes].filter(Boolean).join('\n');
    let actorName = null;
    for (const pat of ACTOR_PATTERNS) {
      const m = actorText.match(pat);
      if (m?.[1]) { actorName = m[1]; break; }
    }
    const actorDocWord = /\b(?:documents?|policy|policies|title|recorded|mortgage|deed|scanback|trailing|closing|file|form|package|report|certificate)\b/i;
    if (actorName && !valueMap.has(actorName.trim()) && !actorDocWord.test(actorName.trim())) {
      addWithLastName(actorName.trim(), '{{actor_name}}');
    }
  }

  // Fallback: detect settlement office name from context patterns in the rewritten text.
  // Catches company names that appear as the actor in settlement-specific sentences
  // (e.g. "NVR Settlement Services added documents", "follow up with X to confirm")
  // even when Claude did not extract them into keyDetails.
  if (![...valueMap.values()].includes('{{settlement_office_name}}')) {
    const SETT_PATTERNS = [
      // "X added documents to this closing" / "X has added scanbacks"
      /^([A-Z][A-Za-z0-9\s&',.()-]{3,60}?)\s+(?:has\s+)?added\s+(?:documents?|scanbacks?)\b/im,
      // "follow up with X to confirm/inquire"
      /\bfollow\s+up\s+with\s+([A-Z][A-Za-z0-9\s&',.()-]{3,60}?)\s+(?:to\s+(?:confirm|inquire|check)|about)\b/im,
      // "not been marked complete by X"
      /\bnot\s+(?:yet\s+)?(?:been\s+)?marked\s+complete\s+by\s+([A-Z][A-Za-z0-9\s&',.()-]{3,60}?)(?:\s*[,.]|\s+(?:please|so|before|to)\b)/im,
      // "X has not marked this closing complete"
      /\b([A-Z][A-Za-z0-9\s&',.()-]{3,60}?)\s+has\s+not\s+(?:yet\s+)?marked\s+(?:this\s+closing|the\s+closing)\b/im,
    ];
    const settFields = [data.notes, data.summary, data.headline, ...(data.nextSteps || [])];
    const settText = settFields.filter(Boolean).join('\n');
    for (const pat of SETT_PATTERNS) {
      const m = settText.match(pat);
      if (m?.[1]) {
        const name = m[1].trim().replace(/[,.]$/, '');
        if (!valueMap.has(name)) valueMap.set(name, '{{settlement_office_name}}');
        // Also register short form without location qualifier or legal suffix
        const short = name
          .replace(/\s+in\s+\S.*$/i, '')
          .replace(/,?\s*(?:Inc|LLC|Corp|Ltd|Co|LLP|PC|PA|PLLC)\.?$/i, '')
          .trim();
        if (short && short !== name && !valueMap.has(short)) {
          valueMap.set(short, '{{settlement_office_name}}');
        }
        break;
      }
    }
  }

  function templatizeLine(line) {
    // Try bullet-line patterns first (label-specific placeholders)
    for (const { re, ph } of BULLET_LINE_PATTERNS) {
      const m = line.match(re);
      if (m) return m[1] + ph;
    }
    return templatize(line);
  }

  function templatize(text) {
    if (!text || typeof text !== 'string') return text;
    let s = text;

    // — Value-map substitutions (structured fields + name fallbacks) —
    // Apply longest match first to avoid partial clobbering (e.g. "John Smith" before "Smith").
    for (const [real, ph] of [...valueMap.entries()].sort((a, b) => b[0].length - a[0].length)) {
      s = s.replace(new RegExp(real.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ph);
    }

    // — Trailing document status values — catch known status strings inline in prose.
    s = s.replace(/\b(Partially complete|Not started|Complete|Pending|Overdue|In progress|Not received|Received)\b/g, '{{trailing_documents_status}}');

    // — Mailing addresses — catch US postal addresses inline in prose that weren't
    // caught via the valueMap (e.g. when the address appears in notes/nextSteps but
    // was not extracted into keyDetails). Matches "123 Main St..., City, ST 12345".
    s = s.replace(/\b\d{1,6}\s+[A-Za-z0-9][A-Za-z0-9\s.,'#-]{4,80},\s*(?:(?:ATTN|Attn|STE|Ste|Suite|Apt|Unit)[^,]{1,40},\s*)?[A-Za-z][A-Za-z\s]{2,30},\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, '{{mailing_address}}');

    // — Snapdocs system placeholders — literal strings injected by Snapdocs when
    // the real value is not populated (e.g. no settlement office name on record).
    s = s.replace(/\b(?:the\s+)?scheduling\s+company\b/gi, '{{settlement_office_name}}');

    // — AKA / alias cleanup —
    // After value-map substitutions, residual first-name/middle-initial fragments may remain
    // adjacent to a name placeholder when only the last name was known (e.g. subject-line
    // fallback). This pass collapses those fragments inside AKA constructs and then strips
    // any lone name-fragment prefix still attached to a placeholder.
    //
    // Step 1: collapse AKA constructs where both sides have a placeholder
    //   "Spenser D. {{borrower_name}} AKA Spenser O. {{borrower_name}}"
    //   → "{{borrower_name}} AKA {{borrower_alias}}"
    s = s.replace(
      /(?:[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'.]*)*\s+)?(\{\{borrower_name\}\})\s+(?:AKA|A\.K\.A\.|a\.k\.a\.|also known as)\s+(?:[A-Z][A-Za-z'-]*(?:\s+[A-Z][A-Za-z'.]*)*\s+)?(\{\{borrower_name\}\})/gi,
      '{{borrower_name}} AKA {{borrower_alias}}'
    );
    //
    // Step 2: strip residual first-name / middle-initial fragments still directly preceding
    // a borrower_name placeholder outside of AKA context
    //   "Spenser D. {{borrower_name}}" → "{{borrower_name}}"
    // Pattern: one capitalized first-name word + optional middle initial, immediately before
    // the placeholder with no other words in between.
    s = s.replace(/\b[A-Z][a-z]+(?:\s+[A-Z]\.)?\s+(\{\{borrower_name\}\})/g, '$1');

    // — Notary credential / document types —
    // Replace specific credential names with {{document_type}} before generic document patterns.
    // E&O variants (most specific first)
    s = s.replace(/\bErrors?\s+(?:&|and)\s+Omissions?\s+(?:Insurance|Certificate|Policy|Coverage)\b/gi, '{{document_type}}');
    s = s.replace(/\bE&O\s+(?:Insurance|Certificate|Policy|Coverage)\b/gi, '{{document_type}}');
    s = s.replace(/\bE&O\b/g, '{{document_type}}');
    // Bond variants
    s = s.replace(/\bNotary\s+Surety\s+Bond\b/gi, '{{document_type}}');
    s = s.replace(/\bNotary\s+Bond\b/gi, '{{document_type}}');
    s = s.replace(/\bSurety\s+Bond\b/gi, '{{document_type}}');
    // Background check variants
    s = s.replace(/\bBackground\s+(?:Check|Screening|Report)\b/gi, '{{document_type}}');
    // Commission variants
    s = s.replace(/\bNotary\s+Commission(?:\s+Certificate)?\b/gi, '{{document_type}}');
    s = s.replace(/\bCommission\s+Certificate\b/gi, '{{document_type}}');
    // Training certificate
    s = s.replace(/\bTraining\s+Certificate\b/gi, '{{document_type}}');

    // — Document identifiers —
    s = s.replace(/\b[\w.-]{3,}\.(?:pdf|docx?|xlsx?|txt|zip|png|jpg)\b/gi, '{{document_name}}');

    // — Shipping method — carrier names + optional service level in prose
    s = s.replace(/\b(?:FedEx|UPS|USPS|DHL)(?:\s+[A-Z][A-Za-z]+){0,3}/g, '{{shipping_method}}');

    // — Closing / record IDs —
    s = s.replace(/\b([A-Z]{2,3})\d{5,}\b/g, '{{closing_id}}');
    // Pure numeric IDs (10+ digits to avoid phone collision). Parenthesized form first.
    s = s.replace(/\(\d{10,}\)/g, '({{closing_id}})');
    s = s.replace(/\b\d{10,}\b/g, '{{closing_id}}');

    // — Contact info —
    s = s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '{{email_address}}');
    s = s.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/g, '{{phone_number}}');

    // — Currency amounts — $125, $1,250.00, 125.00 USD
    s = s.replace(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/g, '{{amount}}');
    s = s.replace(/\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\s*USD\b/g, '{{amount}}');

    // — Dates and times —
    s = s.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi, '{{appointment_date}}');
    s = s.replace(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g, '{{appointment_date}}');
    s = s.replace(/\b\d{1,2}:\d{2}\s*(?:AM|PM)(?:\s+[A-Z]{2,4}T)?\b/gi, '{{appointment_time}}');
    // Day-of-week tokens adjacent to a templated date are residual leaks — strip them.
    // Runs after date replacement so the placeholder is already present to anchor the match.
    const DOW = '(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)';
    // "Mon {{appointment_date}}" or "Monday, {{appointment_date}}"
    s = s.replace(new RegExp(`\\b${DOW}[,.]?\\s+(\\{\\{appointment_date\\}\\})`, 'gi'), '$1');
    // "{{appointment_date}} Mon" or "{{appointment_date}}, Monday"
    s = s.replace(new RegExp(`(\\{\\{appointment_date\\}\\})[,.]?\\s+${DOW}\\b`, 'gi'), '$1');

    // — Reporting periods — runs after full-date replacement so "January 15, 2024" is already gone —
    // Month + year only (e.g. "January 2024", "March 2025"): treat as a period reference.
    s = s.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g, '{{reporting_period}}');
    // Standalone capitalized month names. Case-sensitive (no `i` flag) to avoid false positives
    // on the auxiliary verb "may" and any lowercase occurrences that are not month references.
    s = s.replace(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\b/g, '{{reporting_month}}');
    // Quarter references: Q1, Q2, Q3/2024, Q4 2024
    s = s.replace(/\bQ[1-4](?:[/\s]\d{4})?\b/g, '{{reporting_period}}');

    // — Summary metrics — count + unit combos in prose (keyDetails rows are handled by LABEL_TO_PLACEHOLDER) —
    // avg miles per signing must run before plain miles to avoid partial match
    s = s.replace(/\b\d[\d,.]+\s+miles?\s+per\s+signing\b/gi, '{{avg_miles_per_signing}} miles per signing');
    s = s.replace(/\b\d[\d,]*\s+signings?\b/gi, '{{signings_count}} signings');
    s = s.replace(/\b\d[\d,]*\s+(?:orders?|completions?)\b/gi, '{{signings_count}} orders');
    s = s.replace(/\b\d[\d,]*\s+miles?\b/gi, '{{miles_driven}} miles');
    s = s.replace(/\b\d+\s+thumbs?\s+up\b/gi, '{{thumbs_up_count}} thumbs up');

    // — Addresses and locations —
    s = s.replace(/\d+\s+[\w\s.''-]+(?:Street|St|Drive|Dr|Lane|Ln|Avenue|Ave|Boulevard|Blvd|Road|Rd|Way|Court|Ct|Circle|Cir|Place|Pl)\.?[,\s][\w\s,]+\d{5}(?:-\d{4})?/gi, '{{appointment_location}}');

    // — Access URLs — instance-specific links in body prose or CTA text
    s = s.replace(/https?:\/\/[^\s"'<>[\]]+/g, '{{access_url}}');

    // — Company names — catch lender/company names in prose that weren't in keyDetails.
    // Matches 1–6 capitalized words followed by a common company-type suffix.
    // Runs last so known valueMap entries are already replaced and won't double-process.
    s = s.replace(
      /\b(?:[A-Z][A-Za-z0-9]*(?:\s+(?:[A-Z][A-Za-z0-9]*|&|and))*\s+)(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Bank|N\.A\.|Financial|Mortgage|Capital|Lending|Credit Union|Trust|Investments?|Advisors?|Solutions?|Group|Partners?)\b/g,
      '{{lender_name}}'
    );

    return s;
  }

  function templatizeBody(body) {
    if (!body) return body;
    return body.split('\n').map(templatizeLine).join('\n');
  }

  function templatizeRows(rows) {
    return (rows || []).map(row => {
      const key = LABEL_TO_PLACEHOLDER[(row.label || '').toLowerCase().trim()];
      return { ...row, value: key ? `{{${key}}}` : templatize(row.value) };
    });
  }

  return {
    ...data,
    subjectLine:    templatize(data.subjectLine),
    headline:       templatize(data.headline),
    summary:        templatize(data.summary),
    nextSteps:      data.nextSteps?.map(templatize) ?? null,
    keyDetails:     templatizeRows(data.keyDetails),
    messageText:    data.messageText != null ? '{{message_text}}' : null,
    lenderTeam:     data.lenderTeam ? templatizeRows(data.lenderTeam) : null,
    replyGuidance:  templatize(data.replyGuidance),
    capabilities:   templatizeBody(data.capabilities),
    closingInfo:    templatizeBody(data.closingInfo),
    timeline:       templatizeBody(data.timeline),
    reassurance:    templatize(data.reassurance),
    notes:          templatizeBody(data.notes),
    infoSections:   data.infoSections
      ? data.infoSections.map(s => ({ heading: s.heading, body: templatizeBody(s.body) }))
      : null,
    cta:            templatize(data.cta),
    rewrittenEmail: templatize(data.rewrittenEmail),
  };
}

// ─── HAML template generation ─────────────────────────────────────────────────

// Locked HAML for borrower_digital_closing_onboarding.
// Returns engineer-ready HAML with explicit named sections — not a generic renderer.
//
// Field shape contract (all parsed from Claude's string output by the Rails model):
//   @email.capabilities_items     → Array<String>        model: split bullet lines, strip intro + "• "
//   @email.closing_info_details   → Array<{label, value}> model: parse "• Label: value" lines
//   @email.timeline_steps         → Array<String>        model: split bullet lines, strip "• "
//   @email.security_note          → String               model: reassurance prose, excluding resource link line
//
// closingInfo + timeline are validated as required by the rewrite tool (runSectionValidation).
// HAML guards them defensively anyway in case validation is bypassed.
function generateBorrowerOnboardingHaml(data, templateMatch) {
  const L = [];
  const ln = (...lines) => L.push(...lines);

  ln(
    `-# Email template — auto-generated by Snapdocs Email Rewriter`,
    `-# Template:  ${templateMatch?.id ?? 'borrower_digital_closing_onboarding'}${templateMatch?.isNew ? ' (new candidate)' : ''}`,
    `-# Type:      onboarding`,
    `-# Recipient: borrower`,
    `-# Subject:   ${data.subjectLine || 'Welcome to your digital closing with {{lender_name}}'}`,
    `-#`,
    `-# Field shape contract — requires these model methods on Email:`,
    `-#   capabilities_items     → Array<String>         (bullet lines from capabilities, intro stripped)`,
    `-#   closing_info_details   → Array<{label:, value:}> (parsed from "• Label: value" lines in closing_info)`,
    `-#   timeline_steps         → Array<String>         (bullet lines from timeline, "• " stripped)`,
    `-#   security_note          → String                (reassurance prose, resource link line excluded)`,
    `-#`,
    `-# closing_info and timeline are required by template validation — guarded defensively here.`,
    ``,
    `.email-wrapper`,
    `  .email-header`,
    `    - if @email.logo_url.present?`,
    `      = image_tag @email.logo_url, alt: @email.lender_name, class: 'email-logo'`,
    ``,
    `  .email-body`,
    `    .email-chip.email-chip--onboarding Onboarding`,
    ``,
    `    %h1.email-headline= @email.headline`,
    ``,
    `    - if @email.summary.present?`,
    `      %p.email-summary= @email.summary`,
    ``,
    `    -# Locked section 1 — What you can do`,
    `    -# capabilities_items: intro line stripped, each "• item" becomes a list item`,
    `    - if @email.capabilities_items.present?`,
    `      .email-section`,
    `        %h2.section-label What you can do`,
    `        %ul.capabilities-list`,
    `          - @email.capabilities_items.each do |item|`,
    `            %li= item`,
    ``,
    `    -# Locked section 2 — Your closing information (required by template)`,
    `    -# closing_info_details: each "• Label: value" line parsed into {label:, value:}`,
    `    - if @email.closing_info_details.present?`,
    `      .email-section`,
    `        %h2.section-label Your closing information`,
    `        %dl.key-details`,
    `          - @email.closing_info_details.each do |detail|`,
    `            %dt= detail[:label]`,
    `            %dd= detail[:value]`,
    ``,
    `    -# Locked section 3 — Your closing timeline (required by template)`,
    `    -# timeline_steps: each "• step" line becomes a numbered list item`,
    `    - if @email.timeline_steps.present?`,
    `      .email-section`,
    `        %h2.section-label Your closing timeline`,
    `        %ol.timeline-steps`,
    `          - @email.timeline_steps.each do |step|`,
    `            %li= step`,
    ``,
    `    -# Locked section 4 — Is this secure?`,
    `    -# security_note: reassurance prose only (resource link line excluded from this field)`,
    `    -# Resource link is rendered explicitly below — not embedded in prose`,
    `    - if @email.security_note.present?`,
    `      .email-section`,
    `        %h2.section-label Is this secure?`,
    `        %p.section-body= @email.security_note`,
    `        %p.resource-link`,
    `          = link_to 'Learn more about digital closings', borrower_resource_center_url, class: 'inline-link'`,
    ``,
    `    %p.contact-guidance If you have questions, contact your lender.`,
    ``,
    `  .email-footer`,
    `    %p.powered-by Powered by Snapdocs`,
  );

  return L.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT STANDARDS: HAML
//
// generateHaml() must produce engineer-ready output that matches:
// - template structure
// - section order
// - CTA behavior
// - email type intent
//
// Rules:
// - do not render empty sections
// - action_required => CTA inside nextSteps when possible
// - informational => secondary CTA or none
// - message => preserve message section
// - use canonical section labels
//
// HAML should be the final structured representation of the matched template.
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// CTA RULES
//
// CTA behavior must match email intent:
//
// - action_required => primary CTA
// - status_update / update => secondary CTA or none
// - message => no CTA unless explicitly required by the template
// - navigational CTA => standalone outlined button
//
// Placement rules:
// - primary CTA should render inside nextSteps when present
// - otherwise inside keyDetails when present
// - otherwise as a bottom fallback
// - secondary CTA should render once only
//
// Preview, HTML, and HAML should follow the same CTA rules.
// ─────────────────────────────────────────────────────────────────────────────

function shouldRenderPrimaryCTA(data) {
  return data?.emailType === 'action_required' && !!data?.cta;
}

function shouldRenderSecondaryCTA(data) {
  return (data?.emailType === 'status_update' || data?.emailType === 'update') && !!data?.cta;
}

function shouldRenderNavigationalCTA(data) {
  return data?.ctaStyle === 'navigational' && !!data?.cta;
}

function shouldRenderMessageCTA(data) {
  return data?.emailType === 'message' && !!data?.cta;
}

function generateHaml(data, userType, templateMatch = null) {
  if (templateMatch?.id === 'borrower_digital_closing_onboarding') {
    return generateBorrowerOnboardingHaml(data, templateMatch);
  }
  const isPrimary = shouldRenderPrimaryCTA(data) || data.ctaStyle === 'primary';
  const isNavigational = shouldRenderNavigationalCTA(data);
  const isSecondary = shouldRenderSecondaryCTA(data) || data.ctaStyle === 'secondary';
  const isMessageWithCTA = shouldRenderMessageCTA(data);
  const isRON = /webcam\s+signing\s+appointment|remote\s+online\s+notary/i.test(
    [data.notes, data.summary, data.headline].filter(Boolean).join(' ')
  );
  const nextStepsLabel = isRON ? 'Before your appointment' : 'Next steps';
  const hasNextSteps = data.nextSteps?.length > 0;
  const hasKeyDetails = data.keyDetails?.length > 0;
  const hasInfoSections = data.infoSections?.length > 0;
  const isMessage = data.emailType === 'message' || !!data.messageText;

  // CTA placement mirrors frontend rendering logic
  const ctaInNextSteps  = isPrimary && !!data.cta && hasNextSteps;
  const ctaInKeyDetails = isPrimary && !!data.cta && !hasNextSteps && hasKeyDetails;
  const ctaAtBottom     = isPrimary && !!data.cta && !hasNextSteps && !hasKeyDetails;

  const L = []; // lines
  const ln = (...lines) => L.push(...lines);

  ln(
    `-# Email template — auto-generated by Snapdocs Email Rewriter`,
    templateMatch
      ? `-# Template:  ${templateMatch.id}${templateMatch.isNew ? ' (new candidate)' : ''}`
      : `-# Template:  (unmatched)`,
    `-# Type:      ${data.emailType}`,
    `-# Recipient: ${userType}`,
    `-# Subject:   ${data.subjectLine || '(none)'}`,
    ``,
    `.email-wrapper`,
    `  .email-header`,
    `    - if @email.logo_url.present?`,
    `      = image_tag @email.logo_url, alt: @email.lender_name, class: 'email-logo'`,
    ``,
    `  .email-body`,
    `    - if @email.email_type.present? && @email.cta_style != 'navigational'`,
    `      .email-chip{ class: "email-chip--\#{@email.email_type}" }`,
    `        = @email.email_type_label`,
    ``,
    `    %h1.email-headline= @email.headline`,
    ``,
    `    - if @email.summary.present?`,
    `      %p.email-summary= @email.summary`,
    ``,
  );

  if (isMessage) {
    ln(
      `    - if @email.message_text.present?`,
      `      .email-section.message-block`,
      `        %p.message-text= @email.message_text`,
      ``,
    );
  }

  // Next steps
  ln(
    `    - if @email.next_steps.present?`,
    `      .email-section`,
    `        %h2.section-label ${nextStepsLabel}`,
    `        %ul.next-steps`,
    `          - @email.next_steps.each do |step|`,
    `            %li= step`,
  );
  if (ctaInNextSteps) {
    ln(
      `        .cta-wrapper`,
      `          = link_to @email.cta_label, @email.cta_url, class: 'btn btn-primary'`,
    );
  }
  ln(``);

  // Key details
  ln(
    `    - if @email.key_details.present?`,
    `      .email-section`,
    `        %h2.section-label= @email.key_details_title`,
    `        %dl.key-details`,
    `          - @email.key_details.each do |detail|`,
    `            %dt= detail.label`,
    `            %dd= detail.value`,
  );
  if (ctaInKeyDetails) {
    ln(
      `        .cta-wrapper`,
      `          = link_to @email.cta_label, @email.cta_url, class: 'btn btn-primary'`,
    );
  }
  ln(``);

  // Lender team
  ln(
    `    - if @email.lender_team.present?`,
    `      .email-section`,
    `        %h2.section-label Lender team`,
    `        - @email.lender_team_groups.each do |group|`,
    `          .lender-contact`,
    `            - group.each do |member|`,
    `              %dl`,
    `                %dt= member.label`,
    `                %dd= member.value`,
    ``,
  );

  // Info sections
  if (hasInfoSections) {
    ln(
      `    - @email.info_sections.each_with_index do |section, i|`,
      `      .email-section`,
      `        %h2.section-label= section.heading`,
      `        %p.section-body= section.body`,
    );
    if (!isPrimary && data.cta) {
      ln(
        `        - if i == @email.info_sections.length - 1 && @email.cta_label.present?`,
        `          %a.section-link{ href: @email.cta_url }= @email.cta_label`,
      );
    }
    ln(``);
  } else {
    ln(
      `    -# No informational sections for this email type`,
      ``,
    );
  }

  // Contact guidance (borrower only — injected by template, not Claude)
  if (data.contactGuidance && CONTACT_GUIDANCE_TEXT[data.contactGuidance]) {
    ln(
      `    %p.contact-guidance= ${JSON.stringify(CONTACT_GUIDANCE_TEXT[data.contactGuidance])}`,
      ``,
    );
  }

  // Reply guidance
  ln(
    `    - if @email.reply_guidance.present?`,
    `      %p.reply-guidance= @email.reply_guidance`,
    ``,
  );

  // Bottom CTA fallback
  if (ctaAtBottom) {
    ln(
      `    - if @email.cta_label.present?`,
      `      .cta-wrapper`,
      `        = link_to @email.cta_label, @email.cta_url, class: 'btn btn-primary'`,
      ``,
    );
  }

  // Navigational CTA — standalone outlined button, always after all content
  if (isNavigational && data.cta) {
    ln(
      `    - if @email.cta_label.present?`,
      `      .cta-wrapper`,
      `        = link_to @email.cta_label, @email.cta_url, class: 'btn btn-secondary'`,
      ``,
    );
  }

  // Secondary standalone CTA — inline link, only when no info sections
  if (isSecondary && !isNavigational && data.cta && !hasInfoSections) {
    ln(
      `    - if @email.cta_label.present?`,
      `      %a.section-link{ href: @email.cta_url }= @email.cta_label`,
      ``,
    );
  }

  ln(
    `  .email-footer`,
    `    %p.powered-by Powered by Snapdocs`,
  );

  return L.join('\n');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delay revoke so the browser has time to start the download (required in Safari).
  setTimeout(() => URL.revokeObjectURL(url), 150);
}

function filenameSlug(subjectLine) {
  return (subjectLine || 'email')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'email';
}

// ─── Export panel ─────────────────────────────────────────────────────────────

function ExportPanel({ data, logoUrl, userType, templateMatch, anonMode, onAnonModeChange }) {
  const [copiedKey, setCopiedKey] = useState(null);

  // Wrap all render-time computations in try-catch.
  // Any generation error shows an informative message instead of crashing the React tree.
  let html, json, templateData, templateJson, haml, plainText, slug;
  let exportError = null;
  try {
    html = generateEmailHTML(data, logoUrl, userType);
    json = generateJSON(data);
    templateData = templateizeResult(data);
    const templateJsonObj = { ...JSON.parse(generateJSON(templateData)), ...(templateMatch ? { templateId: templateMatch.id } : {}) };
    templateJson = JSON.stringify(templateJsonObj, null, 2);
    haml = generateHaml(templateData, userType, templateMatch);
    plainText = data.rewrittenEmail || '';
    slug = filenameSlug(data.subjectLine);
  } catch (err) {
    exportError = err;
  }

  async function copyTo(text, key) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2500);
  }

  if (exportError) {
    return (
      <div className="export-panel">
        <div style={{ padding: '1rem', color: '#c0392b', background: '#fdecea', borderRadius: 6, margin: '1rem' }}>
          <strong>Export error:</strong> {exportError.message}
          <pre style={{ marginTop: '0.5rem', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>{exportError.stack}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="export-panel">
      <div className="export-meta">
        <span className={`badge badge--${data.emailType}`}>
          {EMAIL_TYPE_LABELS[data.emailType] ?? data.emailType}
        </span>
        <span className="export-subject">{data.subjectLine}</span>
        <label className="anon-toggle" style={{ marginLeft: 'auto', flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={!!anonMode}
            onChange={(e) => onAnonModeChange?.(e.target.checked)}
          />
          Anonymize PII
        </label>
      </div>
      {anonMode && (
        <div className="anon-banner" style={{ marginBottom: 0 }}>PII anonymized — safe for engineering handoff</div>
      )}

      <div className="export-actions-grid">
        <button className="export-btn export-btn--primary" onClick={() => copyTo(html, 'html')}>
          {copiedKey === 'html' ? 'Copied!' : 'Copy HTML'}
        </button>
        <button className="export-btn export-btn--primary" onClick={() => downloadFile(html, `${slug}.html`, 'text/html')}>
          Download HTML
        </button>
        <button className="export-btn" onClick={() => copyTo(plainText, 'text')}>
          {copiedKey === 'text' ? 'Copied!' : 'Copy plain text'}
        </button>
        <button className="export-btn" onClick={() => downloadFile(json, `${slug}.json`, 'application/json')}>
          Download JSON
        </button>
      </div>

      <div className="export-section">
        <div className="export-section-header">
          <span className="output-label">HAML template</span>
          <div className="export-section-actions">
            <button className="export-btn" onClick={() => copyTo(haml, 'haml')}>
              {copiedKey === 'haml' ? 'Copied!' : 'Copy HAML'}
            </button>
            <button className="export-btn" onClick={() => downloadFile(haml, `${slug}.haml`, 'text/plain')}>
              Download HAML
            </button>
          </div>
        </div>
        <pre className="export-code-block">{haml}</pre>
      </div>

      <div className="export-section">
        <div className="export-section-header">
          <span className="output-label">Template JSON</span>
          <div className="export-section-actions">
            <button className="export-btn" onClick={() => copyTo(templateJson, 'templateJson')}>
              {copiedKey === 'templateJson' ? 'Copied!' : 'Copy JSON'}
            </button>
            <button className="export-btn" onClick={() => downloadFile(templateJson, `${slug}-template.json`, 'application/json')}>
              Download JSON
            </button>
          </div>
        </div>
        <pre className="export-code-block">{templateJson}</pre>
      </div>

      <div className="export-section">
        <span className="output-label">HTML source</span>
        <pre className="export-code-block">{html}</pre>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const REQUIRES_ACTION_OPTIONS = [
  { value: 'auto', label: 'Auto', desc: 'Claude decides based on content' },
  { value: 'yes', label: 'Yes — action required', desc: 'Force action_required classification' },
  { value: 'no', label: 'No — FYI only', desc: 'Force status_update, no CTA' },
];

export default function App() {
  const [emailContent, setEmailContent] = useState('');
  const [userType, setUserType] = useState('borrower');
  const [requiresAction, setRequiresAction] = useState('auto');
  const [result, setResult] = useState(null);       // original AI output — never mutated
  const [edited, setEdited] = useState(null);        // mutable working copy
  const [isDirty, setIsDirty] = useState(false);     // user has edited since last generation
  const [complianceFresh, setComplianceFresh] = useState(false); // compliance reflects current edits
  const [recheckLoading, setRecheckLoading] = useState(false);
  const [previewMode, setPreviewMode] = useState('fields'); // 'fields' | 'preview' | 'template' | 'export'
  const [previewLogo, setPreviewLogo] = useState('');
  const [previewRealValues, setPreviewRealValues] = useState(false); // Preview uses placeholders by default
  const [anonMode, setAnonMode] = useState(false); // export-only anonymize toggle
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // Upload state
  const [uploadedFiles, setUploadedFiles] = useState([]); // [{id, name, text}]
  const [activeFileId, setActiveFileId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [fileError, setFileError] = useState(null);
  const fileInputRef = useRef(null);

  function readFiles(fileList) {
    const { valid, errors } = validateFiles(Array.from(fileList));
    if (errors.length) {
      setFileError(errors.join(' '));
      if (!valid.length) return;
    } else {
      setFileError(null);
    }

    valid.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = extractTextFromHTML(e.target.result);
        const entry = { id: nextFileId++, name: file.name, text };
        setUploadedFiles((prev) => {
          // Skip if same filename already loaded
          if (prev.some((f) => f.name === file.name)) return prev;
          return [...prev, entry];
        });
        // Auto-select first file loaded
        setActiveFileId((prev) => prev ?? entry.id);
        setEmailContent(text);
      };
      reader.readAsText(file);
    });
  }

  function handleFileSelect(entry) {
    setActiveFileId(entry.id);
    setEmailContent(entry.text);
  }

  function handleRemoveFile(id) {
    setUploadedFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (activeFileId === id) {
        const fallback = next[0] ?? null;
        setActiveFileId(fallback?.id ?? null);
        setEmailContent(fallback?.text ?? '');
      }
      return next;
    });
  }

  function handleDragOver(e) {
    e.preventDefault();
    setIsDragging(true);
  }

  function handleDragLeave(e) {
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    setIsDragging(false);
    readFiles(e.dataTransfer.files);
  }

  // ─────────────────────────────────────────────────────────────────────────────
// REWRITE FLOW
//
// Current flow:
// 1. send original email to /api/rewrite
// 2. receive structured result
// 3. sanitize audience-specific copy
// 4. classify template
// 5. apply template structure
// 6. validate structure
//
// The API may generate content, but this file enforces system rules.
// ─────────────────────────────────────────────────────────────────────────────

  async function handleRewrite() {
    if (!emailContent.trim()) {
      setError('Please paste an email to rewrite.');
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setCopied(false);

    try {
      const response = await fetch(`${API_BASE_URL}/api/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailContent, userType, requiresAction }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`);
      }

      const cleaned = sanitizeBorrowerResult(data.result, userType);
      setResult(cleaned);
      setEdited(structuredClone(cleaned));
      setIsDirty(false);
      setComplianceFresh(true);
    } catch (err) {
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function updateEdited(patch) {
    setEdited((prev) => ({ ...prev, ...patch }));
    setIsDirty(true);
    setComplianceFresh(false);
  }

  function updateNextStep(i, value) {
    const steps = [...(edited.nextSteps || [])];
    steps[i] = value;
    updateEdited({ nextSteps: steps });
  }

  function addNextStep() {
    updateEdited({ nextSteps: [...(edited.nextSteps || []), ''] });
  }

  function removeNextStep(i) {
    const steps = (edited.nextSteps || []).filter((_, idx) => idx !== i);
    updateEdited({ nextSteps: steps.length ? steps : null });
  }

  function updateKeyDetail(i, field, value) {
    const details = (edited.keyDetails || []).map((d, idx) =>
      idx === i ? { ...d, [field]: value } : d
    );
    updateEdited({ keyDetails: details });
  }

  function addKeyDetail() {
    updateEdited({ keyDetails: [...(edited.keyDetails || []), { label: '', value: '' }] });
  }

  function removeKeyDetail(i) {
    updateEdited({ keyDetails: (edited.keyDetails || []).filter((_, idx) => idx !== i) });
  }

  function updateLenderTeam(i, field, value) {
    const team = (edited.lenderTeam || []).map((d, idx) =>
      idx === i ? { ...d, [field]: value } : d
    );
    updateEdited({ lenderTeam: team });
  }

  function addLenderTeam() {
    updateEdited({ lenderTeam: [...(edited.lenderTeam || []), { label: '', value: '' }] });
  }

  function removeLenderTeam(i) {
    updateEdited({ lenderTeam: (edited.lenderTeam || []).filter((_, idx) => idx !== i) });
  }

  function handleReset() {
    setEdited(structuredClone(result));
    setIsDirty(false);
    setComplianceFresh(true);
  }

  async function handleRecheck() {
    setRecheckLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/compliance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: edited, userType, requiresAction, emailContent }),
      });
      if (response.ok) {
        const data = await response.json();
        setEdited((prev) => ({ ...prev, complianceCheck: data.complianceCheck }));
        setComplianceFresh(true);
      }
    } catch {
      // recheck failure is non-fatal
    } finally {
      setRecheckLoading(false);
    }
  }

  async function handleCopy() {
    if (!edited?.rewrittenEmail) return;
    let text = edited.rewrittenEmail;
    if (edited.replyGuidance && !text.includes(edited.replyGuidance)) {
      text = text.trimEnd() + '\n\n' + edited.replyGuidance;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  // Template classification and section assembly happen automatically at render time.
  // applyTemplate() builds infoSections from semantic slots + template schema.
  const templateMatch    = edited ? classifyTemplate(edited, userType) : null;
  const extractedFields  = edited ? extractFields(edited) : null;
  const withSections     = edited ? applyTemplate(edited, templateMatch) : null;
  // Section lock validation: required slots that Claude left empty, structural violations.
  const sectionIssues    = (edited && templateMatch && !templateMatch.isNew)
    ? runSectionValidation(edited, templateMatch)
    : [];

  // previewData: placeholder values by default; real values when the toggle is on.
  // This is what EmailPreview renders in the Preview tab.
  const previewData = withSections
    ? previewRealValues ? withSections : templateizeResult(withSections)
    : null;

  // displayData varies by tab:
  //   fields   → always real values (withSections), shown in the editable fields editor
  //   preview  → handled separately via previewData above
  //   template → slot values replaced with {{placeholders}} (templateizeResult)
  //   export   → real values, or anonymized if anonMode toggle is on
  const displayData = withSections
    ? previewMode === 'template'            ? templateizeResult(withSections)
    : previewMode === 'export' && anonMode  ? anonymizeResult(withSections)
    : withSections
    : null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-inner">
          <span className="logo-text">Snapdocs</span>
          <h1 className="header-title">Email Rewriter</h1>
        </div>
      </header>

      <main className="main-columns">
        {/* LEFT: Input panel */}
        <section className="panel panel-input" aria-label="Input panel">
          <div className="panel-header">
            <h2>Original email</h2>
          </div>
          <div className="panel-body">
            {/* Upload zone */}
            <div
              className={`upload-zone${isDragging ? ' dragging' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label="Upload HTML email files"
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".html,.htm"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => { readFiles(e.target.files); e.target.value = ''; }}
              />
              <span className="upload-icon" aria-hidden="true">↑</span>
              <span className="upload-text">Drop .html files here or <u>browse</u></span>
            </div>

            {fileError && (
              <div className="error-banner" role="alert">{fileError}</div>
            )}

            {uploadedFiles.length > 0 && (
              <ul className="file-list" aria-label="Uploaded files">
                {uploadedFiles.map((f) => (
                  <li
                    key={f.id}
                    className={`file-item${activeFileId === f.id ? ' active' : ''}`}
                  >
                    <button
                      className="file-item-name"
                      onClick={() => handleFileSelect(f)}
                      title={f.name}
                    >
                      {f.name}
                    </button>
                    <button
                      className="file-item-remove"
                      onClick={() => handleRemoveFile(f.id)}
                      aria-label={`Remove ${f.name}`}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label htmlFor="email-content" className="field-label">
              {uploadedFiles.length > 0 ? 'Extracted content (editable)' : 'Paste email content'}
            </label>
            <textarea
              id="email-content"
              className="email-textarea"
              value={emailContent}
              onChange={(e) => setEmailContent(e.target.value)}
              placeholder="Paste the original email content here..."
              rows={14}
              disabled={loading}
            />

            <fieldset className="user-type-group">
              <legend className="field-label">Recipient type</legend>
              <div className="user-type-options">
                {USER_TYPES.map((type) => (
                  <label
                    key={type.value}
                    className={`user-type-card${userType === type.value ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="userType"
                      value={type.value}
                      checked={userType === type.value}
                      onChange={() => setUserType(type.value)}
                      disabled={loading}
                    />
                    <span className="user-type-name">{type.label}</span>
                    <span className="user-type-desc">{type.desc}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="user-type-group">
              <legend className="field-label">Action required?</legend>
              <div className="action-required-options">
                {REQUIRES_ACTION_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`action-required-card${requiresAction === opt.value ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="requiresAction"
                      value={opt.value}
                      checked={requiresAction === opt.value}
                      onChange={() => setRequiresAction(opt.value)}
                      disabled={loading}
                    />
                    <span className="user-type-name">{opt.label}</span>
                    <span className="user-type-desc">{opt.desc}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {error && (
              <div className="error-banner" role="alert">
                {error}
              </div>
            )}

            <button
              className="rewrite-btn"
              onClick={handleRewrite}
              disabled={loading || !emailContent.trim()}
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Rewriting...
                </>
              ) : (
                'Rewrite email'
              )}
            </button>
          </div>
        </section>

        {/* RIGHT: Output panel */}
        <section className="panel panel-output" aria-label="Output panel">
          <div className="panel-header">
            <h2>Output</h2>
            {edited && (
              <div className="panel-header-actions">
                <div className="view-toggle" role="group" aria-label="View mode">
                  <button
                    className={`view-toggle-btn${previewMode === 'fields' ? ' active' : ''}`}
                    onClick={() => setPreviewMode('fields')}
                    title="Edit the structured fields extracted from the rewrite"
                  >Fields</button>
                  <button
                    className={`view-toggle-btn${previewMode === 'preview' ? ' active' : ''}`}
                    onClick={() => setPreviewMode('preview')}
                    title="Email rendered from the matched template with real field values"
                  >Preview</button>
                  <button
                    className={`view-toggle-btn${previewMode === 'template' ? ' active' : ''}`}
                    onClick={() => setPreviewMode('template')}
                    title="Inspect the underlying template structure — same template that drives Preview, with {{placeholders}}"
                  >Inspect</button>
                  <button
                    className={`view-toggle-btn${previewMode === 'export' ? ' active' : ''}`}
                    onClick={() => setPreviewMode('export')}
                    title="Download or copy the email for handoff"
                  >Export</button>
                </div>
                <button className="copy-btn" onClick={handleCopy} aria-label="Copy full email to clipboard">
                  {copied ? 'Copied!' : 'Copy full email'}
                </button>
              </div>
            )}
          </div>
          <div className="panel-body">
            {!edited && !loading && (
              <div className="output-placeholder">
                <p>Your rewritten email will appear here.</p>
              </div>
            )}

            {loading && (
              <div className="output-loading" aria-live="polite">
                <span className="spinner large" aria-hidden="true" />
                <p>Rewriting your email...</p>
              </div>
            )}

            {/* Template match is always shown once a rewrite has completed */}
            {edited && <TemplateMatchCard match={templateMatch} />}

            {/* PREVIEW tab — template rendered with placeholder values by default */}
            {edited && previewMode === 'preview' && (
              <>
                <div className="preview-source-note">
                  <span className="preview-source-label">Rendered from</span>
                  <span className="preview-source-template">
                    {templateMatch ? templateMatch.label : 'template'}
                  </span>
                  {!previewRealValues && (
                    <span className="preview-placeholder-badge">placeholder values</span>
                  )}
                  <label className="preview-real-toggle">
                    <input
                      type="checkbox"
                      checked={previewRealValues}
                      onChange={(e) => setPreviewRealValues(e.target.checked)}
                    />
                    Show real values
                  </label>
                </div>
                <div className="ep-logo-input-row">
                  <label className="ep-logo-input-label" htmlFor="preview-logo">
                    Lender logo URL
                    <span className="ep-logo-input-hint"> (optional)</span>
                  </label>
                  <input
                    id="preview-logo"
                    className="edit-input"
                    type="url"
                    placeholder="https://example.com/logo.png"
                    value={previewLogo}
                    onChange={(e) => setPreviewLogo(e.target.value)}
                  />
                </div>
                <EmailPreview data={previewData} logoUrl={previewLogo} userType={userType} />
              </>
            )}

            {/* INSPECT tab — same template that drives Preview, real values replaced with {{placeholders}} */}
            {edited && previewMode === 'template' && (
              <div className="template-tab-body">
                <div className="inspect-pipeline-note">
                  <span className="inspect-pipeline-icon" aria-hidden="true">⟶</span>
                  <span>This is the underlying template that drives <strong>Preview</strong> — same sections and order, real values replaced with <code>&#123;&#123;placeholders&#125;&#125;</code></span>
                </div>
                <div className="template-section-map">
                  <span className="output-label">Template sections</span>
                  {(templateMatch?.sections || DEFAULT_SECTIONS)
                    .filter(({ slot, text }) => text || displayData?.[slot])
                    .map(({ slot, label, text }) => (
                      <div key={slot} className="template-section-row">
                        <div className="template-section-header">
                          <span className="template-section-label">{label}</span>
                          <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                            {text && <span className="template-static-badge">static</span>}
                            <code className="template-section-slot">{slot}</code>
                          </div>
                        </div>
                        <pre className="template-section-content">{text || displayData[slot]}</pre>
                      </div>
                    ))}
                  {(templateMatch?.sections || DEFAULT_SECTIONS).filter(({ slot, text }) => text || displayData?.[slot]).length === 0 && (
                    <p className="edit-empty-note">No content slots populated for this template.</p>
                  )}
                </div>
              </div>
            )}

            {/* EXPORT tab — HAML / JSON / download, with optional anonymize toggle */}
            {edited && previewMode === 'export' && (
              <ExportPanel
                data={displayData}
                logoUrl={previewLogo}
                userType={userType}
                templateMatch={templateMatch}
                anonMode={anonMode}
                onAnonModeChange={setAnonMode}
              />
            )}

            {edited && previewMode === 'fields' && (
              <div className="output-result">

                {/* Dirty banner */}
                {isDirty && (
                  <div className="edit-dirty-banner">
                    <span className="edit-dirty-label">Unsaved edits</span>
                    <button className="edit-reset-btn" onClick={handleReset}>
                      Reset to AI version
                    </button>
                  </div>
                )}

                {/* Email type — read-only classification */}
                <div className="output-section">
                  <span className="output-label">Email type</span>
                  <div className="output-content">
                    <span className={`badge badge--${edited.emailType}`}>
                      {EMAIL_TYPE_LABELS[edited.emailType] ?? edited.emailType}
                    </span>
                  </div>
                </div>

                {/* Subject line */}
                <div className="output-section">
                  <label className="output-label" htmlFor="edit-subject">Subject line</label>
                  <input
                    id="edit-subject"
                    className="edit-input"
                    value={edited.subjectLine || ''}
                    onChange={(e) => updateEdited({ subjectLine: e.target.value })}
                  />
                </div>

                <div className="output-section">
                  <label className="output-label" htmlFor="edit-headline">Headline</label>
                  <input
                    id="edit-headline"
                    className="edit-input"
                    value={edited.headline || ''}
                    onChange={(e) => updateEdited({ headline: e.target.value })}
                  />
                </div>

                {/* Next steps */}
                <div className="output-section">
                  <span className="output-label">Next steps</span>
                  {edited.nextSteps && edited.nextSteps.length > 0 ? (
                    <ul className="edit-step-list">
                      {edited.nextSteps.map((step, i) => (
                        <li key={i} className="edit-step-item">
                          <input
                            className="edit-input"
                            value={step}
                            onChange={(e) => updateNextStep(i, e.target.value)}
                            placeholder={`Step ${i + 1}`}
                          />
                          <button
                            className="edit-remove-btn"
                            onClick={() => removeNextStep(i)}
                            aria-label="Remove step"
                          >×</button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="edit-empty-note">No next steps (FYI email)</p>
                  )}
                  <button className="edit-add-btn" onClick={addNextStep}>+ Add step</button>
                </div>

                {/* Key details */}
                <div className="output-section">
                  <span className="output-label">Key details</span>
                  <table className="edit-details-table">
                    <tbody>
                      {(edited.keyDetails || []).map((row, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              className="edit-input edit-detail-label"
                              value={row.label}
                              onChange={(e) => updateKeyDetail(i, 'label', e.target.value)}
                              placeholder="Label"
                            />
                          </td>
                          <td>
                            <input
                              className="edit-input"
                              value={row.value}
                              onChange={(e) => updateKeyDetail(i, 'value', e.target.value)}
                              placeholder="Value"
                            />
                          </td>
                          <td>
                            <button
                              className="edit-remove-btn"
                              onClick={() => removeKeyDetail(i)}
                              aria-label="Remove row"
                            >×</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button className="edit-add-btn" onClick={addKeyDetail}>+ Add row</button>
                </div>

                {/* Content sections (template-driven slots) */}
                {(templateMatch?.sections || DEFAULT_SECTIONS).map(({ slot, label, text }) => {
                  const val = edited[slot];
                  if (val == null && !text && !templateMatch?.sections) return null;
                  const renderedText = text
                    ? text.replace(/\{\{(\w+)\}\}/g, (_, key) => extractedFields?.[key] ?? `{{${key}}}`)
                    : null;
                  return (
                    <div className="output-section" key={slot}>
                      <label className="output-label" htmlFor={`edit-slot-${slot}`}>
                        {label}
                        {templateMatch?.sections && (
                          <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--n500)', marginLeft: '0.375rem' }}>
                            ({slot})
                          </span>
                        )}
                      </label>
                      {text ? (
                        <div className="slot-static-display">
                          <p className="slot-static-text">{renderedText}</p>
                          <p className="slot-static-note">Static template text — update the Lender field in Key details to change</p>
                        </div>
                      ) : (
                        <textarea
                          id={`edit-slot-${slot}`}
                          className="edit-textarea"
                          style={{ minHeight: '72px' }}
                          value={val || ''}
                          placeholder={val == null ? '(empty)' : ''}
                          onChange={(e) => updateEdited({ [slot]: e.target.value || null })}
                        />
                      )}
                    </div>
                  );
                })}

                {/* Message text — shown for message emails */}
                {(edited.emailType === 'message' || edited.messageText) && (
                  <div className="output-section">
                    <label className="output-label" htmlFor="edit-message-text">
                      Message <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(preserved as written)</span>
                    </label>
                    <textarea
                      id="edit-message-text"
                      className="edit-textarea"
                      rows={4}
                      value={edited.messageText || ''}
                      onChange={(e) => updateEdited({ messageText: e.target.value || null })}
                    />
                  </div>
                )}

                {/* Lender team — shown when present */}
                {(edited.lenderTeam && edited.lenderTeam.length > 0) && (
                  <div className="output-section">
                    <span className="output-label">Lender team</span>
                    <table className="edit-details-table">
                      <tbody>
                        {edited.lenderTeam.map((row, i) => (
                          <tr key={i}>
                            <td>
                              <input
                                className="edit-input edit-detail-label"
                                value={row.label}
                                onChange={(e) => updateLenderTeam(i, 'label', e.target.value)}
                                placeholder="Label"
                              />
                            </td>
                            <td>
                              <input
                                className="edit-input"
                                value={row.value}
                                onChange={(e) => updateLenderTeam(i, 'value', e.target.value)}
                                placeholder="Value"
                              />
                            </td>
                            <td>
                              <button
                                className="edit-remove-btn"
                                onClick={() => removeLenderTeam(i)}
                                aria-label="Remove row"
                              >×</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <button className="edit-add-btn" onClick={addLenderTeam}>+ Add row</button>
                  </div>
                )}

                {/* Reply guidance — shown for message emails */}
                {edited.replyGuidance != null && (
                  <div className="output-section">
                    <label className="output-label" htmlFor="edit-reply-guidance">Reply guidance</label>
                    <input
                      id="edit-reply-guidance"
                      className="edit-input"
                      value={edited.replyGuidance}
                      onChange={(e) => updateEdited({ replyGuidance: e.target.value })}
                    />
                  </div>
                )}

                {/* CTA */}
                <div className="output-section">
                  <label className="output-label" htmlFor="edit-cta">Call to action</label>
                  <input
                    id="edit-cta"
                    className="edit-input"
                    value={edited.cta || ''}
                    placeholder="e.g. Schedule signing"
                    onChange={(e) => updateEdited({ cta: e.target.value || null })}
                  />
                  <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.375rem' }}>
                    {[
                      { value: 'primary',      label: 'Primary' },
                      { value: 'navigational', label: 'Secondary' },
                      { value: 'secondary',    label: 'Link' },
                    ].map(({ value, label }) => (
                      <label key={value} style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', fontSize: '0.8125rem', color: 'var(--n700)', cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="ctaStyle"
                          value={value}
                          checked={(edited.ctaStyle ?? 'primary') === value}
                          onChange={() => updateEdited({ ctaStyle: value })}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Compliance */}
                {edited.complianceCheck && (
                  <div className={`compliance-check ${edited.complianceCheck.passed ? 'compliance-pass' : 'compliance-fail'}`}>
                    <div className="compliance-header">
                      <span className="compliance-label">
                        {edited.complianceCheck.passed
                          ? 'Compliance check passed'
                          : `Compliance check failed (${edited.complianceCheck.issues.length} issue${edited.complianceCheck.issues.length !== 1 ? 's' : ''})`}
                      </span>
                      <div className="compliance-actions">
                        {!complianceFresh && (
                          <span className="compliance-stale-note">Reflects original AI output</span>
                        )}
                        {isDirty && (
                          <button
                            className="compliance-recheck-btn"
                            onClick={handleRecheck}
                            disabled={recheckLoading}
                          >
                            {recheckLoading ? 'Checking…' : 'Recheck'}
                          </button>
                        )}
                      </div>
                    </div>
                    {!edited.complianceCheck.passed && (
                      <ul className="compliance-issues">
                        {edited.complianceCheck.issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Section lock validation */}
                {sectionIssues.length > 0 && (
                  <div className="compliance-check compliance-fail">
                    <div className="compliance-header">
                      <span className="compliance-label">
                        {`Section lock violation (${sectionIssues.length} issue${sectionIssues.length !== 1 ? 's' : ''})`}
                      </span>
                    </div>
                    <ul className="compliance-issues">
                      {sectionIssues.map((issue, i) => (
                        <li key={i}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

/*
NEW TEMPLATE CHECKLIST

1. Add entry to TEMPLATE_CATALOG
2. Add clear match() logic
3. Define sections in correct order
4. Add contactGuidance if needed
5. Mark required sections
6. Check runSectionValidation() behavior
7. Check Preview structure
8. Check Inspect placeholders
9. Check HTML export
10. Check HAML export
11. Update template-mapping.md
*/

/*
COPY RULE CHECKLIST

1. Subject line matches taxonomy
2. Headline reflects the real intent
3. Body explains what happened
4. Next action is clear
5. No duplicate guidance
6. Borrower support language only for borrowers
7. Message text preserved exactly for message emails
8. CTA verb matches intended action
*/