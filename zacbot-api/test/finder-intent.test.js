const assert = require('node:assert/strict');
const test = require('node:test');
const { isFinderIntent } = require('../lib/finder-intent');
const { fallbackParseQuery, Directory } = require('../lib/directory');

const SHOULD_SEARCH = [
  // The two phrasings the launch post promised would work
  'find a fractional COO in Sydney',
  'someone senior in finance',
  // The message that exposed the gap
  'which members can help with PR?',
  'Which members can help with PR',
  'anyone in the community who does PR?',
  'who in FEC does public relations',
  'is there anyone here who does comms?',
  'do we have any fractional CFOs in Melbourne',
  'do you know any marketers in Brisbane',
  'looking for a fractional CMO',
  'need a CTO for a fintech client',
  'can you recommend a fractional CFO',
  'members who do HR work',
  'are there any members in Perth doing ops?',
  'connect me with a fractional head of sales',
  'is there a fractional CRO in the community',
  'anyone good at brand strategy in Melbourne?',
  'who should I talk to about fundraising',
];

const SHOULD_COACH = [
  'how do I price a fractional CMO engagement?',
  'can someone explain how fractional pricing works?',
  'help me write outbound copy for a SaaS CEO',
  'what is the difference between fractional and interim?',
  'how many days a week should a fractional CFO work?',
  'draft a LinkedIn post about my first 90 days as a fractional',
  'my client wants me full time, how do I say no?',
  'what should I charge as a fractional operator',
  'is PR worth doing for a fractional practice?',
  'thanks, that is really helpful',
  '',
];

test('finder intent fires for member-seeking questions', () => {
  for (const q of SHOULD_SEARCH) {
    assert.equal(isFinderIntent(q), true, `expected directory search for: "${q}"`);
  }
});

test('finder intent stays quiet for coaching questions', () => {
  for (const q of SHOULD_COACH) {
    assert.equal(isFinderIntent(q), false, `expected coaching for: "${q}"`);
  }
});

test('long pasted text does not trip the broad match', () => {
  const pasted = 'Hi team, someone in marketing sent this over. '.repeat(10);
  assert.ok(pasted.length > 300);
  assert.equal(isFinderIntent(pasted), false);
});

test('PR and comms queries map to the Marketing function in the fallback parser', () => {
  assert.deepEqual(fallbackParseQuery('which members can help with PR?').functions, ['Marketing']);
  assert.deepEqual(fallbackParseQuery('anyone who does comms in Sydney').functions, ['Marketing']);
  assert.deepEqual(fallbackParseQuery('public relations specialist').functions, ['Marketing']);
  assert.ok(fallbackParseQuery('anyone who does public relations?').keywords.includes('pr'));
});

test('short skill acronyms survive the fallback keyword filter', () => {
  const parsed = fallbackParseQuery('which members can help with PR?');
  assert.ok(parsed.keywords.includes('pr'), `keywords were ${JSON.stringify(parsed.keywords)}`);
  assert.ok(!parsed.keywords.includes('members'));
  assert.ok(!parsed.keywords.includes('help'));
});

test('a public relations query ranks the member whose bio says PR above a generic C Level marketer', async () => {
  const directory = new Directory({ anthropicKey: '' });
  const base = { functions: ['Marketing'], location: 'Auckland', region: 'APAC', linkedin: '', blurb: '' };
  directory.snapshot = {
    syncedAt: new Date().toISOString(),
    memberCount: 3,
    members: [
      { ...base, id: 'a', name: 'Alpha Generic', level: 'C Level', searchText: 'Alpha Generic C Level Marketing Auckland brand and growth marketer with proven product launches' },
      { ...base, id: 'b', name: 'Beta PR', level: 'VP', searchText: 'Beta PR VP Marketing Auckland specialist disciplines: sales, marketing, PR and brand' },
      { ...base, id: 'c', name: 'Gamma Comms', level: 'Manager', searchText: 'Gamma Comms Manager Marketing Auckland communications planner and brand strategist' },
    ]
  };
  const result = await directory.search('anyone who does public relations?');
  const names = result.cards.map(card => card.name);
  assert.equal(names[0], 'Beta PR', `ranking was ${JSON.stringify(names)}`);
  assert.equal(names[1], 'Gamma Comms', `ranking was ${JSON.stringify(names)}`);
  assert.equal(names[2], 'Alpha Generic', `ranking was ${JSON.stringify(names)}`);
});

test('non-string input is rejected', () => {
  assert.equal(isFinderIntent(null), false);
  assert.equal(isFinderIntent(undefined), false);
  assert.equal(isFinderIntent(42), false);
});
