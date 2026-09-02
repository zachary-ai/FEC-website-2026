const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const zlib = require('node:zlib');

const FUNCTIONS = [
  'Marketing',
  'Sales',
  'Operations (eg COO)',
  'Finance',
  'Engineering (eg CTO)',
  'Product',
  'Customer',
  'General Management',
  'HR',
  'Legal',
  'Design'
];

const LEVEL_RANK = {
  'C Level': 0,
  VP: 1,
  Director: 2,
  Manager: 3
};

const ROLE_PATTERNS = [
  { pattern: /\b(cmo|marketing|growth|brand|demand gen|performance|pr|comms|communications?|public relations|media relations|publicist)\b/i, functions: ['Marketing'] },
  { pattern: /\b(coo|operations?|operator|ops)\b/i, functions: ['Operations (eg COO)'] },
  { pattern: /\b(cfo|finance|financial|commercial finance)\b/i, functions: ['Finance'] },
  { pattern: /\b(cto|engineering|engineer|technical|technology|tech)\b/i, functions: ['Engineering (eg CTO)'] },
  { pattern: /\b(sales|revenue|cro|gtm|go[- ]?to[- ]?market|vp sales)\b/i, functions: ['Sales'] },
  { pattern: /\b(product|cpo|product leader|product manager)\b/i, functions: ['Product'] },
  { pattern: /\b(hr|people|talent|culture)\b/i, functions: ['HR'] },
  { pattern: /\b(customer success|customer|cx|support)\b/i, functions: ['Customer'] },
  { pattern: /\b(ceo|general manager|general management|managing director)\b/i, functions: ['General Management'] },
  { pattern: /\b(legal|lawyer|counsel)\b/i, functions: ['Legal'] },
  { pattern: /\b(design|creative|ux|ui)\b/i, functions: ['Design'] }
];

const LOCATION_PATTERNS = [
  { key: 'melbourne', city: 'Melbourne', state: 'Victoria', country: 'Australia', region: 'APAC', terms: ['melbourne', 'vic', 'victoria'] },
  { key: 'sydney', city: 'Sydney', state: 'NSW', country: 'Australia', region: 'APAC', terms: ['sydney', 'nsw', 'new south wales'] },
  { key: 'brisbane', city: 'Brisbane', state: 'Queensland', country: 'Australia', region: 'APAC', terms: ['brisbane', 'qld', 'queensland', 'sunshine coast', 'gold coast'] },
  { key: 'perth', city: 'Perth', state: 'Western Australia', country: 'Australia', region: 'APAC', terms: ['perth', 'western australia', 'wa'] },
  { key: 'adelaide', city: 'Adelaide', state: 'South Australia', country: 'Australia', region: 'APAC', terms: ['adelaide', 'south australia', 'sa'] },
  { key: 'canberra', city: 'Canberra', state: 'ACT', country: 'Australia', region: 'APAC', terms: ['canberra', 'act'] },
  { key: 'australia', city: null, state: null, country: 'Australia', region: 'APAC', terms: ['australia', 'australian', 'aus'] },
  { key: 'new-zealand', city: null, state: null, country: 'New Zealand', region: 'APAC', terms: ['new zealand', 'nz', 'auckland', 'wellington'] },
  { key: 'apac', city: null, state: null, country: null, region: 'APAC', terms: ['apac', 'asia pacific'] },
  { key: 'uk', city: null, state: null, country: 'United Kingdom', region: 'EU', terms: ['uk', 'united kingdom', 'london', 'england', 'britain'] },
  { key: 'usa', city: null, state: null, country: 'United States', region: 'Americas', terms: ['usa', 'us', 'united states', 'america'] }
];

class DirectoryUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DirectoryUnavailableError';
  }
}

