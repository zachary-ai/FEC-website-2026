const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const { Directory, fallbackParseQuery } = require('../lib/directory');

test('fallback parser maps common executive roles to exact function values', () => {
  assert.deepEqual(fallbackParseQuery('need a fractional CRO in Sydney').functions, ['Sales']);
  assert.deepEqual(fallbackParseQuery('find a COO in Brisbane').functions, ['Operations (eg COO)']);
  assert.deepEqual(fallbackParseQuery('looking for a CTO').functions, ['Engineering (eg CTO)']);
});

test('search treats an explicit city as a hard filter and ranks C Level first', async () => {
  const directory = new Directory({ anthropicKey: '' });
  directory.snapshot = {
    syncedAt: new Date().toISOString(),
    memberCount: 3,
    members: [
      member('Dani Director', 'Director', 'Melbourne, VIC'),
      member('Casey CMO', 'C Level', 'Melbourne, VIC'),
      member('Sam Sydney', 'C Level', 'Sydney, NSW')
    ]
  };

  const result = await directory.search('fractional CMO in Melbourne', { limit: 10 });

  assert.equal(result.count, 2);
  assert.equal(result.totalCount, 2);
  assert.equal(result.shownCount, 2);
  assert.equal(result.cards.length, 2);
  assert.equal(result.cards[0].name, 'Casey CMO');
  assert.equal(result.cards[1].name, 'Dani Director');
  assert.equal(result.broaderCount, 1);
  assert.match(result.broaderSuggestion, /1 additional Marketing member.*outside Melbourne/i);
  assert.equal(result.cards.some(card => card.name === 'Sam Sydney'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.cards[0], 'email'), false);
});

test('search returns no cards when a city has no exact matches and offers broader results', async () => {
  const directory = new Directory({ anthropicKey: '' });
  directory.snapshot = {
    syncedAt: new Date().toISOString(),
    memberCount: 1,
    members: [member('Sam Sydney', 'C Level', 'Sydney, NSW')]
  };

  const result = await directory.search('fractional CMO in Melbourne');

  assert.equal(result.count, 0);
  assert.equal(result.cards.length, 0);
  assert.equal(result.broaderCount, 1);
  assert.match(result.suggestion, /No Marketing members matched Melbourne/i);
  assert.match(result.broaderSuggestion, /without a location/i);
});

test('fit notes are grounded in structured member data', async () => {
  const directory = new Directory({
    anthropicKey: 'unused-for-fit-notes',
    fetch: async () => {
      throw new Error('fit notes must not call the model');
    }
  });
  directory.snapshot = {
    syncedAt: new Date().toISOString(),
    memberCount: 1,
    members: [member('Casey CMO', 'C Level', 'Melbourne, VIC')]
  };

  const result = await directory.search('fractional CMO in Melbourne');

  assert.equal(result.cards[0].fitNote, 'C Level Marketing operator in Melbourne, VIC.');
});

test('loads a compressed snapshot from the Railway environment fallback', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fec-directory-'));
  const snapshot = {
    syncedAt: new Date().toISOString(),
    memberCount: 1,
    members: [member('Casey CMO', 'C Level', 'Melbourne, VIC')]
  };
  const snapshotGzipBase64 = zlib.gzipSync(JSON.stringify(snapshot)).toString('base64');
  const directory = new Directory({ dataDir, snapshotGzipBase64, anthropicKey: '' });

  const loaded = await directory.loadSnapshot();

  assert.equal(loaded.memberCount, 1);
  assert.equal(loaded.members[0].name, 'Casey CMO');
});

