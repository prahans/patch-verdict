// Exercise the real component callbacks without adding a browser/DOM dependency.
// Rendering still uses React's JSX runtime and react-dom/server; only the root
// component's state/ref hooks are supplied here. Effect lifecycle execution is
// opt-in for tests that supply browser globals and deterministic timers.
let active;

export const navigation = {
  pushes: [],
  refreshes: 0,
  pathname: "/benchmarks",
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

export function useEffect(effect, dependencies) {
  const instance = active;
  const index = instance.cursor++;
  if (!instance.effects) return;
  const previous = instance.slots[index];
  if (
    !previous ||
    !dependencies ||
    dependencies.length !== previous.dependencies?.length ||
    dependencies.some((value, position) => !Object.is(value, previous.dependencies[position]))
  ) {
    instance.pending.push(() => {
      previous?.cleanup?.();
      instance.slots[index] = { dependencies, cleanup: effect() };
    });
  }
}

export function createHarness(Component, props = {}, { effects = false } = {}) {
  const instance = { slots: [], cursor: 0, effects, pending: [] };
  return {
    render(nextProps = props) {
      props = nextProps;
      instance.cursor = 0;
      active = instance;
      let tree;
      try {
        tree = Component(props);
      } finally {
        active = undefined;
      }
      for (const run of instance.pending.splice(0)) run();
      return tree;
    },
    unmount() {
      if (effects) {
        for (const slot of instance.slots) slot?.cleanup?.();
      }
      instance.slots = [];
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
