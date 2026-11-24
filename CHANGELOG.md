# Changelog

## 1.0.0 — 2026-11-24

- **First public release.**
- Documentation, how-tos and this changelog at
  [delinya.org](https://delinya.org).
- The About box links the home page and the documentation.

## 0.3.0 — 2026-11-24

- **Draw together.** A Collaborate button in the toolbar opens a session
  panel: pick a display name, then **Start session** with the code it
  offers, or type someone else's code and **Join session**. Share the link
  (or its QR code) and everyone in the session edits the same drawing
  live.
- Other people's cursors show on the drawing with their names.
- Share links (`delinya.net/s/abc-defg-hij`) open Delinya and join the
  session straight away.
- Joining someone else's session with unsaved changes asks you to save
  first, since their drawing replaces yours. A drawing that comes from a
  session opens as Untitled, so Save can't overwrite your own file with
  it.
- New and Open while others are in the session ask first, as they replace
  the drawing for everyone.

## 0.2.2 — 2026-11-24

- **Line styles.** Solid, dashed, dotted and dash-dot lines, and pen widths
  from 0.13 to 2 mm, from a new group in the toolbar. They set the style
  for shapes you draw next and restyle the selected ones. Widths are pen
  widths on paper: the same at any print scale and on screen at any zoom.
  PDF, SVG and print carry widths and dashes; DXF carries the dashes.
- **Corner radii, all at once.** An **all** switch (on by default) gives a
  rectangle one radius and one label checkbox for all four corners;
  switch it off for a field per corner. A single label for four equal
  corners reads "4× R10".
- Radius labels sit inside the corner's curve, right-aligned on the right,
  and turn with the rectangle.
- **Rotate…** and **Duplicate…** move from the selection panel to small
  cards dropped from toolbar buttons after Undo and Redo.
- Clearer icons for the quarter-turn buttons.

## 0.2.1 — 2026-11-23

- **Dimension tool** (D): click a rectangle's edge, a circle's outline or
  a line, then click where the dimension should go; click a rounded corner
  to label its radius.
- Dimensions and radius labels can be selected, dragged to a new offset
  (across the shape to flip sides) and deleted.
- **Dimension new shapes** in the toolbar turns the automatic dimensions
  on new shapes on or off; **Show dimensions** in the status bar hides or
  shows them on screen.
- **Fit to drawing**: in the status bar and on F, and automatically when
  you open a file.

## 0.1.2 — 2026-11-23

- **Text boxes** (T): drag out a box and type. The box's height sets the
  font size and its width the wrapping. Sans, serif or mono, bold, italic,
  left, centre or right aligned; rotate and mirror like a rectangle.
- Type straight onto the drawing: a new box goes into typing at once, and
  double-click, Enter or F2 edits an existing one.
- A box is never narrower than its longest word, so right and centred
  lines align cleanly.
- Text prints and exports in the standard PDF fonts, and as text in SVG
  and DXF.

## 0.1.1 — 2026-11-23

- **Rotation.** Turn rectangles to any angle; rotate and flip any
  selection by a typed angle, by quarter turns, or by dragging the new
  rotate handle above it (Shift for 15° steps).
- A turned rectangle resizes and snaps to the grid in its own frame.
- The rotate handle keeps clear of the selection's dimensions.
- The About dialog links to sandtreader.com.

## 0.1.0 — 2026-11-10

The first release.

- Lines, rectangles (with rounded corners), circles and paths of straight
  and curved segments, drawn on a millimetre grid with snapping to the
  grid and to other shapes.
- Exact positions and sizes in a floating panel; dimensions drawn
  automatically on new shapes.
- Links: equal sizes through shared variables; align and evenly space
  shapes once, or keep them linked live.
- Layers with their own line colours, hidden and locked per viewer.
- Rulers, lasso selection, resize handles, undo and redo.
- Duplicate in a direction with a gap, several copies at once, optionally
  linked; ⌘D for one more.
- Save and open `.dln` files on your computer.
- Print at true scale, tiled with overlap guides, a check ruler and a title
  block; download PDF, SVG and DXF.
