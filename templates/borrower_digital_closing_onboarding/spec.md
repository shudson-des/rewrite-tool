# Template spec: borrower_digital_closing_onboarding

| | |
|---|---|
| **Template ID** | `borrower_digital_closing_onboarding` |
| **Type** | `onboarding` |
| **Recipient** | borrower |
| **Subject pattern** | Welcome to your digital closing with {{lender_name}} |
| **HAML generator** | `generateBorrowerOnboardingHaml()` in `frontend/src/App.jsx` |

This is a **locked template** — section labels, order, and structure are fixed. It is not a generic renderer. Do not use `@email.info_sections`, `@email.key_details_title`, or `reply_guidance` in this template.

---

## Section order (locked)

1. Logo
2. Chip — `Onboarding`
3. Headline
4. Summary (framing paragraph)
5. **What you can do** — capabilities list
6. **Your closing information** — structured key details
7. **Your closing timeline** — ordered step list
8. **Is this secure?** — security note + explicit resource link
9. Support guidance (hardcoded)
10. Footer

---

## Field shapes

### Fields Claude outputs (raw)

All content slots from Claude are **strings**, not arrays or structured objects. Parsing is required before rendering.

| Raw field (JSON) | Shape | Notes |
|---|---|---|
| `headline` | `String` | Used directly via `@email.headline` |
| `summary` | `String \| null` | Used directly via `@email.summary` |
| `capabilities` | `String` | Intro line + `• ` bullet lines. Needs parsing. |
| `closingInfo` | `String` | `• Label: value` bullet lines. Needs parsing. |
| `timeline` | `String` | `• ` bullet lines (steps). Needs parsing. |
| `reassurance` | `String` | Prose + embedded resource link text. Needs splitting. |

### Fields the HAML expects (parsed model accessors)

Four new model methods are required. None of these exist yet.

| HAML accessor | Returns | Source raw field | Required |
|---|---|---|---|
| `@email.capabilities_items` | `Array<String>` | `capabilities` | No — optional |
| `@email.closing_info_details` | `Array<{ label:, value: }>` | `closingInfo` | **Yes** — validated |
| `@email.timeline_steps` | `Array<String>` | `timeline` | **Yes** — validated |
| `@email.security_note` | `String` | `reassurance` | No — optional |

`closing_info` and `timeline` are validated as **required** by `runSectionValidation()` in the rewrite tool. The HAML guards them defensively with `.present?` in case validation was bypassed upstream.

---

## Ruby model methods

Add these to the `Email` model (or equivalent email object). They parse the raw string fields into the shapes the HAML expects.

```ruby
# Locked section 1 — What you can do
# Strips the intro line ("With this experience, you'll be able to:"),
# splits on newline, and returns the bullet items as plain strings.
def capabilities_items
  return [] unless capabilities.present?
  capabilities.split("\n")
              .map { |l| l.strip.sub(/^•\s*/, '') }
              .reject { |l| l.blank? || l.end_with?(':') }
end

# Locked section 2 — Your closing information
# Parses "• Label: value" lines into [{label:, value:}] hashes.
# Lines that don't match the pattern are silently dropped.
def closing_info_details
  return [] unless closing_info.present?
  closing_info.split("\n").filter_map do |line|
    m = line.strip.match(/^•\s*(.+?):\s*(.+)$/)
    { label: m[1].strip, value: m[2].strip } if m
  end
end

# Locked section 3 — Your closing timeline
# Strips "• " prefix from each line and returns the steps as plain strings.
def timeline_steps
  return [] unless timeline.present?
  timeline.split("\n")
          .map { |l| l.strip.sub(/^•\s*/, '') }
          .reject(&:blank?)
end

# Locked section 4 — Is this secure?
# Returns the reassurance prose only — excludes the "Borrower Resource Center"
# line, which is rendered as an explicit link_to in the HAML.
def security_note
  return nil unless reassurance.present?
  reassurance.split("\n")
             .reject { |l| l.match?(/Borrower Resource Center/i) }
             .join(' ').strip.presence
end
```

---

## Borrower Resource Center URL

The resource link in section 4 ("Is this secure?") is rendered as an explicit `link_to` in the HAML:

```haml
= link_to 'Learn more about digital closings', borrower_resource_center_url, class: 'inline-link'
```

**`borrower_resource_center_url` must exist before this template can render.**

### If the named route does not exist yet

Define a temporary constant and use it until the route is confirmed:

