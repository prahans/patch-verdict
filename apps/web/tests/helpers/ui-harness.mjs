// Exercise the real component callbacks without adding a browser/DOM dependency.
// Rendering still uses React's JSX runtime and react-dom/server; only the root
// component's state/ref hooks are supplied here. Effects (including live polling)
// are intentionally outside this event harness's scope.
let active;

export const navigation = {
  pushes: [],
  refreshes: 0,
  push(value) {
    this.pushes.push(value);
  },
  refresh() {
    this.refreshes += 1;
  },
};

export function useState(initial) {
  const instance = active;
  if (!instance)
    throw new Error("Render the interactive component through createHarness.");
  const index = instance.cursor++;
  if (!(index in instance.slots)) {
    instance.slots[index] = typeof initial === "function" ? initial() : initial;
  }
  return [
    instance.slots[index],
    (value) => {
      instance.slots[index] =
        typeof value === "function" ? value(instance.slots[index]) : value;
    },
  ];
}

export function useRef(initial) {
  const [ref] = useState(() => ({ current: initial }));
  return ref;
}

export function useEffect() {
  active.cursor += 1;
}

export function createHarness(Component, props = {}) {
  const instance = { slots: [], cursor: 0 };
  return {
    render() {
      instance.cursor = 0;
      active = instance;
      try {
        return Component(props);
      } finally {
        active = undefined;
      }
    },
  };
}

export function nodes(tree, predicate) {
  const found = [];
  function visit(node) {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== "object" || !("props" in node)) return;
    if (predicate(node)) found.push(node);
    visit(node.props.children);
  }
  visit(tree);
  return found;
}

export function textContent(node) {
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (node === null || node === undefined || typeof node === "boolean")
    return "";
  if (typeof node === "object") return textContent(node.props?.children);
  return String(node);
}

export const settle = () => new Promise((resolve) => setImmediate(resolve));

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