class Directory {
  constructor(options = {}) {
    this.dataDir = options.dataDir || process.env.DIRECTORY_DATA_DIR || path.join(__dirname, '..', 'data');
    this.snapshotPath = path.join(this.dataDir, 'members.json');
    this.blurbCachePath = path.join(this.dataDir, 'blurbs.json');
    const snapshotChunks = [1, 2, 3, 4]
      .map(index => process.env[`DIRECTORY_SNAPSHOT_GZIP_BASE64_${index}`] || '')
      .join('');
    this.snapshotGzipBase64 = options.snapshotGzipBase64 || process.env.DIRECTORY_SNAPSHOT_GZIP_BASE64 || snapshotChunks;
    this.notionToken = options.notionToken || process.env.NOTION_TOKEN || '';
    this.notionDataSourceId = options.notionDataSourceId
      || options.notionDatabaseId
      || process.env.NOTION_DATA_SOURCE_ID
      || process.env.NOTION_DATABASE_ID
      || '2e8752a1921080b7ad4f000bc493c86e';
    this.notionVersion = options.notionVersion || process.env.NOTION_VERSION || '2025-09-03';
    this.anthropicKey = options.anthropicKey || process.env.ANTHROPIC_API_KEY || '';
    this.anthropicModel = options.anthropicModel || process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
    this.fetch = options.fetch || global.fetch;
    this.sendSlack = options.sendSlack || null;
    this.snapshot = null;
    this.blurbCache = {};
  }

  configure(options = {}) {
    if (options.sendSlack) this.sendSlack = options.sendSlack;
    if (options.fetch) this.fetch = options.fetch;
  }

  async loadSnapshot() {
    try {
      const raw = await fs.readFile(this.snapshotPath, 'utf8');
      this.snapshot = JSON.parse(raw);
      await this.loadBlurbCache();
      return this.snapshot;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (!this.snapshotGzipBase64) {
        this.snapshot = null;
        return null;
      }

      const compressed = Buffer.from(this.snapshotGzipBase64, 'base64');
      const raw = zlib.gunzipSync(compressed).toString('utf8');
      this.snapshot = JSON.parse(raw);
      return this.snapshot;
    }
  }