```ruby
# config/initializers/borrower_resource_center.rb
# (or app/helpers/email_helper.rb — wherever this template is rendered)
BORROWER_RESOURCE_CENTER_URL = 'https://snapdocs.com/borrower-resources'.freeze
```

Replace the `link_to` in the HAML with:

```haml
= link_to 'Learn more about digital closings', BORROWER_RESOURCE_CENTER_URL, class: 'inline-link'
```

Update to the named route (`borrower_resource_center_url`) once confirmed with the product/marketing team.

---

## HAML template

This is the static reference copy. The authoritative generated version comes from `generateBorrowerOnboardingHaml()` in `frontend/src/App.jsx` via the Export tab.

```haml
-# Email template — auto-generated by Snapdocs Email Rewriter
-# Template:  borrower_digital_closing_onboarding
-# Type:      onboarding
-# Recipient: borrower
-# Subject:   Welcome to your digital closing with {{lender_name}}
-#
-# Field shape contract — requires these model methods on Email:
-#   capabilities_items     → Array<String>           (bullet lines from capabilities, intro stripped)
-#   closing_info_details   → Array<{label:, value:}> (parsed from "• Label: value" lines in closing_info)
-#   timeline_steps         → Array<String>           (bullet lines from timeline, "• " stripped)
-#   security_note          → String                  (reassurance prose, resource link line excluded)
-#
-# closing_info and timeline are required by template validation — guarded defensively here.

.email-wrapper
  .email-header
    - if @email.logo_url.present?
      = image_tag @email.logo_url, alt: @email.lender_name, class: 'email-logo'

  .email-body
    .email-chip.email-chip--onboarding Onboarding

    %h1.email-headline= @email.headline

    - if @email.summary.present?
      %p.email-summary= @email.summary

    -# Locked section 1 — What you can do
    -# capabilities_items: intro line stripped, each "• item" becomes a list item
    - if @email.capabilities_items.present?
      .email-section
        %h2.section-label What you can do
        %ul.capabilities-list
          - @email.capabilities_items.each do |item|
            %li= item

    -# Locked section 2 — Your closing information (required by template)
    -# closing_info_details: each "• Label: value" line parsed into {label:, value:}
    - if @email.closing_info_details.present?
      .email-section
        %h2.section-label Your closing information
        %dl.key-details
          - @email.closing_info_details.each do |detail|
            %dt= detail[:label]
            %dd= detail[:value]

    -# Locked section 3 — Your closing timeline (required by template)
    -# timeline_steps: each "• step" line becomes a numbered list item
    - if @email.timeline_steps.present?
      .email-section
        %h2.section-label Your closing timeline
        %ol.timeline-steps
          - @email.timeline_steps.each do |step|
            %li= step

    -# Locked section 4 — Is this secure?
    -# security_note: reassurance prose only (resource link line excluded from this field)
    -# Resource link is rendered explicitly below — not embedded in prose
    - if @email.security_note.present?
      .email-section
        %h2.section-label Is this secure?
        %p.section-body= @email.security_note
        %p.resource-link
          = link_to 'Learn more about digital closings', borrower_resource_center_url, class: 'inline-link'

    %p.contact-guidance If you have questions, contact your lender.

  .email-footer
    %p.powered-by Powered by Snapdocs
```

---

## Validation

| Field | Enforced by | Behavior if missing |
|---|---|---|
| `closingInfo` / `closing_info_details` | `runSectionValidation()` in rewrite tool | Tool flags required section error before export |
| `timeline` / `timeline_steps` | `runSectionValidation()` in rewrite tool | Tool flags required section error before export |
| All other sections | `.present?` guard in HAML | Section is silently omitted |

---

## Excluded fields

These fields appear in the generic renderer but are **not rendered** in this template:

| Field | Reason |
|---|---|
| `next_steps` | Onboarding is not `action_required` — no steps block |
| `key_details` / `key_details_title` | Replaced by `closing_info_details` as a structured `dl` |
| `lender_team` | Not part of the locked onboarding structure |
| `reply_guidance` | No reply path in borrower onboarding |
| `info_sections` (generic loop) | Replaced by four explicit locked section accessors |

---

## Files in this handoff

| File | Status | Notes |
|---|---|---|
| `spec.md` | Ready | This file |
| `fields.json` | Ready | Machine-readable field contract for alignment |
| HAML (inline above) | Ready — pending one item | `borrower_resource_center_url` must be resolved before deploy |
| Ruby model methods (inline above) | Ready | Four new methods to add to `Email` model |
