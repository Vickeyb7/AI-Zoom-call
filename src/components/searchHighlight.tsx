import React from 'react';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function matchesSearchTerms(query: string, fields: (string | undefined | null)[]): boolean {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) return true;
  const terms = cleaned.split(/\s+/).filter(Boolean);
  const haystack = fields.filter(Boolean).join(' ').toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function renderHighlightedText(text: string, query: string): React.ReactNode {
  const cleaned = query.trim();
  if (!cleaned || !text) return text;
  const terms = Array.from(new Set(cleaned.split(/\s+/).filter(Boolean)));
  if (terms.length === 0) return text;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  const parts = text.split(pattern);
  if (parts.length <= 1) return text;

  const lowerTerms = new Set(terms.map((t) => t.toLowerCase()));
  return parts.map((part, idx) =>
    lowerTerms.has(part.toLowerCase()) ? (
      <mark key={idx} className="bg-amber-100 text-slate-900 rounded-xs px-0.5">
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    ),
  );
}