  async loadBlurbCache() {
    try {
      this.blurbCache = JSON.parse(await fs.readFile(this.blurbCachePath, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.blurbCache = {};
    }
  }

  hasSnapshot() {
    return Boolean(this.snapshot && Array.isArray(this.snapshot.members));
  }

  async ensureSnapshot() {
    if (this.hasSnapshot()) return this.snapshot;
    const loaded = await this.loadSnapshot();
    if (loaded) return loaded;
    throw new DirectoryUnavailableError('Directory is warming up - try again in a minute.');
  }

  async sync() {
    if (!this.notionToken) {
      throw new Error('NOTION_TOKEN is required for directory sync.');
    }
    if (!this.fetch) {
      throw new Error('fetch is not available in this Node runtime.');
    }

    await this.loadBlurbCache();
    // Railway boots from the bundled snapshot, while blurbs.json is not present
    // in the deployed image. Seed the cache from that snapshot so unchanged
    // profiles do not require a fresh Anthropic call on every deployment.
    if (this.hasSnapshot()) {
      for (const member of this.snapshot.members) {
        if (member.bioHash && member.blurb && !this.blurbCache[member.bioHash]) {
          this.blurbCache[member.bioHash] = member.blurb;
        }
      }
    }
    const pages = await this.fetchActiveNotionPages();
    const members = [];
    const excluded = { optedOut: 0, test: 0, missingPublicProfile: 0, inactive: 0 };
    const previousMembersById = new Map(
      this.hasSnapshot() ? this.snapshot.members.map(member => [member.id, member]) : []
    );
    const previousMembersByLinkedin = new Map(
      this.hasSnapshot()
        ? this.snapshot.members.filter(member => member.linkedin).map(member => [normaliseUrl(member.linkedin), member])
        : []
    );
    const previousMembersByName = new Map(
      this.hasSnapshot()
        ? this.snapshot.members.filter(member => member.name).map(member => [member.name.toLowerCase(), member])
        : []
    );
    const snapshotSyncedAtMs = Date.parse(this.snapshot?.syncedAt || '');

    for (const page of pages) {
      const mapped = this.mapNotionPage(page);
      if (!mapped) {
        excluded.inactive += 1;
        continue;
      }
      if (mapped.directoryOptOut) {
        excluded.optedOut += 1;
        continue;
      }
      if (/test/i.test(mapped.name)) {
        excluded.test += 1;
        continue;
      }
      if (!mapped.linkedin && !mapped.bio) {
        excluded.missingPublicProfile += 1;
        continue;
      }

      const bioHash = hashText(mapped.bio || '');
      const safeBio = stripPrivateDetails(mapped.bio);
      const previous = (
        previousMembersById.get(mapped.id) ||
        previousMembersByLinkedin.get(mapped.linkedin) ||
        previousMembersByName.get(mapped.name.toLowerCase())
      );
      const pageEditedAtMs = Date.parse(page.last_edited_time || '');
      const unchangedSinceSnapshot = (
        previous &&
        !previous.bioHash &&
        Number.isFinite(snapshotSyncedAtMs) &&
        Number.isFinite(pageEditedAtMs) &&
        pageEditedAtMs <= snapshotSyncedAtMs
      );
      // The July 10 Railway snapshot predates populated bio hashes. Its
      // Notion edit time lets us migrate unchanged blurbs without masking a
      // genuinely edited profile. The text check also supports newer bundles.
      if (
        !this.blurbCache[bioHash] &&
        previous?.blurb &&
        (
          unchangedSinceSnapshot ||
          (safeBio && previous.searchText?.includes(safeBio))
        )
      ) {
        this.blurbCache[bioHash] = previous.blurb;
      }
      const blurb = await this.sanitiseBlurb(mapped.bio, mapped.name, bioHash);
      members.push({
        id: mapped.id,
        name: mapped.name,
        functions: mapped.functions,
        level: mapped.level,
        location: mapped.location,
        region: mapped.region,
        linkedin: mapped.linkedin,
        blurb,
        bioHash,
        searchText: compactText([
          mapped.name,
          mapped.functions.join(' '),
          mapped.level,
          mapped.location,
          mapped.region,
          safeBio,
          blurb
        ].join(' '))
      });
    }

    const snapshot = {
      syncedAt: new Date().toISOString(),
      source: 'notion',
      memberCount: members.length,
      excluded,
      members
    };

    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.writeFile(this.snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`);
    await fs.writeFile(this.blurbCachePath, `${JSON.stringify(this.blurbCache, null, 2)}\n`);
    this.snapshot = snapshot;
    return snapshot;
  }

  async fetchActiveNotionPages() {
    const pages = [];
    let startCursor = null;

    do {
      const body = {
        page_size: 100,
        filter: {
          property: 'Status',
          status: { equals: 'Active' }
        }
      };
      if (startCursor) body.start_cursor = startCursor;

      const response = await this.fetch(`https://api.notion.com/v1/data_sources/${this.notionDataSourceId}/query`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.notionToken}`,
          'Content-Type': 'application/json',
          'Notion-Version': this.notionVersion
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const detail = await safeResponseText(response);
        throw new Error(`Notion sync failed (${response.status}): ${detail.substring(0, 180)}`);
      }

      const json = await response.json();
      pages.push(...(json.results || []));
      startCursor = json.has_more ? json.next_cursor : null;
    } while (startCursor);

    return pages;
  }

  mapNotionPage(page) {
    const props = page.properties || {};
    const status = plainProperty(props.Status);
    if (status !== 'Active') return null;

    const firstName = plainProperty(props['First Name']);
    const lastName = plainProperty(props['Last Name']);
    const name = compactText(`${firstName} ${lastName}`);
    if (!name) return null;

    const directoryValue = plainProperty(props.Directory);
    const functions = multiSelectProperty(props.Function).filter(value => FUNCTIONS.includes(value));

    return {
      id: page.id,
      name,
      functions,
      level: plainProperty(props.Level),
      location: plainProperty(props.Location),
      region: plainProperty(props.Region),
      linkedin: normaliseUrl(plainProperty(props.Linkedin)),
      bio: compactText(plainProperty(props['Elevator Pitch Bio'])),
      directoryOptOut: /opted\s*out/i.test(directoryValue)
    };
  }

  async sanitiseBlurb(bio, name, bioHash) {
    if (!bio) return '';
    if (this.blurbCache[bioHash]) return this.blurbCache[bioHash];

    let blurb = '';
    if (this.anthropicKey && this.fetch) {
      try {
        const prompt = [
          'Write a clean public directory blurb for this FEC member.',
          'Rules: 1-2 short lines, third person, no email, no phone, no rates, no private client names unless clearly public brands.',
          `Name: ${name}`,
          `Bio: ${bio}`
        ].join('\n');
        blurb = await this.callAnthropicText(prompt, 140);
      } catch (err) {
        await this.alert(`*[Directory]* Blurb sanitiser degraded for ${name}: ${err.message}`);
      }
    }

    if (!blurb) blurb = fallbackBlurb(bio);
    blurb = stripPrivateDetails(blurb);
    this.blurbCache[bioHash] = blurb;
    return blurb;
  }

  async search(query, options = {}) {
    const snapshot = await this.ensureSnapshot();
    const cleanQuery = compactText(query || '').slice(0, 500);
    if (!cleanQuery) {
      return {
        count: 0,
        totalCount: 0,
        shownCount: 0,
        cards: [],
        clarifyingQuestion: 'What kind of fractional executive are you looking for?',
        functions: FUNCTIONS
      };
    }

    const parsed = await this.parseQuery(cleanQuery);
    if (!parsed.functions.length) {
      return {
        count: 0,
        totalCount: 0,
        shownCount: 0,
        cards: [],
        clarifyingQuestion: 'Which function do you need: marketing, sales, operations, finance, engineering, product, customer, HR, legal, design, or general management?',
        functions: FUNCTIONS
      };
    }

    const functionMatches = snapshot.members
      .filter(member => member.functions.some(fn => parsed.functions.includes(fn)));
    const locationMatches = parsed.location
      ? functionMatches.filter(member => matchesLocationScope(member, parsed.location))
      : functionMatches;
    const scored = locationMatches
      .map(member => ({
        member,
        locationTier: getLocationTier(member, parsed.location),
        levelRank: Object.prototype.hasOwnProperty.call(LEVEL_RANK, member.level) ? LEVEL_RANK[member.level] : 9,
        keywordScore: keywordScore(member.searchText, parsed.keywords)
      }))
      .sort((a, b) => (
        a.locationTier - b.locationTier ||
        b.keywordScore - a.keywordScore ||
        a.levelRank - b.levelRank ||
        a.member.name.localeCompare(b.member.name)
      ));

    const topMatches = scored.slice(0, options.limit || 10);
    const cards = topMatches.map(item => publicCard(item.member, fallbackFitNote(parsed, item.member)));
    const broaderCount = Math.max(0, functionMatches.length - scored.length);

    return {
      count: scored.length,
      totalCount: scored.length,
      shownCount: cards.length,
      cards,
      parsed,
      suggestion: scored.length === 0 ? nearestSuggestion(snapshot.members, parsed) : null,
      broaderCount,
      broaderSuggestion: parsed.location && broaderCount > 0
        ? `${broaderCount} additional ${parsed.functions.join('/')} member${broaderCount === 1 ? '' : 's'} are available outside ${locationLabel(parsed.location)}. Run the search again without a location to see them.`
        : null,
      degraded: false
    };
  }

  async parseQuery(query) {
    if (this.anthropicKey && this.fetch) {
      try {
        const prompt = [
          'Parse this fractional executive search query into JSON only.',
          `Allowed functions: ${FUNCTIONS.join(', ')}`,
          'Return shape: {"functions":[],"location":null,"keywords":[]}.',
          'Map CMO to Marketing, COO to Operations (eg COO), CFO to Finance, CTO to Engineering (eg CTO), CRO/GTM/revenue to Sales, CEO/GM to General Management.',
          `Query: ${query}`
        ].join('\n');
        const raw = await this.callAnthropicText(prompt, 220);
        const parsed = JSON.parse(raw.replace(/^```json|```$/g, '').trim());
        return normaliseParsedQuery(query, parsed);
      } catch (err) {
        return fallbackParseQuery(query);
      }
    }
    return fallbackParseQuery(query);
  }

  async callAnthropicText(prompt, maxTokens) {
    const response = await this.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.anthropicKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.anthropicModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const detail = await safeResponseText(response);
      throw new Error(`Anthropic request failed (${response.status}): ${detail.substring(0, 120)}`);
    }

    const json = await response.json();
    return (json.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
      .trim();
  }

  async getMeta() {
    const snapshot = await this.ensureSnapshot();
    const functions = new Set();
    const locations = new Set();

    for (const member of snapshot.members) {
      member.functions.forEach(fn => functions.add(fn));
      const location = primaryLocationLabel(member.location);
      if (location) locations.add(location);
    }

    return {
      syncedAt: snapshot.syncedAt,
      count: snapshot.memberCount,
      functions: Array.from(functions).sort(),
      locations: Array.from(locations).sort()
    };
  }

  async alert(message) {
    if (this.sendSlack) {
      try {
        await this.sendSlack(message);
      } catch (err) {
        // Slack alerts should never break directory work.
      }
    }
  }
}

function fallbackParseQuery(query) {
  const functions = new Set();
  for (const mapping of ROLE_PATTERNS) {
    if (mapping.pattern.test(query)) mapping.functions.forEach(fn => functions.add(fn));
  }

  const location = detectLocation(query);
  // Multi-word skill phrases ("public relations", "customer experience") must
  // survive as one keyword so they can score against members who wrote "PR" or "CX".
  const lowerQuery = compactText(query).toLowerCase();
  const phraseKeywords = KEYWORD_SYNONYMS
    .filter(group => group.some(variant => variant.includes(' ') && wholeWordPattern(variant).test(lowerQuery)))
    .map(group => group[0]);
  const keywords = phraseKeywords.concat(lowerQuery
    .split(/\W+/)
    .filter(word => word.length >= 2)
    .filter(word => ![
      'find', 'need', 'looking', 'fractional', 'exec', 'executive', 'for', 'with', 'near',
      'which', 'who', 'what', 'can', 'help', 'members', 'member', 'anyone', 'someone', 'somebody',
      'does', 'do', 'the', 'and', 'any', 'are', 'there', 'our', 'community', 'fec', 'you', 'we',
      'know', 'have', 'got', 'recommend', 'in', 'on', 'at', 'to', 'of', 'me', 'is', 'an', 'good'
    ].includes(word)))
    .slice(0, 10);

  return {
    functions: Array.from(functions),
    location,
    keywords
  };
}

function normaliseParsedQuery(originalQuery, parsed) {
  const fallback = fallbackParseQuery(originalQuery);
  const functions = Array.isArray(parsed.functions)
    ? parsed.functions.filter(value => FUNCTIONS.includes(value))
    : [];

  return {
    functions: functions.length ? Array.from(new Set(functions)) : fallback.functions,
    location: typeof parsed.location === 'string' && parsed.location.trim() ? detectLocation(parsed.location) || parsed.location.trim() : fallback.location,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map(String).slice(0, 10) : fallback.keywords
  };
}

function detectLocation(text) {
  const lower = String(text || '').toLowerCase();
  for (const location of LOCATION_PATTERNS) {
    if (location.terms.some(term => containsTerm(lower, term))) {
      return location;
    }
  }
  return null;
}

function getLocationTier(member, target) {
  if (!target) return 0;

  const locationText = String(member.location || '').toLowerCase();
  const regionText = String(member.region || '').toLowerCase();
  const matchesAny = terms => terms.some(term => containsTerm(locationText, term));

  if (target.city && matchesAny([target.city])) return 0;
  if (target.state && matchesAny([target.state])) return 1;
  if (target.country && matchesAny([target.country, ...(target.country === 'Australia' ? ['australia', 'aus'] : [])])) return 2;
  if (target.region && regionText === target.region.toLowerCase()) return 3;

  for (const location of LOCATION_PATTERNS) {
    if (location.key === target.key) continue;
    if (target.state && location.state === target.state && matchesAny(location.terms)) return 1;
    if (target.country && location.country === target.country && matchesAny(location.terms)) return 2;
    if (target.region && location.region === target.region && matchesAny(location.terms)) return 3;
  }

  return 4;
}

function matchesLocationScope(member, target) {
  if (!target || typeof target !== 'object') return true;
  const tier = getLocationTier(member, target);

  if (target.city) return tier === 0;
  if (target.state) return tier <= 1;
  if (target.country) return tier <= 2;
  if (target.region) return tier <= 3;
  return true;
}

function locationLabel(target) {
  return target?.city || target?.state || target?.country || target?.region || 'the requested location';
}

function containsTerm(text, term) {
  const escaped = String(term || '').toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(text);
}

function nearestSuggestion(members, parsed) {
  const functionMatches = members.filter(member => member.functions.some(fn => parsed.functions.includes(fn)));
  if (parsed.location && functionMatches.length) {
    return `No ${parsed.functions.join('/')} members matched ${parsed.location.city || parsed.location.country || parsed.location.region}; ${functionMatches.length} matched elsewhere.`;
  }
  return 'No exact matches yet. Try a broader function or location.';
}

// Members write "PR" while askers write "public relations" (and vice versa).
// Each cluster counts once, however the query or the bio phrases it.
const KEYWORD_SYNONYMS = [
  ['pr', 'public relations', 'media relations', 'comms', 'communications', 'communication', 'publicist', 'publicity'],
  ['hr', 'human resources', 'people and culture', 'people & culture', 'talent'],
  ['cx', 'customer experience'],
  ['cs', 'customer success'],
  ['ops', 'operations', 'operational'],
  ['gtm', 'go to market', 'go-to-market'],
  ['bd', 'business development', 'partnerships'],
  ['ai', 'artificial intelligence', 'automation'],
  ['fundraising', 'capital raising', 'raise capital', 'raising capital', 'investor'],
  ['seo', 'search engine optimisation', 'search engine optimization'],
];

function expandKeyword(term) {
  const lower = term.toLowerCase();
  const cluster = KEYWORD_SYNONYMS.find(group => group.includes(lower));
  return cluster ? cluster : [lower];
}

// Whole-word matching: a substring test lets "pr" score against "practice",
// "proven" and "product", which made short skill terms useless for ranking.
function wholeWordPattern(term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i');
}

function keywordScore(text, keywords) {
  if (!keywords || !keywords.length) return 0;
  const haystack = String(text || '');
  const seenClusters = new Set();
  return keywords.reduce((score, keyword) => {
    const term = String(keyword).trim();
    if (!term) return score;
    const variants = expandKeyword(term);
    const clusterKey = variants.join('|');
    if (seenClusters.has(clusterKey)) return score;
    seenClusters.add(clusterKey);
    return score + (variants.some(v => wholeWordPattern(v).test(haystack)) ? 1 : 0);
  }, 0);
}

function publicCard(member, fitNote) {
  return {
    name: member.name,
    functions: member.functions,
    level: member.level,
    location: member.location,
    blurb: member.blurb,
    fitNote: stripPrivateDetails(fitNote || ''),
    linkedin: member.linkedin
  };
}

function fallbackFitNote(parsed, member) {
  const role = parsed.functions.find(fn => member.functions.includes(fn)) || member.functions[0] || 'fractional';
  const location = member.location ? ` in ${member.location}` : '';
  return `${member.level || 'Experienced'} ${role} operator${location}.`;
}

function fallbackBlurb(bio) {
  const clean = stripPrivateDetails(compactText(bio));
  if (clean.length <= 220) return clean;
  const sentence = clean.split(/(?<=[.!?])\s+/).find(part => part.length >= 60 && part.length <= 220);
  return sentence || `${clean.slice(0, 217).trim()}...`;
}

function stripPrivateDetails(text) {
  return compactText(String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '')
    .replace(/\b(?:AUD|USD|GBP|EUR|\$|£|€)\s?\d[\d,.]*(?:\s?(?:\/|per)\s?(?:hour|hr|day|month|mth|week))?/gi, '')
    .replace(/\b\d[\d,.]*\s?(?:\/|per)\s?(?:hour|hr|day|month|mth|week)\b/gi, '')
    .replace(/\b(?:contact|email|rates?)\s*[:.]?\s*$/i, '')
    .replace(/\s+([.,])/g, '$1'));
}

