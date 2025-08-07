# PRE-CALL BRIEFING: meta client meeting - 6

**Meeting:** Thu, Aug 7, 10:45 AM  
**Type:** PROPOSAL  
**Location:** Not specified  
**Attendees:** joshnaacsha.25cs@licet.ac.in, joshnaacsha@gmail.com

---

## CLIENT CONTEXT
Meta is exploring advanced document management using LLMs. We've built a PoC demonstrating metadata tagging, graph creation, and contextual querying using Gemini, focusing on real-time sync from Google Drive/Confluence, and a live dashboard.

## ENGAGEMENT HISTORY
This is our 6th meeting. The previous meetings focused on refining a PoC for intelligent document management, addressing security concerns (data flow diagrams), and demonstrating LLM-powered contextual querying. The last meeting discussed pilot rollouts with 3 internal teams and multi-tenant support.

**Previous Meetings:** 3 meetings on record



## EXTERNAL INTELLIGENCE
Recent research highlights RAG implementations in multi-tenant environments using Amazon Bedrock and other services. Joshna Acsha's role is unspecified but is the main POC for these meeting notes, so focus on her engagement and feedback. Since all meetings have focused on RAG, she's likely engaged in the RAG implementation at Meta.

**Research Query:** "Meta RAG implementation document context restriction node-level access control multi-tenant support"


## ATTENDEE INTELLIGENCE
**ATTENDEE INTELLIGENCE** (1 profiles researched)

**1. joshnaacsha@gmail.com**
• Company/Domain: gmail.com
• Role: Position not specified

**MEETING APPROACH SUGGESTIONS**
• Recommended prep: Review attendee contexts above for personalized talking points

*Research conducted: Aug 07, 2025 10:36 | Sources: Professional directories and public profiles*

---

## TALKING POINTS
1. Showcase multi-tenant architecture design for pilot support (team-level permissions, document segregation).
2. Present auto-expiry solution for document nodes (90-day suggestion from security review).
3. Address fallback responses for LLM queries when context is missing to improve usability.
4. Review the full rollout proposal and discuss budget/timeline, aligning it to their 3-team pilot.

## KEY QUESTIONS
1. Can you provide us with Meta's final list of teams participating in the pilot program?
2. What is the compliance sign-off timeline, and are there any outstanding concerns we need to address?
3. What are your specific requirements for dashboard role views and the analytics API regarding multi-tenant support?
4. What would a successful pilot look like from Meta's perspective? Define success metrics.

---

## RISKS & OPPORTUNITIES

**⚠️ Risks:** Potential delays in compliance sign-off could impact the rollout timeline. • Lack of clear understanding of Meta's specific requirements for multi-tenant support may lead to scope creep. • LLM context restriction and fallback responses may not fully meet user expectations, impacting adoption.

**🚀 Opportunities:** Expand the initial pilot program beyond 3 teams based on early success and positive feedback. • Develop custom analytics API that integrates seamlessly with Meta's existing infrastructure. • Position Cprime as a long-term partner for ongoing LLM and AI initiatives within Meta.

---

## CPRIME EDGE
**Services:** Cloud Migration & Architecture | DevOps & CI/CD Implementation | Digital Transformation Consulting  
**Differentiators:** End-to-end cloud migration expertise • AWS Advanced Consulting Partner • Located in IITM Research Park, Chennai

