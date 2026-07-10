const assert = require('node:assert/strict');
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

test('search ranks exact city before interstate and C Level before Director', async () => {
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

  const result = await directory.search('fractional CMO in Melbourne');

  assert.equal(result.count, 3);
  assert.equal(result.cards[0].name, 'Casey CMO');
  assert.equal(result.cards[1].name, 'Dani Director');
  assert.equal(result.cards[2].name, 'Sam Sydney');
  assert.equal(Object.prototype.hasOwnProperty.call(result.cards[0], 'email'), false);
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
  const directory = new Directory({
    dataDir,
    notionToken: 'notion-secret',
    anthropicKey: '',
    fetch: async () => ({
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
    })
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