function primaryLocationLabel(location) {
  const text = String(location || '').trim();
  if (!text) return '';
  const detected = detectLocation(text);
  return detected?.city || detected?.country || text.split(',')[0].trim();
}

function plainProperty(prop) {
  if (!prop) return '';
  if (prop.type) {
    if (prop.type === 'title') return richTextToPlain(prop.title);
    if (prop.type === 'rich_text') return richTextToPlain(prop.rich_text);
    if (prop.type === 'select') return prop.select?.name || '';
    if (prop.type === 'status') return prop.status?.name || '';
    if (prop.type === 'url') return prop.url || '';
    if (prop.type === 'email') return prop.email || '';
    if (prop.type === 'phone_number') return prop.phone_number || '';
    if (prop.type === 'multi_select') return multiSelectProperty(prop).join(', ');
  }
  return '';
}

function multiSelectProperty(prop) {
  if (!prop) return [];
  const values = prop.type === 'multi_select' ? prop.multi_select : prop.multi_select;
  return Array.isArray(values) ? values.map(value => value.name).filter(Boolean) : [];
}

function richTextToPlain(value) {
  if (!Array.isArray(value)) return '';
  return value.map(part => part.plain_text || '').join('');
}

function compactText(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normaliseUrl(url) {
  const clean = compactText(url);
  if (!clean) return '';
  if (/^https?:\/\//i.test(clean)) return clean;
  if (/^linkedin\.com/i.test(clean) || /^www\.linkedin\.com/i.test(clean)) return `https://${clean}`;
  return clean;
}

function hashText(text) {
  return crypto.createHash('sha256').update(String(text || '')).digest('hex');
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch (err) {
    return response.statusText || 'request failed';
  }
}

const directory = new Directory();

module.exports = {
  Directory,
  DirectoryUnavailableError,
  FUNCTIONS,
  fallbackParseQuery,
  getLocationTier,
  directory
};
