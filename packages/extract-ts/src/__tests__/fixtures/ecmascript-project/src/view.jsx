function formatLabel(value) {
  return String(value);
}

export const Panel = ({ label }) => <section>{formatLabel(label)}</section>;
