# Approved Current client design

On October 19, 2026 the owner compared Current and Focus, chose Current, and explicitly requested locking this design and preparing the pending feature work for local/GitHub merge. This records a visual design decision; it is not full intended-person, device, genuine-day or clinical acceptance.

Current is the shipped client interface, including when an older `/?layout=focus` review link is opened. The entry-page Focus switch is disabled. The preserved Focus implementation and exact verified Current source/build restore point remain available for deliberate future engineering review; they do not change the selected production design.

The approved visible structure is:

- Nancy branding and Suggestions for Nancy at the top.
- The green Talk to Nancy banner above the navigation, with concise readiness/conversation state and existing Stop/Interrupt controls during a conversation.
- Exactly five client tabs: Tasks, Meals, Groceries, Progress and Ask for Help.
- A read-only Your Day timeline with participant-local times, source-attributed selected calendar events and separate untimed entries.
- Ways to use Nancy as an expandable FAQ, plus Sign out.
- No additional client settings tabs, manual text fields/dropdowns, Edit choices, Add appointment, subscription attribution or wake/off-state explanatory clutter.

Changes to care facts continue through the existing authenticated, reviewed Nancy commands. Planned/accepted choices remain distinct from actual reports. Help and product suggestions preserve their scoped conversation behaviour. Switching tabs keeps the active conversation.

Visual layout, primary-action placement, navigation labels and information hierarchy stay at this baseline until the owner approves another change. Bug fixes, truthful state/error feedback, security and keyboard/assistive-technology fixes can preserve this design without reopening the visual choice.

The design tests exercise the actual entry-page switch, the five tabs, absence of removed controls, conversation continuity and scoped data handling. Browser acceptance verifies the deployed Current view and that old Focus links return to Current. The original [Focus review and rollback instructions](FOCUS_UI_REVIEW.md) retain historical implementation details; the owner selection here supersedes its enabled-review state.
