# Claude as Your Business Operating System (ZacBot Edition)

## The Four Levels of AI Adoption

**Level 1: Chatbot.** Ask a question, get an answer. Stateless. Every conversation starts from zero. Where 90% of professionals stop.

**Level 2: Long Conversation.** AI remembers your context across a thread. Great, but ceiling: can't branch, can't share between threads, new thread = start over.

**Level 3: Static Files (Projects).** Upload docs to a project. Better context, but files are frozen. Business moves faster than your uploads. Most "power users" live here.

**Level 4: Dynamic Context (The Unlock).** Context lives in files on your computer. AI can CREATE new context files. Each output becomes input for the next step. You build context at the speed of thought.

Example chain: sales proposals + emails + transcripts -> marketing plan -> copy -> content pillars -> personas -> objection handling. Each step builds on the last.

## Three-Layer System

1. **Context (CLAUDE.md files):** Business knowledge persisted in markdown. Claude reads these at conversation start.
2. **Connections (MCP Servers):** Direct API integrations between Claude and your tools (Gmail, CRM, docs).
3. **Workflows (Skills):** Repeatable multi-step processes triggered by slash commands encoding your methodology.

## The Context Layer (CLAUDE.md Files)

Markdown files Claude reads at start of every conversation. Persistent business memory across sessions, devices, conversations.

### What Goes In

**Business level:** Business model, positioning, pricing, file editing rules, naming conventions, communication standards (tone, formatting), navigation, strategic context.

**Project level:** Workflows, key deliverables, target customer profiles, tool integrations.

**Client level:** Engagement context (scope, pricing, contacts), ICP definitions, messaging frameworks, deliverable tracking, call notes, key decisions.

### Hierarchy Example
```
Business/CLAUDE.md              (model, navigation, strategy)
  Fractional GTM/CLAUDE.md      (GTM operations, framework)
    Clients/Company/CLAUDE.md   (ICP, messaging, deliverables)
  FEC/CLAUDE.md                 (community operations)
  Content/CLAUDE.md             (pillars, style, publishing)
  Operations/CLAUDE.md          (finance, tax, payroll)
```

Claude reads the CLAUDE.md for your current directory plus parent directories. Working on a client engagement = business model + GTM methodology + client context, all automatic.

### Managing Attention
AI has a context window limit. CLAUDE.md files manage what gets loaded. Put right context in = good decisions. Bloat with irrelevant detail = lost focus. Skills are separate (loaded on-demand, not always), this is progressive disclosure.

### Building Your First CLAUDE.md
Answer these six questions:
1. What do you do? (2-3 sentences)
2. Who do you serve?
3. What do you deliver?
4. How should Claude communicate? (voice, tone, formatting)
5. What should Claude never do?
6. Where are things? (key file locations)

### Multi-Device Continuity
CLAUDE.md files live in the file system, not conversation threads. Use a `/debrief` skill at session end to capture decisions and tasks to project files and a global TASKS.md.

## The Connection Layer (MCP Servers)

MCP (Model Context Protocol) lets Claude talk directly to your tools via API, not copy-paste.

**Without MCPs:** Work in Claude, switch to Gmail, switch to CRM, switch back. Every switch costs context and time.

**With MCPs:** One environment. "Draft a follow-up, update the deal stage, add a follow-up task." One command, three tools, zero context switching.

### Recommended MCP Stack
| MCP | What It Unlocks |
|-----|----------------|
| Gmail | Compose, send, search emails without leaving terminal |
| Google Docs | Generate deliverables directly into shareable docs |
| Perplexity | Deep research with citations in minutes |
| Granola | Meeting transcripts flow into playbook generation |
| CRM (Attio) | Pipeline visible in every conversation |
| Notion | Client notes, content databases |
| Chrome | Browser automation, form filling, data extraction |

### Choosing Your First MCP
Start with the tool you context-switch to most often. Usually: Gmail, Google Docs, or your CRM. Most take 15-30 minutes to set up. Pays for itself within the first week.

### Impact Examples
- Post-call follow-ups: 30-45 minutes down to 5 minutes review
- Prospect research: 6-8 hours down to 20-30 minutes
- Call insights: from "I remember they mentioned..." to structured, searchable data

## The Workflow Layer (Skills)

Skills are repeatable multi-step workflows triggered by slash commands. They encode your methodology, not just prompts.

### Core Method: Start With Your Output
1. Define your output (what deliverable do clients pay for?)
2. Give that to AI ("here's what I need to produce, what inputs do I need?")
3. Throw your context at it (past deliverables, templates, frameworks, client data)
4. Build the skill around the workflow so it's repeatable

### Example Skills by Role
- **Fractional CMO:** Marketing audit or brand strategy
- **Fractional CFO:** Financial model or cash flow forecast
- **Fractional COO:** Ops assessment or process map
- **Fractional CPO:** Product roadmap or discovery synthesis

### Skill Structure
```
skill-name/
  SKILL.md           (instructions and workflow)
  supporting-file.md (templates, reference data)
```

YAML frontmatter (name, description) + markdown instructions. Description determines when Claude invokes the skill.

### Skills Are IP
Your skills, CLAUDE.md files, and pattern library are intellectual property. Version-controlled, reusable, improve over time. A traditional fractional's IP lives in their head. An AI-native fractional's IP lives in files. AI doesn't replace you, it encodes you.

## The Compound Learning Engine

