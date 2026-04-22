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

app.use(cors({ origin: /^http:\/\/localhost:\d+$/ }));
app.use(express.json({ limit: '10mb' }));

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

const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

app.post('/api/rewrite', async (req, res) => {
  const { emailContent, imageData, imageMimeType, userType, requiresAction = 'auto' } = req.body;

  if (!userType || !['signer', 'lender', 'settlement_agent', 'settlement_office', 'notary', 'support'].includes(userType)) {
    return res.status(400).json({ error: 'userType must be one of: signer, lender, settlement_agent, settlement_office, notary, support.' });
  }
  if (!['auto', 'yes', 'no'].includes(requiresAction)) {
    return res.status(400).json({ error: 'requiresAction must be one of: auto, yes, no.' });
  }

  let resolvedContent = emailContent;

  if (imageData) {
    if (!imageMimeType || !IMAGE_MIME_TYPES.includes(imageMimeType)) {
      return res.status(400).json({ error: 'imageMimeType must be one of: image/png, image/jpeg, image/gif, image/webp.' });
    }
    try {
      const visionMessage = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: imageMimeType, data: imageData } },
            { type: 'text', text: 'This is a screenshot of an email. Extract all the text content exactly as it appears, preserving the structure. Output only the extracted email text, nothing else.' }
          ]
        }]
      });
      resolvedContent = visionMessage.content[0].text;
    } catch (err) {
      return res.status(500).json({ error: 'Failed to extract text from image.' });
    }
  }

  if (!resolvedContent || typeof resolvedContent !== 'string' || resolvedContent.trim().length === 0) {
    return res.status(400).json({ error: 'emailContent is required and must be a non-empty string.' });
  }
  if (resolvedContent.length > 10000) {
    return res.status(400).json({ error: 'emailContent must be under 10,000 characters.' });
  }

  try {
    const augmentedContent = augmentEmailContent(resolvedContent);

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

    const raw = message?.content?.[0]?.text;
    if (!raw) {
      return res.status(502).json({ error: 'Claude returned an empty response.' });
    }

    let result;
    try {
      result = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: 'Claude returned invalid JSON.' });
    }

    const required = ['emailType', 'subjectLine', 'headline', 'rewrittenEmail'];
    const missing = required.filter((f) => !(f in result));
    if (missing.length > 0) {
      return res.status(502).json({
        error: `AI response was missing required fields: ${missing.join(', ')}.`,
      });
    }

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
      result.emailType = 'action_required';
      if (!result.nextSteps || result.nextSteps.length === 0) {
        result.nextSteps = ['Review the details and take the appropriate action.'];
      }
      if (!result.cta) {
        result.cta = 'Review details';
      }
    } else if (userType === 'notary' || userType === 'settlement_office') {
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

    if (result.summary) {
      result.summary = result.summary
        .replace(/\bNo action is required (from you|at this time|at this point)[.,]?\s*/gi, '')
        .trim();
      if (!result.summary) result.summary = null;
    }

    const SIMPLE_STATUS_PATTERN = /^([\w\s]+ has been assigned|[\w\s]+ (is|has been) (scheduled|confirmed|linked|received|completed|assigned)|the signing appointment is scheduled)[.,]?\s*(the signing appointment is scheduled[.,]?)?$/i;
    if (
      result.emailType === 'status_update' &&
      result.summary &&
      SIMPLE_STATUS_PATTERN.test(result.summary.trim())
    ) {
      result.summary = null;
    }

    if (Array.isArray(result.keyDetails) && result.subjectLine) {
      result.keyDetails = result.keyDetails.filter(
        (row) => !result.subjectLine.includes(String(row.value ?? '').trim())
      );
    }

    if (result.headline) {
      result.headline = result.headline.replace(/\.\s*$/, '');
    }

    if (Array.isArray(result.lenderTeam)) {
      const expanded = [];
      for (const row of result.lenderTeam) {
        const val = String(row.value ?? '').trim();
        const parts = val.split(/\s*—\s*/).map(p => p.trim()).filter(Boolean);
        if (parts.length > 1) {
          parts.forEach((part, i) => {
            expanded.push({ label: i === 0 ? row.label : '', value: part });
          });
        } else {
          expanded.push({ ...row, value: val.replace(/^\s*—\s*|\s*—\s*$/g, '').trim() });
        }
      }
      result.lenderTeam = expanded;
    }

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

      for (const f of ['notes', 'closingInfo', 'reassurance', 'summary', 'capabilities', 'timeline', 'rewrittenEmail']) {
        if (result[f]) {
          result[f] = stripSupportGuidance(result[f]);
          if (result[f]) result[f] = normalizeRoles(result[f]);
        }
      }

      if (Array.isArray(result.nextSteps)) {
        result.nextSteps = result.nextSteps
          .filter(step => !isSupportGuidance(step))
          .map(normalizeRoles);
        if (result.nextSteps.length === 0) result.nextSteps = null;
      }
    }

    const EDUCATIONAL_CTA = /\b(borrower resource center|resource center|learn more about|visit .{3,40} center|help center)\b/i;
    if (result.emailType === 'status_update' && result.cta && EDUCATIONAL_CTA.test(result.cta)) {
      result.cta = null;
    }

    const isMessageEmail = result.emailType === 'message' || !!result.messageText;
    if (isMessageEmail && !result.replyGuidance) {
      result.replyGuidance = userType === 'signer'
        ? 'Reply directly to this email to send a message to your lender and settlement team, or log in to Snapdocs to respond.'
        : 'Reply directly to this email, or log in to Snapdocs to respond.';
    }
    if (!isMessageEmail) {
      result.replyGuidance = null;
    }

    const NAVIGATIONAL_CTA = /^(view|open|go to)\b/i;
    if (!result.ctaStyle || !['primary', 'navigational', 'secondary'].includes(result.ctaStyle)) {
      if (result.emailType === 'message' || result.emailType === 'status_update') {
        result.ctaStyle = 'navigational';
      } else {
        result.ctaStyle = 'primary';
      }
    }
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

    return res.status(500).json({ error: 'Unexpected server error. Please try again.' });
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
