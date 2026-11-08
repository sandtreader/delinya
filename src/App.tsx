// Placeholder shell. The drawing UI is not started yet: the model under
// src/model is the deliverable so far, exercised by the tests.

declare const __APP_VERSION__: string;

export function App() {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      <h1>Delinya</h1>
      <p>2D drawing tool with real units. Version {__APP_VERSION__}. No canvas yet.</p>
    </main>
  );
}
