// Decides whether a chat message is really a "find me a person" request that
// should hit the member directory instead of the coaching model.
//
// Two signals must both be present for the broad match: a phrase that is
// unambiguously about seeking a person, and a role/function/skill word. Either
// alone is not enough, so "can someone explain fractional pricing" stays with
// the coach while "someone senior in finance" goes to the directory.

const LEGACY_PATTERN = /\b(find|looking for|need|recommend|know)\b.{0,80}\b(fractional|cmo|cfo|coo|cto|cro|vp sales|operator|exec|executive)\b/i;

const SEEKING_PATTERN = new RegExp(
  '\\b(' + [
    'who (?:in|from|at|here|does|do|can|else|has|is|are)',
    'which (?:fec )?members?',
    'any (?:fec )?members?',
    'members? (?:who|that|which|in|from|with|doing|do|does|can)',
    'anyone (?:in|from|at|here|who|that|with|doing|do|does|can|else|know|good|senior|experienced)',
    'someone (?:in|from|at|here|who|that|with|doing|do|does|can|senior|experienced|good|for|to)',
    'somebody (?:in|from|at|here|who|that|with|doing|do|does|can|senior|experienced|good|for|to)',
    'is there (?:a|an|any|someone|anyone|somebody)',
    'are there (?:any|members|people|fractionals)',
    'do (?:we|you) have (?:a|an|any|someone|anyone|somebody|members)',
    'got (?:a|an|any|someone|anyone)',
    'have (?:a|an|any|someone|anyone) (?:in|who|that|with|for)',
    'looking for (?:a|an|some|someone|anyone|somebody|members)',
    'find (?:me )?(?:a|an|some|someone|anyone|somebody|members)',
    'recommend(?:ation)?s? (?:a|an|for|me|someone|anyone|any)',
    'connect me',
    'intro(?:duce|duction)?s? (?:me|to)',
    'point me (?:to|at)',
    'know (?:of )?(?:a|an|any|someone|anyone|somebody)',
    'need (?:a|an|some|someone|anyone|somebody)',
    'who (?:should|could|can|would) i (?:talk|speak|reach out) to',
    'help (?:me )?(?:with|on) .{0,40}\\b(?:who|anyone|someone|members?)',
  ].join('|') + ')\\b',
  'i'
);

const ROLE_PATTERN = new RegExp(
  '\\b(' + [
    'fractionals?', 'interim', 'portfolio',
    'cmo', 'cfo', 'coo', 'cto', 'cro', 'cpo', 'chro', 'cio', 'ciso', 'cco', 'cxo',
    'vp', 'vice president', 'head of', 'directors?', 'gm', 'general manager',
    'operators?', 'execs?', 'executives?', 'leaders?', 'advisors?', 'consultants?', 'specialists?', 'experts?',
    'marketing', 'marketers?', 'growth', 'brand(?:ing)?', 'demand gen(?:eration)?', 'content', 'seo', 'paid media',
    'pr', 'comms', 'communications?', 'public relations', 'media relations', 'publicity', 'publicist',
    'sales', 'revenue', 'gtm', 'go[- ]to[- ]market', 'bd', 'business development', 'partnerships?', 'revops', 'sales ops',
    'finance', 'financial', 'accounting', 'fp&a', 'capital', 'fundraising',
    'operations?', 'ops', 'supply chain', 'logistics', 'delivery',
    'product', 'ux', 'design(?:ers?)?', 'engineering', 'engineers?', 'tech(?:nology|nical)?', 'it', 'data', 'ai', 'automation', 'security',
    'hr', 'people(?: and| &)? culture', 'people ops', 'talent', 'recruit(?:ing|ment|er)?',
    'legal', 'lawyers?', 'counsel', 'compliance', 'governance', 'risk',
    'customer (?:success|experience|support)', 'cx', 'cs', 'account management',
    'strategy', 'transformation', 'change management', 'program(?:me)? management', 'project management',
  ].join('|') + ')\\b',
  'i'
);

// Long pasted content (emails, job ads, bios) can trip the broad match by
// accident. The legacy pattern is kept without a length cap so nothing that
// used to route to the directory stops doing so.
const MAX_BROAD_MATCH_LENGTH = 300;

function isFinderIntent(text) {
  if (typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (LEGACY_PATTERN.test(trimmed)) return true;
  if (trimmed.length > MAX_BROAD_MATCH_LENGTH) return false;
  return SEEKING_PATTERN.test(trimmed) && ROLE_PATTERN.test(trimmed);
}

module.exports = { isFinderIntent, LEGACY_PATTERN, SEEKING_PATTERN, ROLE_PATTERN };
