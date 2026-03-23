const fs = require('fs');
const path = require('path');

/**
 * Recursively reads all .md files from a directory
 */
function readMarkdownFiles(dir) {
  const files = [];

  if (!fs.existsSync(dir)) {
    console.warn(`Knowledge directory not found: ${dir}`);
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...readMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push({
        name: entry.name,
        path: fullPath,
        content: fs.readFileSync(fullPath, 'utf-8')
      });
    }
  }

  return files;
}

/**
 * Loads all knowledge base files and returns the system prompt
 */
function loadKnowledgeBase() {
  const knowledgeDir = path.join(__dirname, '..', 'knowledge');

  // FIX [Medium]: Fail fast if core files are missing
  function requireFile(filePath, label) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Required knowledge base file missing: ${label} (${filePath})`);
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  const voiceContent = requireFile(path.join(knowledgeDir, 'voice-and-persona.md'), 'Voice & Persona');
  const fecContent = requireFile(path.join(knowledgeDir, 'fec-overview.md'), 'FEC Overview');
  const guideContent = requireFile(path.join(knowledgeDir, 'business-os-guide.md'), 'Business OS Guide');

  // Require at least some playbook files
  const playbookDir = path.join(knowledgeDir, 'playbook');
  if (!fs.existsSync(playbookDir) || fs.readdirSync(playbookDir).filter(f => f.endsWith('.md')).length === 0) {
    throw new Error('Required knowledge base directory missing or empty: playbook/');
  }

  // Load all other knowledge files
  const playbook = readMarkdownFiles(path.join(knowledgeDir, 'playbook'));
  const workshops = readMarkdownFiles(path.join(knowledgeDir, 'workshops'));
  const templates = readMarkdownFiles(path.join(knowledgeDir, 'templates'));

  // Build the system prompt
  const sections = [
    voiceContent,
    '\n---\n',
    fecContent,
    '\n---\n\n# KNOWLEDGE BASE\n\nBelow is your complete knowledge base. Use this to ground your answers.\n',
    '\n## The Fractional Executive Playbook (Primary Reference)\n\n',
    ...playbook.map(f => `### ${f.name.replace('.md', '').replace(/-/g, ' ')}\n\n${f.content}\n\n`),
    '\n---\n\n## The Business Operating System Guide\n\n',
    guideContent,
    '\n---\n\n## Workshop Materials\n\n',
    ...workshops.map(f => `### ${f.name.replace('.md', '').replace(/-/g, ' ')}\n\n${f.content}\n\n`),
    '\n---\n\n## Templates & Tools\n\n',
    ...templates.map(f => `### ${f.name.replace('.md', '').replace(/-/g, ' ')}\n\n${f.content}\n\n`),
  ];

  const systemPrompt = sections.join('');

  // Rough token estimate (1 token ≈ 4 chars for English)
  const estimatedTokens = Math.round(systemPrompt.length / 4);

  console.log(`Knowledge base loaded:`);
  console.log(`  - Voice/persona: ${voiceContent.length} chars`);
  console.log(`  - FEC overview: ${fecContent.length} chars`);
  console.log(`  - Business OS guide: ${guideContent.length} chars`);
  console.log(`  - Playbook: ${playbook.length} files`);
  console.log(`  - Workshops: ${workshops.length} files`);
  console.log(`  - Templates: ${templates.length} files`);
  console.log(`  - Total system prompt: ${systemPrompt.length} chars (~${estimatedTokens} tokens)`);

  return systemPrompt;
}

module.exports = { loadKnowledgeBase };
