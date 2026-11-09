// The layer a selection is on, as a select, in the selection panel. Shown
// only when the drawing has more than one layer. A mixed selection shows
// "mixed" until a layer is picked for all of it.

import { layerChoice, setShapesLayer, type EntityId } from "../model";
import { store, useDocument } from "../app/store";

export function LayerSelect({ ids }: { ids: EntityId[] }) {
  useDocument();
  const { layers } = store.resolved;
  if (layers.length < 2) return null;
  const value = layerChoice(store.resolved, ids) ?? "";
  const move = (layer: EntityId) => {
    const c = setShapesLayer(store.state, ids, layer);
    if (c) store.commit(c);
  };
  return (
    <select className="layer-select" value={value} onChange={(e) => move(e.target.value)}>
      {value === "" && <option value="" disabled>mixed</option>}
      {layers.map((l) => <option key={l.id} value={l.id}>{l.name ? `${l.number} · ${l.name}` : l.number}</option>)}
    </select>
  );
}

/** Whether LayerSelect shows anything, so callers can leave out its row. */
export function hasLayerChoice(): boolean {
  return store.resolved.layers.length > 1;
}
