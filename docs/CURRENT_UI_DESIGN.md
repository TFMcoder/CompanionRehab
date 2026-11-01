# Approved Current client design

On October 19, 2026 the owner compared Current and Focus, chose Current, and explicitly requested locking this design and preparing the pending feature work for local/GitHub merge. This records a visual design decision; it is not full intended-person, device, genuine-day or clinical acceptance.

Current is the shipped client interface, including when an older `/?layout=focus` review link is opened. The entry-page Focus switch is disabled. The preserved Focus implementation and exact verified Current source/build restore point remain available for deliberate future engineering review; they do not change the selected production design. October 21 live-test feedback explicitly overrides the original primary-action placement: Current's centered Talk panel now remains sticky at the top, and speech interruption controls are removed. See [the repair scope](LIVE_TEST_REPAIRS_2026-10-21.md).

October 31 accessibility exception: the owner explicitly requests text input for times when the client cannot speak. The candidate adds a secondary Type to Nancy button and an optional message box, preserving the primary Talk action, five tabs and reviewed conversation commands. Starting with typing requests audio output only; Heart remains the reply voice. This exception does not restore the removed direct-edit forms. Candidate activation remains a separate release step. See [typing candidate evidence](TEXT_INPUT_2026-10-31.md).

The approved visible structure is:

- Nancy branding and Suggestions for Nancy at the top.
- The green Talk to Nancy banner above the navigation, centered and sticky at the top with safe-area clearance, concise readiness/conversation state, always-visible Talk and an active-conversation Stop control. No Interrupt control.
- Exactly five client tabs: Tasks, Meals, Groceries, Progress and Ask for Help.
- A read-only Your Day timeline with participant-local times, source-attributed selected calendar events and separate untimed entries.
- Ways to use Nancy as an expandable FAQ, plus Sign out.
- No additional client settings tabs, direct-edit fields/dropdowns, Edit choices, Add appointment, subscription attribution or wake/off-state explanatory clutter. The October 31 optional Nancy message box is the approved accessibility exception.

Changes to care facts continue through the existing authenticated, reviewed Nancy commands. Planned/accepted choices remain distinct from actual reports. Help and product suggestions preserve their scoped conversation behaviour. Switching tabs keeps the active conversation.

Visual layout, primary-action placement, navigation labels and information hierarchy stay at this baseline until the owner approves another change. Bug fixes, truthful state/error feedback, security and keyboard/assistive-technology fixes can preserve this design without reopening the visual choice.

The design tests exercise the actual entry-page switch, the five tabs, absence of removed controls, conversation continuity and scoped data handling. Browser acceptance verifies the deployed Current view and that old Focus links return to Current. The original [Focus review and rollback instructions](FOCUS_UI_REVIEW.md) retain historical implementation details; the owner selection here supersedes its enabled-review state.

October31 explicit owner direction adds a Save Suggestions button for the current heard feedback/preference/personal-context review, and read-only recipe cards with exact yield, quantities, preparation steps and authenticated source links. These narrow exceptions retain Talk as primary, the five tabs and client-only care approval. A product suggestion cannot silently become a care preference or clinical instruction. See [repair evidence](CONVERSATION_REPAIR_2026-10-31.md).

October31 activation update: the explicitly requested typing, Save Suggestions and read-only quantified recipe cards are now enabled in the reviewed client repair release. Current remains selected and all care approval gates remain. Actual person/Safari acceptance is prepared for later; see [client repair](CLIENT_REPAIR_2026-10-31.md).

October31 archive exception: the owner requests stored conversation text for later analysis with until-deleted retention. The client’s explicit recording/stop/delete and saved-text review are available within the existing Ways to use Nancy view, with a recording/storage-failure status. Scoped administrators receive a read-only viewer within existing shared settings. Talk and the five tabs remain primary. Actual collection is off pending the client’s own choice; see [archive and evidence](CONVERSATION_ARCHIVE_2026-10-31.md).
