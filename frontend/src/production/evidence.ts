/**
 * Traceability for UI behavior composed by the production renderer.
 *
 * Locations refer to the immutable shipped renderer copied under
 * recovered/frontend/app.  These records are intentionally executable data so
 * tests can verify that every visible string remains present in the artifact.
 */
export const PRODUCTION_UI_EVIDENCE = {
  shellComposition: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:132985",
    anchors: ["onOpenBroadcast: void 0", "onOpenNetwork: void 0", "onOpenPlugins: uSe"]
  },
  sidebarHeader: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:50437,56290",
    anchors: ["New chat", "Plugins", "sand-agents-sidebar__plugins-entry"]
  },
  hiddenBots: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:56224",
    anchors: ["Hidden Bots", '"aria-haspopup": "dialog"']
  },
  accountMenu: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:499,50091",
    anchors: ["Settings", "About", "Help Center", "Send Feedback", "Log out", "Sign in", "Enter your name", "Your name", "Couldn’t save your name", "sand-agents-sidebar__account-name", "sand-agents-sidebar__account-name-input"]
  },
  signOutConfirmation: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:49084",
    anchors: ["Sign out?", "You’ll need to sign in again to use your Cursor account with Grok Bot.", "Sign out", "Cancel"]
  },
  privacyBlockedDialog: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:5335889-5337901@utf8:5335889,5335962,5337901",
    anchors: ["Update Privacy Mode", "Switch to Privacy Mode", "This setting is shared with Cursor.", "Open Privacy Settings", "sand-privacy-blocked-dialog"]
  },
  rosterReconnectNotice: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:511@utf8:2560288,2560456,2560564",
    anchors: ["sand-agents-reconnect-notice", "Reconnecting to your computer", "Retrying", "Retry"]
  },
  signInLanding: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:130769",
    anchors: ["Grok Bot", "Your team of always-on agents that you can give real work to.", "Sign in", "Continue in your browser", "Reopen link", "Cancel"]
  },
  signedInOnboarding: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:512@utf8:4479930,5391939,5397272,5400625,5412826,5441790,5624537",
    anchors: ["Meet Grok Bot", "Grok Bot has its own computer and works just like you", "Give each Bot a job", "What do you use every day?", "New Bot", "Get started", "Suggestions", "sand-onboarding__cast-", "sand-onboarding__suggestion-card", "demo-computer-wallpaper-BO7Ye4dV.jpg", "Grok Bot couldn’t finish setting up", "Try again"]
  },
  onboardingJobsTools: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:5378152,5419357,5429138@utf8:5420162,5429138,5430992",
    anchors: ["sand-onboarding__job-bubble", "Give each Bot a job", "What do you use every day?", "Search tools", "No tools match", "animationDelay"]
  },
  onboardingToolsSearch: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:5429138@utf8:5429138",
    anchors: ["name: \"search\", size: \"sm\"", "Search tools"]
  },
  onboardingCreate: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:5395462,5404992,5439131@utf8:5395462,5401140,5404992,5439131",
    anchors: ["Create your first Bot", "sand-agent-item", "sand-onboarding-create-name", "Get started", "pickedTemplateId", "createAgent", "source/transport-failure", "Can't reach your computer right now. Check your connection and try again."]
  },
  onboardingRouter: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:20492,130486@utf8:811833,5611085,5611476,5615297",
    anchors: ["landing", "countAgents", "veto-roster", "fail-open-probes"]
  },
  onboardingCreationLifecycle: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:5404992,5439131@utf8:5405111,5405437,5405526,5439131",
    anchors: ["already-onboarded", "signed-away", "createTeammate", "markSeen"]
  },
  emptyRoster: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:130478",
    anchors: ["No chats yet"]
  },
  about: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:137500",
    anchors: ["Grok Bot", "Copyright © 2026 SpaceXAI", "Copy version info", "Copied", "Release Track:", "OS:"]
  },
  feedback: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:137570",
    anchors: [
      "Send Feedback",
      'const xSe = "Grok Bot"',
      "Tell the ",
      " team what happened or what you want changed. Reports go straight to the team.",
      "What happened? What did you expect?",
      "Include current conversation ID",
      "Sent. Thank you!"
    ]
  },
  windowControls: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:132738",
    anchors: ["Minimize", "Restore", "Maximize", "Close"]
  },
  conversationComposer: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:113714,117040",
    anchors: ["Ask anything, or drop a file.", "Attach file", "Send message", "Attachments", "sand-prompt-attachments"]
  },
  conversationTranscript: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:126740,127985",
    anchors: ["Conversation transcript", "Agent message", "sand-virtual-transcript", "sand-transcript-row"]
  },
  computerShell: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:118744-119343,119626-119855,129447-129479,132921-132985@utf8:4787052,4805127,4805446,4806081,4806105,4806128,4810954,4812808,4831166,4832830,4835242,4837308,4845836",
    anchors: ["Grok Bot's Computer", "sand:vnc-liveness", "sand:vnc-viewer-visible", "sand:vnc-host-key", "sand:vnc-session", "persist:sand-forever-box", "sand-box-vnc-pool", "sand-computer-monitor-strip", "sand-computer-banner", "sand-computer-fullscreen", "sand-computer-cursor-overlay", "sand-computer-preview", "sand-box-handoff-card"]
  },
  settingsRegistry: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:131375",
    anchors: ["General", "Usage & Billing", "Updates"]
  },
  settingsDialog: {
    artifact: "index-BlqerJhg.js",
    location: "index-BlqerJhg.js:54,592,702",
    anchors: ["Grok Bot settings", "Updates", "Auto-review", "Check for Updates"]
  },
  plugins: {
    artifact: "view-B5Ug8wEm.js",
    location: "view-B5Ug8wEm.js:508,1777",
    anchors: ["Plugins", "Marketplace", "Yours", "Filter plugins", "All types", "Connectors", "Skills", "Ownership", "Team", "Public", "Search plugins", "Add", "Uninstall"]
  },
  hiddenChatsDialog: {
    artifact: "view-Cbx1-ckK.js",
    location: "view-Cbx1-ckK.js:12",
    anchors: ["Hidden Bots", "Hidden Bots stay active and keep their history, they just don't show in the sidebar.", "No hidden bots", "Unhide"]
  },
  commandPalette: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:47165,112032,131537,132072,132717",
    anchors: [".sand-command-palette", "Jump to", "Search agents", "Messages", "Search messages", "Files", "Links", "No links in this chat yet", "Filter results", "Results", "No results", "No files yet", "Search unavailable"]
  },
  orgChart: {
    artifact: "view-D0otXpJy.js",
    location: "view-D0otXpJy.js:571",
    anchors: ["sand-org-chart", "Org chart", "Close org chart", "Agent network", "Solid links are real agent-to-agent message history; dashed links are group membership."]
  },
  computerRoute: {
    artifact: "index-UbX-y3il.js",
    location: "index-UbX-y3il.js:523@utf8:5376312,5376601,5376658",
    anchors: ["./features/computer/overlay/entrypoint.ts", "./features/computer/overlay/view.tsx", "./view-ChG-6rmU.js"]
  }
} as const;

/** Artifact-backed surfaces whose full interaction state is not yet cleanly recovered. */
export const PRODUCTION_RENDERER_GAPS = {
  broadcast: "The shipped command availability explicitly marks broadcast unavailable because it has no current user path."
} as const;
