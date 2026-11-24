// The collaboration session, loaded only when it is wanted (the Collaborate
// card, or a share link at startup): the package's React entry brings MUI,
// which nothing else in Delinya uses. The session panel and remote cursors
// are SynFlo's, from @sandtreader/collab/react, themed to match.

import type { ReactNode } from "react";
import { CollabClient } from "@sandtreader/collab/client";
import {
  RemoteCursors, SessionPanel, autoJoinFromUrl, getOrCreateDisplayName, getOrCreateUserId, useCollab,
} from "@sandtreader/collab/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { store } from "../app/store";
import { confirmBeforeJoin } from "../app/file";
import { toScreen, type View } from "../view/viewport";
import {
  COLLAB_APP, STORAGE_PREFIX, bindCollab, collabConfig, collabDocument, guardConnect, registerClient, sessionReplaced,
} from ".";

let client: CollabClient | null = null;
let guarded: CollabClient | null = null;

/** The app's one client, made on first use and bound to the store. */
function getClient(): CollabClient {
  if (!client) {
    client = new CollabClient({
      app: COLLAB_APP,
      userId: getOrCreateUserId(STORAGE_PREFIX),
      displayName: getOrCreateDisplayName(STORAGE_PREFIX),
      document: collabDocument(store, { replaced: sessionReplaced }),
    });
    bindCollab(store, client);
    registerClient(client);
  }
  return client;
}

/** The client as the panel sees it: joining asks to save unsaved changes first. */
function getGuarded(): CollabClient {
  guarded ??= guardConnect(getClient(), confirmBeforeJoin);
  return guarded;
}

const config = () => collabConfig(window.location);

// Delinya's look: its font and accent, at its small sizes.
const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0b6e99" },
    info: { main: "#0b6e99" },
    error: { main: "#9b1c1c" },
    text: { primary: "#1d1d1b", secondary: "#6b6b66" },
    divider: "#d9d9d4",
    background: { default: "#ffffff", paper: "#ffffff" },
  },
  typography: { fontFamily: "system-ui, -apple-system, sans-serif", fontSize: 12 },
  shape: { borderRadius: 4 },
  components: {
    MuiButton: { defaultProps: { disableElevation: true }, styleOverrides: { root: { textTransform: "none" } } },
  },
});

const Themed = ({ children }: { children: ReactNode }) => <ThemeProvider theme={theme}>{children}</ThemeProvider>;

/** The Collaborate card's content: display name, join, share link and QR code, members, leave. */
export function SessionCard() {
  return <Themed><SessionPanel client={getGuarded()} config={config()} /></Themed>;
}

/**
 * Other people's cursors over the drawing, placed by the view (canvas px),
 * in a layer clipped to the drawing area: someone else's view can have
 * them well off this one.
 */
export function SessionCursors({ view }: { view: View }) {
  const { presence } = useCollab(getClient());
  return (
    <div className="session-cursors">
      <Themed>
        <RemoteCursors
          presence={presence} position="absolute" zIndex={1}
          toScreen={(p) => { const [x, y] = toScreen(view, p); return { x, y }; }}
        />
      </Themed>
    </div>
  );
}

/** Join the session a share link names (`/s/abc-defg-hij`), if any. True if joining. */
export function autoJoin(): boolean {
  return autoJoinFromUrl(getGuarded(), config());
}
