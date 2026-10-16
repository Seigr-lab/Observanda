// Only move items whose position changed. Page navigation leaves DOM state intact.
export function orderNavigationNodes(parent, nodes) {
  let cursor = parent.firstElementChild;
  for (const node of nodes) {
    if (node !== cursor) {
      const focus = node.contains(document.activeElement) ? document.activeElement : null;
      parent.insertBefore(node, cursor);
      if (focus && document.activeElement !== focus) focus.focus({preventScroll:true});
    }
    cursor = node.nextElementSibling;
  }
}
