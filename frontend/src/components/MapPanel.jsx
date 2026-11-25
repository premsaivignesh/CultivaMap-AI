import React from "react";
import LeafletMap from "./LeafletMap.jsx";
import MapView from "./MapView.jsx";

// If Leaflet cannot start (e.g. package missing), fall back to the offline SVG map.
class Boundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error("Leaflet map failed:", err); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function MapPanel({ engine = "leaflet", ...props }) {
  const svg = <MapView {...props} />;
  if (engine !== "leaflet") return svg;
  return <Boundary fallback={svg}><LeafletMap {...props} /></Boundary>;
}