Each unit of work makes the next one easier. Opposite of traditional consulting where complexity accumulates.

### Pattern Library
Structured repository of reusable insights from client engagements. Categories: ICP Patterns, Messaging, Outbound, Analysis, Handoff.

**Pattern format:**
- Pattern name
- Source (client, date)
- Context (situation where pattern emerged)
- Insight (core learning)
- Application (how to apply to future engagements)
- Evidence (metrics, outcomes)

### The Extraction Loop
1. **Diagnose:** Use existing patterns to accelerate new client diagnosis
2. **Build:** Create deliverables from versioned templates informed by patterns
3. **Validate:** Multi-lens review before handoff
4. **Extract:** Capture learnings into updated patterns after engagement

**Timing:** Per-engagement extraction within 1 week of end. Monthly content performance extraction. Continuous flagging during active work.

### The Reflect Loop
Corrections made mid-session die with the conversation. The reflect loop captures: corrections, preferences, friction points, skill improvements. Persists them to the right files (email tone to communications CLAUDE.md, targeting to Pattern Library, sloppy skill output to tightened instructions).

Principle: every correction improves the system, not just the current conversation.

### Compound Effect After 3-4 Engagements
- Diagnosis: 2 weeks down to 1 week
- Playbook creation: 3 weeks down to 1.5 weeks
- Content extraction: ad-hoc becomes systematic
- Your 10th client gets a better playbook than your 1st, in half the time

### Three Questions for Reviewing AI Output
1. "What was the hardest decision you made here?" (reveals spots needing your expert eye)
2. "What alternatives did you consider and why reject them?" (shows decision tree)
3. "What are you least confident about?" (flags where AI is guessing)

## The Content Flywheel

Client work -> insights -> content (LinkedIn, newsletter, workshops) -> brand authority -> inbound leads -> better clients -> loop.

### Client Work to Content Mapping
| Client Work | Content Pillar | Format |
|---|---|---|
| Discovery call reveals founder mistake | Founder Reality | LinkedIn post |
| AI system saves 20 hrs/week | AI + Operations | Newsletter |
| Startup moves from founder-led to scalable GTM | GTM Infrastructure | Framework post |
| Pattern applies across industries | Operator Craft | Workshop |

### Weekly Content Cadence
| Day | Theme | Format |
|---|---|---|
| Monday | Insight Drop | Written post |
| Tuesday | Clip Day | Short-form video |
| Wednesday | System Build | Written post |
| Thursday | Throwback/Framework | Written or video |
| Friday | Meme | Image + copy |

### Performance Data (12-month audit)
- 80 posts, 739,599 total impressions, 9,245 avg per post
- Top post: 185,135 impressions
- Memes: 17,504 avg impressions (59% of total reach)
- Articles: 5,298 avg impressions but 24.6 avg comments (highest authority signal)
- Distribution stack: ~$22/month (Buffer $10 + Vubli $12)

### Newsletter Multiplier
One newsletter edition becomes 3 LinkedIn posts. Lead with the spiciest insight, extract two more angles. Deep thinking in newsletter, distribution on LinkedIn.

## Getting Started (On-Ramp)

You don't need 22 tools on day one. You need one file. You don't need to be technical.

### Beliefs to Unlearn
- "Deliverables must be created manually" (quality output matters, not who typed it)
- "First drafts should be good" (they should be fast. 60% -> 85% -> 95% with feedback)
- "I need to review every line" (build context/style guides so you review outputs, not keystrokes)
- "AI makes my expertise less valuable" (opposite: amplifies the gap between great and mediocre operators)
- "I need to understand the technology deeply" (understand concepts, not implementation)

### Week 1: First CLAUDE.md
Install Claude Code. Create working directory. Write business-level CLAUDE.md (6 questions above). Use Plan Mode (Shift+Tab) as training wheels.

### Week 2: First MCP Connection
Pick the tool you context-switch to most. Set up Gmail or Google Docs MCP. Budget 30 minutes.

### Week 3: First Skill
Start with your core client deliverable. Give it to Claude. Build context (past deliverables, frameworks, examples). Structure as a skill.

### Month 2+: Compound Engine
Add MCPs, build more skills, start your Pattern Library (after each engagement: "What did I learn that applies to the next client?").

### Progression
```
Week 1:  CLAUDE.md                          Context established
Week 2:  CLAUDE.md + 1 MCP                  Tools connected
Week 3:  CLAUDE.md + 1 MCP + 1 Skill        Core workflow automated
Month 2: 3 CLAUDE.md + 3 MCPs + 3 Skills    Practice instrumented
Month 3+: 10+ CLAUDE.md + 5+ MCPs + 5+ Skills + Pattern Library
```

### When Stuck
1. Save your work (checkpoint)
2. Consider a fresh session (sometimes faster than redirecting)
3. Check your context (is CLAUDE.md being read? relevant info in there?)
4. Update instructions ("what should I add so we don't hit this again?")
5. Give context before saying "fix it"

If saying "fix it" more than twice, the problem is context, not the fix.

### Common Mistakes
1. Building everything at once (start with one CLAUDE.md, one MCP, one skill)
2. Starting with the tool instead of the output
3. Over-engineering CLAUDE.md files on day one
4. Skipping the Pattern Library (where compound effect lives)
5. Treating AI as a writing assistant instead of operating system
6. Going in circles instead of stepping back for fresh session + better context