## MEETING CONTEXT
**Meeting Description:** <h2>📝 <strong>Client Meeting Notes – 3rd Meeting with Meta</strong></h2><p><strong>Date:</strong> [Insert Date]<br><strong>Attendees:</strong></p><ul><li><p>Meta: John Doe, Jane Smith</p></li><li><p>Our Team: Joshna Acsha, [Other Names]</p></li></ul><hr /><h3>✅ <strong>Agenda</strong></h3><ul><li><p>Present updated PoC with live sync</p></li><li><p>Demonstrate metadata tagging and node enhancements</p></li><li><p>Discuss dashboard options</p></li><li><p>Address security and compliance feedback</p></li></ul><hr /><h3>📌 <strong>Key Discussion Points</strong></h3><ol><li><p><strong>PoC Enhancements Presented:</strong></p><ul><li><p>Real-time sync from Google Drive and Confluence enabled using webhook polling</p></li><li><p>Metadata fields (createdBy, modifiedAt, accessLevel, sourceLink) added to graph nodes</p></li><li><p>Added tags for document classification (e.g., RFP, Technical Doc, Internal Memo)</p></li></ul></li><li><p><strong>Dashboard Preview:</strong></p><ul><li><p>Shared simple UI mockup showing:</p><ul><li><p>Node category breakdown</p></li><li><p>Most accessed documents</p></li><li><p>Relationship heatmaps</p></li></ul></li><li><p>Meta team suggested adding date filters and role-based access views</p></li></ul></li><li><p><strong>Security &amp; Compliance:</strong></p><ul><li><p>Logging implemented for every data fetch and user access</p></li><li><p>Compliance team requested detailed data flow diagram</p></li><li><p>Need clarification on data purge policy for expired documents</p></li></ul></li><li><p><strong>Meta Feedback:</strong></p><ul><li><p>Impressed with metadata integration</p></li><li><p>Want LLM to answer queries using only document context (RAG validation)</p></li><li><p>Suggested exploring access control enforcement at node-level</p></li></ul></li></ol><hr /><h3>📍 <strong>Action Items</strong></h3><ul><li><p>[Joshna]:</p><ul><li><p>Add filters to dashboard (date range, tag, source)</p></li><li><p>Prepare a detailed architecture + data flow diagram</p></li><li><p>Add node-level access control logic</p></li><li><p>Begin integrating LLM-based RAG response with context restriction</p></li></ul></li><li><p>Meta:</p><ul><li><p>Share compliance checklist</p></li><li><p>Provide feedback on dashboard UI by [Insert Date]</p></li><li><p>Confirm timeline for final PoC evaluation</p></li></ul></li></ul><hr /><h3>🔄 <strong>Next Meeting:</strong></h3><p>Tentatively scheduled: [Insert Date]<br>Purpose: Final PoC walkthrough + initiate full-scope planning</p><hr /><h2>📝 <strong>Client Meeting Notes – 4th Meeting with Meta</strong></h2><p><strong>Date:</strong> [Insert Date]<br><strong>Attendees:</strong></p><ul><li><p>Meta: John Doe, Jane Smith, Rahul Kapoor (Security)</p></li><li><p>Our Team: Joshna Acsha, [Other Names]</p></li></ul><hr /><h3>✅ <strong>Agenda</strong></h3><ul><li><p>Final walkthrough of PoC</p></li><li><p>Review security/data flow diagram</p></li><li><p>Evaluate LLM integration for contextual querying</p></li><li><p>Discuss roadmap for full implementation</p></li></ul><hr /><h3>📌 <strong>Key Discussion Points</strong></h3><ol><li><p><strong>Final PoC Demo:</strong></p><ul><li><p>Fully working document ingestion, metadata tagging, and graph creation</p></li><li><p>Live dashboard with filters and summary stats</p></li><li><p>Chat interface using Gemini LLM (restricted to document context)</p></li></ul></li><li><p><strong>Security Review:</strong></p><ul><li><p>Presented data flow diagram – approved with minor notes</p></li><li><p>Suggested adding auto-expiry for document nodes after 90 days</p></li><li><p>Discussed rate-limiting for API endpoints to prevent misuse</p></li></ul></li><li><p><strong>LLM Performance (RAG):</strong></p><ul><li><p>Successfully answered queries like:</p><ul><li><p>“What is the client deadline mentioned in the latest RFP?”</p></li><li><p>“List internal memos related to Project X”</p></li></ul></li><li><p>Feedback: Ensure fallback response when context is missing</p></li></ul></li><li><p><strong>Meta Roadmap Discussion:</strong></p><ul><li><p>Interested in full-scale rollout</p></li><li><p>Plan to onboard 3 internal teams for pilot</p></li><li><p>Emphasis on multi-tenant support, dashboard role views, and analytics API</p></li></ul></li></ol><hr /><h3>📍 <strong>Action Items</strong></h3><ul><li><p>[Joshna]:</p><ul><li><p>Add fallback responses and improve context restriction in chat</p></li><li><p>Start designing for multi-tenant capability</p></li><li><p>Plan pilot support architecture (team-level permissions, document segregation)</p></li></ul></li><li><p>Meta:</p><ul><li><p>Finalize list of teams for pilot</p></li><li><p>Provide compliance sign-off</p></li><li><p>Schedule internal onboarding sessions</p></li></ul></li></ul><hr /><h3>🚀 <strong>Next Steps</strong></h3><ul><li><p>Prepare full rollout proposal with budget + timeline</p></li><li><p>Conduct pilot with selected Meta teams</p></li><li><p>Continue enhancement based on pilot feedback</p></li></ul>

**Pre-Meeting Checklist:** Review action items • Prepare technical diagrams • Confirm attendees • Ready follow-up template

---

**Data Sources:** 3 prev meetings • 0 project notes • External research: Yes • Attendee profiles: Yes

*Generated 2025-08-07 | Confidential*