test('sync strips email/rates and excludes opt-out, test, and non-public records', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fec-directory-'));
  let notionRequest;
  const directory = new Directory({
    dataDir,
    notionToken: 'notion-secret',
    anthropicKey: '',
    fetch: async (url, options) => {
      notionRequest = { url, options };
      return {
        ok: true,
        json: async () => ({
          has_more: false,
          results: [
            notionPage({
              firstName: 'Alex',
              lastName: 'Active',
              directory: '',
              linkedin: 'linkedin.com/in/alex',
              bio: 'Growth leader. Contact alex@example.com. Rates $2,000/day.'
            }),
            notionPage({ firstName: 'Olivia', lastName: 'Optout', directory: 'Opted out', linkedin: 'https://linkedin.com/in/olivia', bio: 'Finance leader.' }),
            notionPage({ firstName: 'Zac', lastName: 'Sequence Test', directory: '', linkedin: 'https://linkedin.com/in/test', bio: 'Test record.' }),
            notionPage({ firstName: 'No', lastName: 'Public', directory: '', linkedin: '', bio: '' })
          ]
        })
      };
    }
  });

  const snapshot = await directory.sync();
  const rawSnapshot = await fs.readFile(path.join(dataDir, 'members.json'), 'utf8');

  assert.equal(snapshot.memberCount, 1);
  assert.equal(snapshot.members[0].name, 'Alex Active');
  assert.match(snapshot.members[0].linkedin, /^https:\/\/linkedin\.com/);
  assert.doesNotMatch(rawSnapshot, /email/i);
  assert.doesNotMatch(rawSnapshot, /alex@example\.com/);
  assert.doesNotMatch(rawSnapshot, /\$2,000/);
  assert.equal(snapshot.excluded.optedOut, 1);
  assert.equal(snapshot.excluded.test, 1);
  assert.equal(snapshot.excluded.missingPublicProfile, 1);
  assert.equal(notionRequest.url, 'https://api.notion.com/v1/data_sources/2e8752a1921080b7ad4f000bc493c86e/query');
  assert.equal(notionRequest.options.headers['Notion-Version'], '2025-09-03');
});

test('sync reuses a bundled snapshot blurb for an unchanged profile', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fec-directory-'));
  const bio = 'Growth leader for B2B companies.';
  const bioHash = crypto.createHash('sha256').update(bio).digest('hex');
  let requestCount = 0;
  const directory = new Directory({
    dataDir,
    notionToken: 'notion-secret',
    anthropicKey: 'anthropic-secret',
    fetch: async url => {
      requestCount += 1;
      assert.match(url, /api\.notion\.com/);
      return {
        ok: true,
        json: async () => ({
          has_more: false,
          results: [
            notionPage({
              firstName: 'Alex',
              lastName: 'Active',
              directory: '',
              linkedin: 'https://linkedin.com/in/alex',
              bio
            })
          ]
        })
      };
    }
  });
  directory.snapshot = {
    syncedAt: '2026-07-10T00:00:00.000Z',
    memberCount: 1,
    members: [{
      ...member('Alex Active', 'C Level', 'Melbourne, VIC'),
      bioHash,
      blurb: 'Existing grounded blurb.'
    }]
  };

  const snapshot = await directory.sync();

  assert.equal(requestCount, 1);
  assert.equal(snapshot.members[0].blurb, 'Existing grounded blurb.');
});

function member(name, level, location) {
  return {
    id: name,
    name,
    functions: ['Marketing'],
    level,
    location,
    region: 'APAC',
    linkedin: 'https://linkedin.com/in/' + name.toLowerCase().replace(/\W+/g, '-'),
    blurb: 'Marketing leader for B2B companies.',
    searchText: `${name} Marketing ${level} ${location} APAC Marketing leader for B2B companies.`
  };
}

function notionPage({ firstName, lastName, directory, linkedin, bio }) {
  return {
    id: `${firstName}-${lastName}`,
    properties: {
      'First Name': { type: 'title', title: [{ plain_text: firstName }] },
      'Last Name': { type: 'rich_text', rich_text: [{ plain_text: lastName }] },
      Status: { type: 'status', status: { name: 'Active' } },
      Directory: directory ? { type: 'select', select: { name: directory } } : { type: 'select', select: null },
      Function: { type: 'multi_select', multi_select: [{ name: 'Marketing' }] },
      Level: { type: 'select', select: { name: 'C Level' } },
      Location: { type: 'rich_text', rich_text: [{ plain_text: 'Melbourne, VIC' }] },
      Region: { type: 'select', select: { name: 'APAC' } },
      Linkedin: { type: 'url', url: linkedin },
      'Elevator Pitch Bio': { type: 'rich_text', rich_text: bio ? [{ plain_text: bio }] : [] },
      Email: { type: 'email', email: `${firstName.toLowerCase()}@example.com` }
    }
  };
}
