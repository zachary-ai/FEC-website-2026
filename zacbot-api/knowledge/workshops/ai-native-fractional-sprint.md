# AI Native Fractional Sprint (ZacBot Edition)

**Format:** 5-week cohort program
**Audience:** FEC members wanting to systematize their practice with AI
**Outcome:** Fully configured Claude Code setup tailored to their fractional business
**Commitment:** ~2-3 hours/week
**Included in FEC membership** (not a premium add-on)
**Cohort size:** Cap at 15-20

## Prerequisites
- Claude Pro subscription ($20/month) or Claude Max
- Claude Code installed
- Basic comfort with terminal/command line
- Business docs accessible somewhere

## Weekly Rhythm
- Tuesday: AI Tuesday walkthrough (30-45 min)
- Friday: Office Hours troubleshooting and demos
- Async: Sprint channel for progress and feedback
- All sessions recorded

## Sprint Structure

### Week 0: Setup (Optional Pre-Work)
- Install Claude Code, verify it's working
- Join sprint channel

### Week 1: Build Your Foundation Model
**Goal:** Teach Claude who you are

**Process:**
1. **Gather existing docs** into a folder: business plan, website copy, LinkedIn profile, proposals, SOWs, marketing materials, notes on ideal clients
2. **Have Claude read everything:** "Read this folder. Summarize what you understand. Identify gaps and questions."
3. **Run the interview:** Claude asks questions one at a time covering: background, work/deliverables, ideal clients, positioning, pricing, goals, working style, values
4. **Review and refine** the output

**Deliverable:** "Foundational Context" document (1-3 pages)

**Document sections:** Who I Am, What I Do, What I Don't Do, Ideal Clients, Positioning, Business Model, Goals, Working Style, Values

### Week 2: Organize Your Business Structure
**Goal:** Create a folder structure Claude can navigate

Give Claude your foundational doc and current structure. Ask it to propose and implement an organization that separates client work from operations, has clear homes for content/IP/templates, and scales with new clients.

**Deliverable:** Reorganized folder structure with screenshot/tree output

### Week 3: Build Your Context Layer (CLAUDE.md Files)
**Goal:** Give Claude deep context about every part of your business

1. Create root CLAUDE.md (business overview, folder navigation, key principles, working patterns)
2. Create 2-3 subdirectory CLAUDE.md files for most important folders
3. Test by closing and reopening Claude Code, asking: "What do I do for a living?" "Where would I find my proposals?" "What's my pricing model?"

**Key sections for root CLAUDE.md:** Business overview, folder structure navigation, key files and purposes, working patterns, what to avoid

### Week 4: Build Custom Skills
**Goal:** Create reusable commands for repeated workflows

1. Identify repeated workflows (proposals, LinkedIn posts, meeting prep, SOWs)
2. Build 1-2 skills in `.claude/skills/` with SKILL.md files
3. Test and refine

**Example skills:** `/proposal`, `/linkedin`, `/meeting-prep`, `/retro`, `/sow`

### Week 5: Build Autonomous Agents
**Goal:** Create agents for complex multi-step tasks

1. Identify complex workflows (prospect research, system audits, content calendars, competitive analysis)
2. Design agent with research/gather, analysis/synthesis, and output phases
3. Run on a real task

**Example agents:** Prospect research, content extraction, client onboarding, competitive intel, meeting prep

## Graduation Checklist
- Foundational context document
- Organized folder structure
- CLAUDE.md files throughout
- 2+ custom skills
- 1+ agent pattern

## FAQ
- **Technical requirements:** If you can `cd` into a folder, you're fine
- **Missed workshops:** All recorded, assignments are async
- **ChatGPT users:** Sprint is Claude Code specific. Concepts transfer, implementation doesn't.
- **Didn't finish in 5 weeks:** Keep access to materials and community, go at your own pace
- **Just starting as fractional:** Great time to set it up right
