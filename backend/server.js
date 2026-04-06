import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js';

const app = express();

app.use(cors({
  origin: [
    'http://localhost:5173',
    'https://rewrite-tool-nine.vercel.app'
  ]
}));
const port = process.env.PORT || 3001;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  baseURL: process.env.ANTHROPIC_BASE_URL,
});

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '50kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const WORKFLOW_INTERRUPTION_PATTERN = /\b(cancel(?:ed|ation)?|reschedul(?:e|ed|ing)|missing|not found|issue|error|fail(?:ed|ure)?|block(?:ed)?|unable|could not|cannot|problem|discrepan(?:cy|cies)|out of balance|incomplete|rejected|void(?:ed)?)\b/i;

// Extract <title> text from HTML email content, if present.
function extractHtmlTitle(content) {
  const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

// Parse a closing/file ID from a string.
// Matches: #00084384981, BC123456789, or bare long numeric IDs after common labels.
function extractClosingId(text) {
  const match = text.match(/#(\d{5,})|(?:^|[\s,])([A-Z]{1,3}\d{6,})(?:[\s,]|$)/);
  return match ? (match[1] || match[2]).trim() : null;
}

// Prepend extracted subject/title metadata to email content so the model
// can use it for subject line and closing ID generation.
function augmentEmailContent(content) {
  const title = extractHtmlTitle(content);
  const closingId = title ? extractClosingId(title) : extractClosingId(content);
  console.log('[augment] title found:', title);
  console.log('[augment] closingId found:', closingId);
  if (!title && !closingId) return content;
  const lines = [];
  if (title) lines.push(`[Email subject/title: ${title}]`);
  if (closingId) lines.push(`[Closing ID extracted from email: ${closingId}]`);
  return lines.join('\n') + '\n\n' + content;
}

function runComplianceCheck(result, userType, requiresAction, emailContent) {
  const issues = [];
  const isInterruption = WORKFLOW_INTERRUPTION_PATTERN.test(emailContent || '');

  // Signer/lender/settlement_agent in auto should not be status_update for workflow interruptions
  if (requiresAction === 'auto' && result.emailType === 'status_update' && isInterruption) {
    if (userType === 'signer') {
      issues.push("Possible regression: signer email classified as status_update, but content suggests a workflow interruption. Consider action_required.");
    } else if (userType === 'lender') {
      issues.push("Possible regression: lender email classified as status_update, but content suggests a workflow interruption. Consider action_required.");
    } else if (userType === 'settlement_agent') {
      issues.push("Possible regression: settlement_agent email classified as status_update, but content suggests a workflow interruption. Consider action_required.");
    }
  }

  // Notary defaulted to action_required under auto — flag only when no steps/CTA,
  // which indicates the model may have misfired rather than detecting a blocked state.
  if (userType === 'notary' && result.emailType === 'action_required' && requiresAction === 'auto') {
    const hasStepsAndCta = Array.isArray(result.nextSteps) && result.nextSteps.length > 0 && result.cta;
    if (!hasStepsAndCta) {
      issues.push("Notary classified as action_required but has no next steps or CTA — verify this is a blocked-state email.");
    }
  }

  // Settlement office should not be action_required under auto (unless blocked state)
  if (userType === 'settlement_office' && result.emailType === 'action_required' && requiresAction === 'auto') {
    const hasStepsAndCta = Array.isArray(result.nextSteps) && result.nextSteps.length > 0 && result.cta;
    if (!hasStepsAndCta) {
      issues.push("Settlement office classified as action_required but has no next steps or CTA — verify this is a blocked-state email.");
    }
  }

  // Message emails should have messageText
  if (result.emailType === 'message' && !result.messageText) {
    issues.push('Message email is missing messageText — the original comment or message text should be preserved verbatim.');
  }

  // Support emails must always be action_required
  if (userType === 'support' && result.emailType !== 'action_required' && requiresAction === 'auto') {
    issues.push("Support email should be action_required — support emails are always operational and action-oriented.");
  }

  // Status update should never have a CTA
  if (result.emailType === 'status_update' && result.cta) {
    issues.push("Status update includes a CTA — CTA should be null for FYI emails.");
  }

  // Status update should never have next steps
  if (result.emailType === 'status_update' && result.nextSteps && result.nextSteps.length > 0) {
    issues.push("Status update includes next steps — next steps should be null for FYI emails.");
  }

  // Action required must have a CTA
  if (result.emailType === 'action_required' && !result.cta) {
    issues.push("Action required email is missing a CTA.");
  }

  // Action required must have next steps
  if (result.emailType === 'action_required' && (!result.nextSteps || result.nextSteps.length === 0)) {
    issues.push("Action required email is missing next steps.");
  }

  // INVALID OUTPUT: subject line must include signer name when one is present in key details
  const subject = result.subjectLine || '';

  // Support subject must not use "Action required:" prefix
  if (userType === 'support' && /^action required/i.test(subject)) {
    issues.push('Support subject line should not start with "Action required" — describe the task or issue only.');
  }

  // Support headline must not start with "Action required"
  if (userType === 'support' && /^action required/i.test(result.headline || '')) {
    issues.push('Support headline should not repeat "Action required" — describe the task directly (e.g. "Review canceled signing").');
  }
  const signerDetail = (result.keyDetails || []).find(
    (d) => d.label?.toLowerCase() === 'signer'
  );
  if (subject && signerDetail?.value && !subject.includes(signerDetail.value)) {
    issues.push(`INVALID OUTPUT: signer name "${signerDetail.value}" is available but missing from subject line: "${subject}"`);
  }

  // Subject line must not contain disallowed terms
  if (/\bfile\b/i.test(subject)) {
    issues.push(`Subject contains disallowed word "file": "${subject}"`);
  }
  if (subject.includes('#')) {
    issues.push(`Subject contains disallowed character "#": "${subject}"`);
  }

  // Subject line length
  if (subject.length > 80) {
    issues.push(`Subject exceeds 80 characters (${subject.length}): "${subject}"`);
  }

  // Summary must not contain dates, times, addresses, or IDs
  const summary = result.summary || '';
  if (/\d{4}|\b\d{1,2}:\d{2}\b|\bAM\b|\bPM\b|\bCST\b|\bPST\b|\bEST\b|\bMST\b|\bStreet\b|\bSt\b|\bDrive\b|\bDr\b|\bLane\b|\bLn\b|\bAve\b|\bAvenue\b|\bBlvd\b/i.test(summary)) {
    issues.push("Summary contains specific data (date, time, or address) that should be in key details.");
  }

  // Summary must not use passive "has been canceled"
  if (/has been canceled/i.test(summary)) {
    issues.push('Use "was canceled" instead of "has been canceled" in summary.');
  }

  // Summary must not use "from you" phrasing
  if (/from you/i.test(summary)) {
    issues.push('Avoid "from you" phrasing — use "No action is required." not "No action is required from you."');
  }

  // Key details must not include a redundant Status field when headline already implies it
  const statusDetail = (result.keyDetails || []).find(
    (d) => d.label?.toLowerCase() === 'status'
  );
  if (statusDetail && /canceled|cancell/i.test(result.headline || '')) {
    issues.push(`Redundant "Status" field in key details — status is already implied by the headline.`);
  }

  // Body must not contain disallowed terms
  const body = result.rewrittenEmail || '';
  if (/\bfile number\b/i.test(body)) {
    issues.push('Body contains disallowed phrase "file number".');
  }
  if (/\bfile #/i.test(body)) {
    issues.push('Body contains disallowed phrase "file #".');
  }

  // Signer emails: prohibited role terms and duplicate contact guidance
  if (userType === 'signer') {
    const allBodyText = [result.notes, result.closingInfo, result.reassurance, result.summary, result.capabilities, result.timeline, body].filter(Boolean).join('\n');
    if (/\bloan officer\b/i.test(allBodyText)) {
      issues.push('Signer output contains prohibited term "loan officer" — use "lender" instead.');
    }
    if (/\bsettlement agent\b/i.test(allBodyText)) {
      issues.push('Signer output contains prohibited term "settlement agent" — use "settlement team" instead.');
    }
    const contactLineCount = (allBodyText.match(/\bif you have (?:any )?questions?\b/gi) || []).length;
    if (contactLineCount > 1) {
      issues.push(`Signer email contains ${contactLineCount} contact guidance lines — only one is allowed (injected by the template system).`);
    }
  }

  return { passed: issues.length === 0, issues };
}

app.post('/api/rewrite', async (req, res) => {
  const { emailContent, userType, requiresAction = 'auto' } = req.body;

  if (!emailContent || typeof emailContent !== 'string' || emailContent.trim().length === 0) {
    return res.status(400).json({ error: 'emailContent is required and must be a non-empty string.' });
  }
  if (!userType || !['signer', 'lender', 'settlement_agent', 'settlement_office', 'notary', 'support'].includes(userType)) {
    return res.status(400).json({ error: 'userType must be one of: signer, lender, settlement_agent, settlement_office, notary, support.' });
  }
  if (!['auto', 'yes', 'no'].includes(requiresAction)) {
    return res.status(400).json({ error: 'requiresAction must be one of: auto, yes, no.' });
  }
  if (emailContent.length > 10000) {
    return res.status(400).json({ error: 'emailContent must be under 10,000 characters.' });
  }

  try {
    const augmentedContent = augmentEmailContent(emailContent);
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildUserMessage(augmentedContent, userType, requiresAction),
        },
      ],
    });

    const rawText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Strip markdown code fences defensively
    const jsonString = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let result;
    try {
      result = JSON.parse(jsonString);
    } catch {
      console.error('JSON parse failed. Raw response:', rawText);
      return res.status(502).json({
        error: 'The AI returned an unexpected response format. Please try again.',
      });
    }

    const required = ['emailType', 'subjectLine', 'headline', 'rewrittenEmail'];
    const missing = required.filter((f) => !(f in result));
    if (missing.length > 0) {
      return res.status(502).json({
        error: `AI response was missing required fields: ${missing.join(', ')}.`,
      });
    }

    // Guardrails: enforce constraints the model may have ignored
    if (requiresAction === 'yes') {
      result.emailType = 'action_required';
      if (!result.nextSteps || result.nextSteps.length === 0) {
        result.nextSteps = ['Complete the required action to move this closing forward.'];
      }
      if (!result.cta) {
        result.cta = 'Review details';
      }
    } else if (requiresAction === 'no') {
      result.emailType = 'status_update';
      result.nextSteps = null;
      result.cta = null;
    } else if (userType === 'support') {
      // Support emails are always action_required in auto mode.
      result.emailType = 'action_required';
      if (!result.nextSteps || result.nextSteps.length === 0) {
        result.nextSteps = ['Review the details and take the appropriate action.'];
      }
      if (!result.cta) {
        result.cta = 'Review details';
      }
    } else if (userType === 'notary' || userType === 'settlement_office') {
      // Auto mode: these recipient types default to FYI unless the model
      // had a strong reason to classify as action_required or issue_error.
      // Exception: blocked-state emails must NOT be downgraded.
      // A reliable signal that the model genuinely detected a blocked state is
      // that it produced all three: action_required + nextSteps + cta.
      // Downgrading in that case would suppress the steps and CTA that are
      // required for the notary to recover.
      const isBlockedState =
        result.emailType === 'action_required' &&
        Array.isArray(result.nextSteps) && result.nextSteps.length > 0 &&
        result.cta;

      if (!isBlockedState) {
        if (result.emailType === 'action_required') {
          result.emailType = 'status_update';
        }
        if (result.emailType === 'status_update' || result.emailType === 'message') {
          result.nextSteps = null;
          result.cta = null;
        }
      }
    }

    // Strip disallowed no-action variants from summary
    if (result.summary) {
      result.summary = result.summary
        .replace(/\bNo action is required (from you|at this time|at this point)[.,]?\s*/gi, '')
        .trim();
      if (!result.summary) result.summary = null;
    }

    // Null out summary for simple status_update emails where it only restates
    // facts already visible in the headline and key details.
    const SIMPLE_STATUS_PATTERN = /^([\w\s]+ has been assigned|[\w\s]+ (is|has been) (scheduled|confirmed|linked|received|completed|assigned)|the signing appointment is scheduled)[.,]?\s*(the signing appointment is scheduled[.,]?)?$/i;
    if (
      result.emailType === 'status_update' &&
      result.summary &&
      SIMPLE_STATUS_PATTERN.test(result.summary.trim())
    ) {
      result.summary = null;
    }

    // Remove key detail rows whose value already appears in the subject line.
    // If this leaves keyDetails empty, set to empty array so the section is hidden.
    if (Array.isArray(result.keyDetails) && result.subjectLine) {
      result.keyDetails = result.keyDetails.filter(
        (row) => !result.subjectLine.includes(String(row.value ?? '').trim())
      );
    }

    // Strip trailing period from headline
    if (result.headline) {
      result.headline = result.headline.replace(/\.\s*$/, '');
    }

    // Normalise lender team rows — split any values the model combined with em dashes into
    // separate rows (e.g. "Loan Coordinator — email@lender.com" → two rows), then strip
    // any remaining leading/trailing em dashes.
    if (Array.isArray(result.lenderTeam)) {
      const expanded = [];
      for (const row of result.lenderTeam) {
        const val = String(row.value ?? '').trim();
        const parts = val.split(/\s*—\s*/).map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          // Model combined multiple fields — emit each as an unlabelled continuation row
          parts.forEach((part, i) => {
            expanded.push({ label: i === 0 ? row.label : '', value: part });
          });
        } else {
          expanded.push({ ...row, value: val.replace(/^\s*—\s*|\s*—\s*$/g, '').trim() });
        }
      }
      result.lenderTeam = expanded;
    }

    // Guardrail: remove support/contact guidance from all signer body fields.
    // The template system injects one canonical contact line at render time.
    // Any contact guidance Claude writes into body slots causes duplication.
    //
    // Predicate works on BOTH raw Claude output (pre-normalization) and normalized text,
    // catching: "loan officer", "settlement agent", "contact your ...", "reach out",
    // "if you have questions", and their common variants.
    //
    // Two-pass stripping per field:
    //   Pass 1 — line-level: remove lines that are entirely support guidance
    //   Pass 2 — sentence-level: within each remaining line, remove embedded support sentences
    // This handles bullet-format lines (each on their own line) AND prose paragraphs where
    // a contact sentence is embedded mid-paragraph on the same line as event copy.
    //
    // After stripping, remaining content is role-normalized (loan officer → lender, etc.)
    // to catch any role terms that appeared in non-contact contexts.
    if (userType === 'signer') {
      const isSupportGuidance = (s) => {
        const t = (s || '').trim().toLowerCase();
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

      const stripSupportGuidance = (text) => {
        if (!text || typeof text !== 'string') return text;
        // Always split into sentences within each line — never test the whole line.
        // Testing the full line drops valid preceding sentences when a support sentence
        // is embedded later on the same line (e.g. "Canceled. Contact your lender.").
        const cleaned = text
          .split('\n')
          .map(line => {
            if (!line.trim()) return line; // preserve blank lines
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

      for (const f of ['notes', 'closingInfo', 'reassurance', 'summary', 'capabilities', 'timeline', 'rewrittenEmail']) {
        if (result[f]) {
          result[f] = stripSupportGuidance(result[f]);
          if (result[f]) result[f] = normalizeRoles(result[f]);
        }
      }

      // Also normalize role terms in next steps (array field)
      if (Array.isArray(result.nextSteps)) {
        result.nextSteps = result.nextSteps
          .filter(step => !isSupportGuidance(step))
          .map(normalizeRoles);
        if (result.nextSteps.length === 0) result.nextSteps = null;
      }
    }

    // Guardrail: strip educational resource link CTAs from informational emails.
    // These must be embedded inline in infoSection body text, not in the cta field.
    const EDUCATIONAL_CTA = /\b(borrower resource center|resource center|learn more about|visit .{3,40} center|help center)\b/i;
    if (result.emailType === 'status_update' && result.cta && EDUCATIONAL_CTA.test(result.cta)) {
      result.cta = null;
    }

    // Guardrail: ensure replyGuidance is set for message emails.
    // Also treat emails with a messageText as message-type for guidance purposes,
    // in case the model misclassified the emailType.
    const isMessageEmail = result.emailType === 'message' || !!result.messageText;
    if (isMessageEmail && !result.replyGuidance) {
      result.replyGuidance = userType === 'signer'
        ? 'Reply directly to this email to send a message to your lender and settlement team, or log in to Snapdocs to respond.'
        : 'Reply directly to this email, or log in to Snapdocs to respond.';
    }
    if (!isMessageEmail) {
      result.replyGuidance = null;
    }

    // Guardrail: ensure ctaStyle is always set and valid.
    // Navigational CTAs (View closing, Open message) use 'navigational' — rendered as outlined button.
    // Primary CTAs (action_required) use 'primary' — rendered as solid button.
    // Secondary (inline text link) is reserved for rare supplementary cases.
    const NAVIGATIONAL_CTA = /^(view|open|go to)\b/i;
    if (!result.ctaStyle || !['primary', 'navigational', 'secondary'].includes(result.ctaStyle)) {
      if (result.emailType === 'message' || result.emailType === 'status_update') {
        result.ctaStyle = 'navigational';
      } else {
        result.ctaStyle = 'primary';
      }
    }
    // Upgrade: if Claude set secondary but the CTA verb is navigational, correct it.
    if (result.ctaStyle === 'secondary' && result.cta && NAVIGATIONAL_CTA.test(result.cta.trim())) {
      result.ctaStyle = 'navigational';
    }

    result.complianceCheck = runComplianceCheck(result, userType, requiresAction, emailContent);

    return res.json({ result });
  } catch (err) {
    console.error('Claude error:', {
      name: err.name,
      message: err.message,
      stack: err.stack,
      status: err.status,
      error: err.error,
      full: JSON.stringify(err, null, 2),
    });
    if (err instanceof Anthropic.APIError) {
      if (err.status === 401) {
        return res.status(500).json({ error: 'API key is invalid or missing.' });
      }
      if (err.status === 429) {
        return res.status(429).json({ error: 'Rate limit reached. Please wait a moment and try again.' });
      }
      return res.status(502).json({ error: 'Claude API error. Please try again.' });
    }
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// Compliance recheck — runs the same checks against an edited result object
app.post('/api/compliance', (req, res) => {
  const { result, userType, requiresAction = 'auto', emailContent = '' } = req.body;
  if (!result || !userType) {
    return res.status(400).json({ error: 'result and userType are required.' });
  }
  const complianceCheck = runComplianceCheck(result, userType, requiresAction, emailContent);
  return res.json({ complianceCheck });
});

app.listen(port, () => {
  console.log(`Snapdocs rewrite backend running on http://localhost:${port}`);
});
